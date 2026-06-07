import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { commands } from "../../bindings";
import { useTerminalStore } from "../../stores/terminalStore";

/** Payload of the `terminal://output` event emitted by the Rust reader thread. */
interface TerminalOutputPayload {
  id: string;
  /** Base64-encoded raw PTY bytes. */
  data: string;
}

/** Payload of the `terminal://exit` event. */
interface TerminalExitPayload {
  id: string;
}

/** Dark theme tuned to match the app's oklch palette (xterm wants hex/rgb). */
const XTERM_THEME = {
  background: "#0b0d11",
  foreground: "#c7ccd6",
  cursor: "#7fd7e0",
  cursorAccent: "#0b0d11",
  selectionBackground: "#27506233",
  black: "#1b1f27",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#c7ccd6",
  brightBlack: "#5c6370",
  brightRed: "#ff7b86",
  brightGreen: "#a6e22e",
  brightYellow: "#f3d08a",
  brightBlue: "#7fb6ff",
  brightMagenta: "#e0a0f0",
  brightCyan: "#7fd7e0",
  brightWhite: "#e8edf4",
} as const;

/** Decode base64 PTY output into the raw bytes xterm expects. */
function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * One xterm.js view bound to a single PTY. Spawns its backend terminal on
 * mount, streams output in, sends keystrokes out, and tears the PTY down on
 * unmount. `active` is true when this tab is the visible one — used to re-fit
 * after the container un-hides (a hidden container reports a 0×0 size).
 */
export function TerminalView({
  tabKey,
  active,
  visible,
}: {
  tabKey: string;
  active: boolean;
  visible: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);

  function fitAndFocus() {
    const term = termRef.current;
    const fit = fitRef.current;
    const container = containerRef.current;
    if (!term || !fit || !container) return;
    if (container.clientHeight === 0 || container.clientWidth === 0) return;
    try {
      fit.fit();
    } catch {
      return;
    }
    term.focus();
    const id = idRef.current;
    if (id) void commands.terminalResize(id, term.cols, term.rows);
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      theme: { ...XTERM_THEME },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    try {
      fit.fit();
    } catch {
      /* container may be 0-sized until laid out — re-fit happens on resize. */
    }
    termRef.current = term;
    fitRef.current = fit;

    // Keystrokes → PTY (dropped silently until the backend id is known; the
    // shell prompt is not ready before spawn resolves anyway).
    term.onData((data) => {
      const id = idRef.current;
      if (id) void commands.terminalWrite(id, data);
    });

    let disposed = false;
    // Output that arrives before our backend id is known is buffered, then
    // flushed once spawn resolves (captures the initial shell prompt).
    const pending: TerminalOutputPayload[] = [];
    let unlistenOutput: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;

    void (async () => {
      // Register listeners BEFORE spawning so no early output is lost.
      unlistenOutput = await listen<TerminalOutputPayload>("terminal://output", (e) => {
        if (disposed) return;
        if (idRef.current === null) {
          pending.push(e.payload);
        } else if (e.payload.id === idRef.current) {
          term.write(decodeBase64(e.payload.data));
        }
      });
      unlistenExit = await listen<TerminalExitPayload>("terminal://exit", (e) => {
        if (idRef.current && e.payload.id === idRef.current) {
          useTerminalStore.getState().markExited(idRef.current);
        }
      });
      if (disposed) {
        unlistenOutput();
        unlistenExit();
        return;
      }

      const res = await commands.terminalSpawn(null, null, term.cols, term.rows);
      if (res.status === "error") {
        term.writeln(`\x1b[31m[failed to start shell: ${res.error}]\x1b[0m`);
        // No PTY id will ever arrive: stop listening and stop buffering, else
        // this dead view accumulates every terminal's global output forever.
        disposed = true;
        unlistenOutput();
        unlistenExit();
        pending.length = 0;
        return;
      }
      if (disposed) {
        // Unmounted while spawning — don't leak the orphan PTY.
        void commands.terminalKill(res.data.id);
        return;
      }
      idRef.current = res.data.id;
      useTerminalStore.getState().setBackendId(tabKey, res.data.id);
      for (const p of pending) {
        if (p.id === res.data.id) term.write(decodeBase64(p.data));
      }
      pending.length = 0;
    })();

    // Keep the PTY sized to the container.
    const ro = new ResizeObserver(() => {
      if (container.clientHeight === 0 || container.clientWidth === 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      const id = idRef.current;
      if (id) void commands.terminalResize(id, term.cols, term.rows);
    });
    ro.observe(container);

    return () => {
      disposed = true;
      ro.disconnect();
      unlistenOutput?.();
      unlistenExit?.();
      const id = idRef.current;
      if (id) void commands.terminalKill(id);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      idRef.current = null;
    };
  }, [tabKey]);

  // When this tab becomes visible, re-fit (the container had no size while
  // hidden) and focus it. Defer a frame so layout has settled.
  useEffect(() => {
    if (!active || !visible) return undefined;
    const raf = requestAnimationFrame(() => {
      fitAndFocus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active, visible]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      onPointerDown={() => fitAndFocus()}
      onFocus={() => fitAndFocus()}
    />
  );
}
