const steps = Array.from(document.querySelectorAll(".loop-step"));
const command = document.querySelector("#typed-command");
const log = document.querySelector("#terminal-log");
const metaModel = document.querySelector("#meta-model");
const cacheRows = document.querySelector("#cache-rows");
const ledgerEntries = document.querySelector("#ledger-entries");

const states = [
  {
    command: 'xolotl prompt "map the codebase"',
    model: "kimi-coding",
    cache: [
      { file: "DESIGN.md", state: "hit", cls: "hit" },
      { file: "AGENTS.md", state: "hit", cls: "hit" },
      { file: "src/prompt.rs", state: "read", cls: "read" },
    ],
    ledger: [
      { text: "cargo test — 7 passed", led: "ok" },
      { text: "fmt — clean", led: "ok" },
      { text: "clippy — 0 warnings", led: "ok" },
    ],
    lines: [
      ["cache", "loaded graphify report and DESIGN.md"],
      ["read", "found runtime prompt builder and CLI entrypoint"],
      ["plan", "bounded edit scope to native design context"],
    ],
  },
  {
    command: 'xolotl prompt "route this implementation"',
    model: "minimax2.7",
    cache: [
      { file: "DESIGN.md", state: "hit", cls: "hit" },
      { file: "src/router.rs", state: "read", cls: "read" },
      { file: "Cargo.toml", state: "hit", cls: "hit" },
    ],
    ledger: [
      { text: "cache sweep — 2 hits", led: "ok" },
      { text: "ctx size — 892K", led: "warn" },
      { text: "route — minimax2.7", led: "ok" },
    ],
    lines: [
      ["model", "minimax2.7 selected for large pass"],
      ["budget", "context cache reduced repeated file reads"],
      ["risk", "tests required for prompt assembly"],
    ],
  },
  {
    command: 'xolotl prompt "apply the patch"',
    model: "glm5.1",
    cache: [
      { file: "DESIGN.md", state: "hit", cls: "hit" },
      { file: "src/prompt.rs", state: "miss", cls: "miss" },
      { file: "src/main.rs", state: "read", cls: "read" },
    ],
    ledger: [
      { text: "patch — 3 files", led: "ok" },
      { text: "guard — no unrelated files", led: "ok" },
      { text: "review — 12 hunks", led: "warn" },
    ],
    lines: [
      ["tool", "apply_patch updated runtime prompt surface"],
      ["guard", "no unrelated files touched"],
      ["learn", "DESIGN.md promoted to native context"],
    ],
  },
  {
    command: "cargo test -p runtime prompt::tests::",
    model: "kimi-coding",
    cache: [
      { file: "tests/prompt.rs", state: "hit", cls: "hit" },
      { file: "DESIGN.md", state: "hit", cls: "hit" },
      { file: "target/", state: "cache", cls: "hit" },
    ],
    ledger: [
      { text: "test — 7 passed", led: "ok" },
      { text: "lint — format clean", led: "ok" },
      { text: "ship — ready for commit", led: "ok" },
    ],
    lines: [
      ["test", "7 prompt tests passed"],
      ["lint", "formatting clean"],
      ["ship", "ready for verified commit"],
    ],
  },
];

let activeStep = 0;
let activeState = 0;

function renderStep() {
  steps.forEach((step, index) => {
    step.classList.toggle("active", index === activeStep);
  });
  activeStep = (activeStep + 1) % steps.length;
}

function renderState() {
  const state = states[activeState];
  command.textContent = state.command;
  if (metaModel) metaModel.textContent = state.model;

  if (cacheRows) {
    cacheRows.innerHTML = state.cache
      .map(
        (c) =>
          `<div class="cache-row ${c.cls}"><span class="cache-file">${c.file}</span><span class="cache-state">${c.state}</span></div>`
      )
      .join("");
  }

  if (ledgerEntries) {
    ledgerEntries.innerHTML = state.ledger
      .map(
        (l) =>
          `<div class="ledger-entry"><span class="led ${l.led}" aria-hidden="true">●</span> ${l.text}</div>`
      )
      .join("");
  }

  log.innerHTML = state.lines
    .map(
      ([label, text]) =>
        `<p><span class="log-label ${label}">${label}</span> ${text}</p>`
    )
    .join("");

  activeState = (activeState + 1) % states.length;
}

renderStep();
renderState();
setInterval(renderStep, 1800);
setInterval(renderState, 4800);
