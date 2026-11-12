import pkg from "../package.json";

export function run(args: string[]): number {
  const first = args[0];
  if (first === "-V" || first === "--version") {
    console.log(`agent-browser-kit ${pkg.version}`);
    return 0;
  }
  if (first === "-h" || first === "--help") {
    console.log(
      `agent-browser-kit ${pkg.version}\n\nUsage: agent-browser-kit [OPTIONS]\n\nOptions:\n  -h, --help     Print help\n  -V, --version  Print version`,
    );
    return 0;
  }
  if (first === undefined) {
    console.log("Extended CLI shim for agent-browser.");
    return 0;
  }
  console.error(`Unknown argument: ${first}`);
  return 2;
}

if (import.meta.main) {
  process.exitCode = run(process.argv.slice(2));
}
