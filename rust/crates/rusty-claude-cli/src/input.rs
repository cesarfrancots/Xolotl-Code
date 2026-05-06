use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;

use crossterm::cursor::MoveToColumn;
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::queue;
use crossterm::style::{Color, Print, ResetColor, SetForegroundColor};
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, Clear, ClearType};

// ── Input History ─────────────────────────────────────────────────────────────

/// Persistent input history stored in `~/.xolotl-code/history.txt`.
pub struct InputHistory {
    entries: Vec<String>,
    /// Current browse position (`entries.len()` == "new input", < len = browsing).
    cursor: usize,
    /// Maximum entries to keep in memory/on disk.
    max_entries: usize,
}

impl InputHistory {
    #[must_use]
    pub fn load() -> Self {
        let path = Self::path();
        let entries = std::fs::read_to_string(&path)
            .ok()
            .map(|text| {
                text.lines()
                    .filter(|l| !l.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let len = entries.len();
        Self {
            entries,
            cursor: len,
            max_entries: 1000,
        }
    }

    pub fn push(&mut self, entry: impl Into<String>) {
        let entry = entry.into();
        if entry.trim().is_empty() {
            return;
        }
        // Deduplicate consecutive entries
        if self.entries.last().is_some_and(|last| *last == entry) {
            self.cursor = self.entries.len();
            return;
        }
        self.entries.push(entry);
        // Trim oldest entries
        if self.entries.len() > self.max_entries {
            let drain = self.entries.len() - self.max_entries;
            self.entries.drain(..drain);
        }
        self.cursor = self.entries.len();
        self.save();
    }

    /// Navigate to the previous (older) entry. Returns the text to display.
    pub fn prev(&mut self) -> Option<&str> {
        if self.entries.is_empty() || self.cursor == 0 {
            return None;
        }
        self.cursor -= 1;
        Some(&self.entries[self.cursor])
    }

    /// Navigate to the next (newer) entry. Returns None when back at the
    /// "new input" position.
    pub fn next(&mut self) -> Option<&str> {
        if self.cursor >= self.entries.len() {
            return None;
        }
        self.cursor += 1;
        if self.cursor >= self.entries.len() {
            None // back to blank input
        } else {
            Some(&self.entries[self.cursor])
        }
    }

    /// Reset cursor to the end (new input position).
    pub fn reset_cursor(&mut self) {
        self.cursor = self.entries.len();
    }

    fn save(&self) {
        let path = Self::path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let text = self.entries.join("\n");
        let _ = std::fs::write(path, text);
    }

    fn path() -> PathBuf {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map_or_else(|_| PathBuf::from("."), PathBuf::from);
        home.join(".xolotl-code").join("history.txt")
    }
}

// ── Input Buffer ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputBuffer {
    buffer: String,
    cursor: usize,
}

impl InputBuffer {
    #[must_use]
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
            cursor: 0,
        }
    }

    pub fn insert(&mut self, ch: char) {
        self.buffer.insert(self.cursor, ch);
        self.cursor += ch.len_utf8();
    }

    pub fn insert_newline(&mut self) {
        self.insert('\n');
    }

    pub fn backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }

        let previous = self.buffer[..self.cursor]
            .char_indices()
            .last()
            .map_or(0, |(idx, _)| idx);
        self.buffer.drain(previous..self.cursor);
        self.cursor = previous;
    }

    pub fn move_left(&mut self) {
        if self.cursor == 0 {
            return;
        }
        self.cursor = self.buffer[..self.cursor]
            .char_indices()
            .last()
            .map_or(0, |(idx, _)| idx);
    }

    pub fn move_right(&mut self) {
        if self.cursor >= self.buffer.len() {
            return;
        }
        if let Some(next) = self.buffer[self.cursor..].chars().next() {
            self.cursor += next.len_utf8();
        }
    }

    pub fn move_home(&mut self) {
        self.cursor = 0;
    }

    pub fn move_end(&mut self) {
        self.cursor = self.buffer.len();
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.buffer
    }

    #[cfg(test)]
    #[must_use]
    pub fn cursor(&self) -> usize {
        self.cursor
    }

    pub fn clear(&mut self) {
        self.buffer.clear();
        self.cursor = 0;
    }

    /// Replace the entire buffer content (used by history navigation).
    pub fn set(&mut self, text: &str) {
        self.buffer = text.to_string();
        self.cursor = self.buffer.len();
    }
}

// ── Line Editor ───────────────────────────────────────────────────────────────

pub struct LineEditor {
    prompt: String,
    history: InputHistory,
}

impl LineEditor {
    #[must_use]
    pub fn new(prompt: impl Into<String>) -> Self {
        Self {
            prompt: prompt.into(),
            history: InputHistory::load(),
        }
    }

    pub fn read_line(&mut self) -> io::Result<Option<String>> {
        if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
            return self.read_line_fallback();
        }

        enable_raw_mode()?;
        // Always restore terminal, even if the inner read fails
        let result = self.read_line_raw();
        let _ = disable_raw_mode();

        // Save to history on success
        if let Ok(Some(ref text)) = result {
            self.history.push(text.clone());
        }
        result
    }

    /// Read a line with action support — returns both the input and any special action.
    pub fn read_line_with_actions(&mut self) -> io::Result<(Option<String>, Option<EditorAction>)> {
        if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
            return self.read_line_fallback().map(|s| (s, None));
        }

        enable_raw_mode()?;
        let result = self.read_line_raw_with_actions();
        let _ = disable_raw_mode();

        if let Ok((Some(ref text), _)) = result {
            self.history.push(text.clone());
        }
        result
    }

    fn read_line_raw(&mut self) -> io::Result<Option<String>> {
        let mut stdout = io::stdout();
        let mut input = InputBuffer::new();
        self.history.reset_cursor();
        self.redraw(&mut stdout, &input)?;

        loop {
            let event = event::read()?;
            if let Event::Key(key) = event {
                match self.handle_key(key, &mut input) {
                    EditorAction::Continue => self.redraw(&mut stdout, &input)?,
                    EditorAction::Submit => {
                        writeln!(stdout)?;
                        return Ok(Some(input.as_str().to_owned()));
                    }
                    EditorAction::Cancel => {
                        writeln!(stdout)?;
                        return Ok(None);
                    }
                    EditorAction::ClearScreen => {
                        let _ = queue!(stdout, Clear(ClearType::All), MoveToColumn(0));
                        let _ = stdout.flush();
                        self.redraw(&mut stdout, &input)?;
                    }
                    EditorAction::ToggleThinking
                    | EditorAction::CycleEffort
                    | EditorAction::QuickModel
                    | EditorAction::SaveSession
                    | EditorAction::RetryLast => {
                        // These should be handled by the caller
                        writeln!(stdout)?;
                        return Ok(Some(input.as_str().to_owned()));
                    }
                }
            }
        }
    }

    fn read_line_raw_with_actions(&mut self) -> io::Result<(Option<String>, Option<EditorAction>)> {
        let mut stdout = io::stdout();
        let mut input = InputBuffer::new();
        self.history.reset_cursor();
        self.redraw(&mut stdout, &input)?;

        loop {
            let event = event::read()?;
            if let Event::Key(key) = event {
                match self.handle_key(key, &mut input) {
                    EditorAction::Continue => self.redraw(&mut stdout, &input)?,
                    EditorAction::Submit => {
                        writeln!(stdout)?;
                        return Ok((Some(input.as_str().to_owned()), None));
                    }
                    EditorAction::Cancel => {
                        writeln!(stdout)?;
                        return Ok((None, None));
                    }
                    EditorAction::ClearScreen => {
                        let _ = queue!(stdout, Clear(ClearType::All), MoveToColumn(0));
                        let _ = stdout.flush();
                        self.redraw(&mut stdout, &input)?;
                    }
                    action @ (EditorAction::ToggleThinking
                    | EditorAction::CycleEffort
                    | EditorAction::QuickModel
                    | EditorAction::SaveSession
                    | EditorAction::RetryLast) => {
                        writeln!(stdout)?;
                        return Ok((Some(input.as_str().to_owned()), Some(action)));
                    }
                }
            }
        }
    }

    fn read_line_fallback(&self) -> io::Result<Option<String>> {
        let mut stdout = io::stdout();
        write!(stdout, "{}", self.prompt)?;
        stdout.flush()?;

        let mut buffer = String::new();
        let bytes_read = io::stdin().read_line(&mut buffer)?;
        if bytes_read == 0 {
            return Ok(None);
        }

        while matches!(buffer.chars().last(), Some('\n' | '\r')) {
            buffer.pop();
        }
        Ok(Some(buffer))
    }

    fn handle_key(&mut self, key: KeyEvent, input: &mut InputBuffer) -> EditorAction {
        // On Windows, crossterm fires Press + Release (and sometimes Repeat) for
        // every keystroke. Only act on Press to avoid doubling characters.
        if key.kind != KeyEventKind::Press {
            return EditorAction::Continue;
        }
        match key {
            KeyEvent {
                code: KeyCode::Char('c'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => EditorAction::Cancel,
            KeyEvent {
                code: KeyCode::Char('l'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => EditorAction::ClearScreen,
            KeyEvent {
                code: KeyCode::Char('t'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => EditorAction::ToggleThinking,
            KeyEvent {
                code: KeyCode::Char('e'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => EditorAction::CycleEffort,
            KeyEvent {
                code: KeyCode::Char('m'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => EditorAction::QuickModel,
            KeyEvent {
                code: KeyCode::Char('s'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => EditorAction::SaveSession,
            KeyEvent {
                code: KeyCode::Char('r'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => EditorAction::RetryLast,
            KeyEvent {
                code: KeyCode::Char('j'),
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) => {
                input.insert_newline();
                EditorAction::Continue
            }
            KeyEvent {
                code: KeyCode::Enter,
                modifiers,
                ..
            } if modifiers.contains(KeyModifiers::SHIFT) => {
                input.insert_newline();
                EditorAction::Continue
            }
            KeyEvent {
                code: KeyCode::Enter,
                ..
            } => EditorAction::Submit,
            KeyEvent {
                code: KeyCode::Backspace,
                ..
            } => {
                input.backspace();
                EditorAction::Continue
            }
            KeyEvent {
                code: KeyCode::Left,
                ..
            } => {
                input.move_left();
                EditorAction::Continue
            }
            KeyEvent {
                code: KeyCode::Right,
                ..
            } => {
                input.move_right();
                EditorAction::Continue
            }
            KeyEvent {
                code: KeyCode::Up, ..
            } => {
                // Navigate history backward
                if let Some(text) = self.history.prev() {
                    input.set(text);
                }
                EditorAction::Continue
            }
            KeyEvent {
                code: KeyCode::Down,
                ..
            } => {
                // Navigate history forward
                match self.history.next() {
                    Some(text) => input.set(text),
                    None => input.clear(), // back to blank
                }
                EditorAction::Continue
            }
            KeyEvent {
                code: KeyCode::Home,
                ..
            } => {
                input.move_home();
                EditorAction::Continue
            }
            KeyEvent {
                code: KeyCode::End, ..
            } => {
                input.move_end();
                EditorAction::Continue
            }
            KeyEvent {
                code: KeyCode::Esc, ..
            } => {
                input.clear();
                EditorAction::Cancel
            }
            KeyEvent {
                code: KeyCode::Char(ch),
                modifiers,
                ..
            } if modifiers.is_empty() || modifiers == KeyModifiers::SHIFT => {
                input.insert(ch);
                EditorAction::Continue
            }
            _ => EditorAction::Continue,
        }
    }

    fn redraw(&self, out: &mut impl Write, input: &InputBuffer) -> io::Result<()> {
        // Display embedded newlines as a visible symbol + indent
        let display = input.as_str().replace('\n', "↵\n  ");
        queue!(
            out,
            MoveToColumn(0),
            Clear(ClearType::CurrentLine),
            SetForegroundColor(Color::Cyan),
            Print("› "),
            ResetColor,
            Print(display),
        )?;
        out.flush()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorAction {
    Continue,
    Submit,
    Cancel,
    ClearScreen,
    ToggleThinking,
    CycleEffort,
    QuickModel,
    SaveSession,
    RetryLast,
}

#[cfg(test)]
mod tests {
    use super::InputBuffer;

    #[test]
    fn supports_basic_line_editing() {
        let mut input = InputBuffer::new();
        input.insert('h');
        input.insert('i');
        input.move_end();
        input.insert_newline();
        input.insert('x');

        assert_eq!(input.as_str(), "hi\nx");
        assert_eq!(input.cursor(), 4);

        input.move_left();
        input.backspace();
        assert_eq!(input.as_str(), "hix");
        assert_eq!(input.cursor(), 2);
    }

    #[test]
    fn set_replaces_buffer_contents() {
        let mut input = InputBuffer::new();
        input.insert('a');
        input.insert('b');
        input.set("new content");
        assert_eq!(input.as_str(), "new content");
        assert_eq!(input.cursor(), 11);
    }
}
