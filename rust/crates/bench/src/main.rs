//! `bench` CLI entry point.
//!
//! Skeleton for Phase 0. `--help` is the only stable surface today; live runs
//! (`--models …`) land with the corpus + baseline checkpoint (0.2).

use std::process::ExitCode;

const HELP: &str = "\
xolotl-bench — failure-mode benchmark harness

USAGE:
    bench [OPTIONS]

OPTIONS:
    -h, --help            Print this help and exit
        --models <LIST>   Comma-separated model ids to sweep (e.g. kimi-coding,deepseek,sonnet)
        --corpus <DIR>    Path to the task corpus directory
        --out <DIR>       Directory for results (<ts>.json / <ts>.md)

Live model runs require provider API keys and are not part of CI. This skeleton
builds the harness; the corpus and baseline land in checkpoint 0.2.";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.is_empty() || args.iter().any(|a| a == "-h" || a == "--help") {
        println!("{HELP}");
        return ExitCode::SUCCESS;
    }

    eprintln!("bench: live runs are not wired yet (checkpoint 0.2). Run with --help.");
    ExitCode::FAILURE
}
