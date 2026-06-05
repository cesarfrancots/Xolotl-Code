//! Convert a PDF to Markdown (or JSON) from the command line.
//!
//!   cargo run -p pdfmd --example convert -- path/to/file.pdf
//!   cargo run -p pdfmd --example convert -- path/to/file.pdf json

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        eprintln!("usage: convert <file.pdf> [md|json]");
        std::process::exit(2);
    };
    let format = pdfmd::OutputFormat::parse(&args.next().unwrap_or_else(|| "md".to_string()));
    match pdfmd::convert_file(std::path::Path::new(&path), format) {
        Ok(output) => println!("{output}"),
        Err(err) => {
            eprintln!("conversion failed: {err}");
            std::process::exit(1);
        }
    }
}
