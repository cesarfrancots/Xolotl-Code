//! `bench` CLI entry point.
//!
//! `--help` and `--corpus <DIR>` (load + validate + list tasks) are offline
//! surfaces. Live model sweeps (`--models …`) require provider API keys and the
//! provider-client library (blocker B7); they are not part of CI.

use std::path::Path;
use std::process::ExitCode;

use bench::load_corpus;

const HELP: &str = "\
xolotl-bench — failure-mode benchmark harness

USAGE:
    bench [OPTIONS]

OPTIONS:
    -h, --help            Print this help and exit
        --corpus <DIR>    Load + validate the task corpus and list its tasks
        --models <LIST>   Comma-separated model ids to sweep (needs API keys; B7)
        --out <DIR>       Directory for results (<ts>.json / <ts>.md)

Live model runs require provider API keys and are not part of CI. Use --corpus to
validate the task suite offline.";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.is_empty() || args.iter().any(|a| a == "-h" || a == "--help") {
        println!("{HELP}");
        return ExitCode::SUCCESS;
    }

    if let Some(dir) = flag_value(&args, "--corpus") {
        return match load_corpus(Path::new(&dir)) {
            Ok(tasks) => {
                println!("Loaded {} task(s) from {dir}:", tasks.len());
                for task in &tasks {
                    println!(
                        "  - {:<28} [{:?}] ({} seed file(s))",
                        task.spec.name,
                        task.category,
                        task.spec.seed_files.len()
                    );
                }
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("bench: corpus failed validation: {error}");
                ExitCode::FAILURE
            }
        };
    }

    eprintln!(
        "bench: live model sweeps need API keys + the provider library (B7) and are not wired yet. \
         Use --corpus <DIR> to validate the suite offline, or --help."
    );
    ExitCode::FAILURE
}

/// Return the value following `flag` in `args`, if present.
fn flag_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}
