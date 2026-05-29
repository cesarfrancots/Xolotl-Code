# Benchmark corpus (Phase 0, CP 0.2)

Each subdirectory is one benchmark task, loaded by `bench::load_corpus` and run
through the real conversation loop by `bench::run_task`.

## Task layout

```
<task-name>/
  prompt.md     # the instruction given to the model (required, non-empty)
  task.json     # { "category": <category>, "acceptance": <acceptance> }
  seed/         # files copied into the task's isolated working dir
                # (required unless category == "create-from-scratch")
```

### Categories (D9)

`single-file-edit`, `multi-file-edit`, `create-from-scratch`,
`bugfix-with-failing-test`, `refactor-preserving-api`, `navigate-large-repo`.

### Acceptance kinds

- `{ "kind": "file-contains", "path": "...", "substring": "..." }`
- `{ "kind": "file-equals", "path": "...", "contents": "..." }`
- `{ "kind": "command", "command": "..." }`  (must exit 0; run in the task dir)

Acceptance is validated structurally at load time and evaluated by **live runs**.

## Status

This is a representative starter set spanning five categories, used to validate
the loader offline (`cargo run -p bench -- --corpus crates/bench/corpus`). Two
items remain for the live baseline and are **deferred because they require API
keys + spend** (recorded as TBD per the plan, never invented):

- Scaling to the full D9 count (30 tasks across all six categories, incl.
  `navigate-large-repo`). Adding tasks is purely additive — drop in more dirs.
- Running the baseline sweep (`--models …`) and recording §5 numbers. This also
  needs blocker **B7** (a `lib.rs` re-exporting the provider HTTP clients so the
  `bench` crate can build real `ApiClient`s) and **B8** (working-dir-aware path
  resolution for model-emitted relative paths). Both are live-run prerequisites;
  the offline harness + loader are complete and ready for them.
