const steps = Array.from(document.querySelectorAll(".node"));
const command = document.querySelector("#typed-command");
const log = document.querySelector("#terminal-log");

const states = [
  {
    command: 'xolotl prompt "map the codebase"',
    lines: [
      ["cache", "loaded graphify report and AGENTS.md"],
      ["read", "found runtime prompt builder and CLI entrypoint"],
      ["plan", "bounded edit scope to native design context"],
    ],
  },
  {
    command: 'xolotl prompt "route this implementation"',
    lines: [
      ["model", "kimi-coding selected for code edits"],
      ["budget", "context cache reduced repeated file reads"],
      ["risk", "tests required for prompt assembly"],
    ],
  },
  {
    command: 'xolotl prompt "apply the patch"',
    lines: [
      ["tool", "apply_patch updated runtime prompt surface"],
      ["guard", "no unrelated files touched"],
      ["learn", "DESIGN.md promoted to native context"],
    ],
  },
  {
    command: "cargo test -p runtime prompt::tests::",
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

function renderTerminal() {
  const state = states[activeState];
  command.textContent = state.command;
  log.innerHTML = state.lines
    .map(([label, text]) => `<p><span>${label}</span> ${text}</p>`)
    .join("");
  activeState = (activeState + 1) % states.length;
}

renderStep();
renderTerminal();
setInterval(renderStep, 1600);
setInterval(renderTerminal, 4200);
