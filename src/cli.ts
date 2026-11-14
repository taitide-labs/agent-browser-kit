import pkg from "../package.json";
import { getDefaultStorageRoot } from "./paths.ts";
import { handlePluginRequest } from "./plugin.ts";

function printHelp(): void {
  console.log(
    `agent-browser-kit ${pkg.version}\n\nagent-browser plugin for fingerprint-chromium multi-account isolation (stdio protocol: agent-browser.plugin.v1).\nRun "agent-browser plugin run kit help" for available plugin commands.\n\nOptions:\n  -h, --help     Print help\n  -V, --version  Print version`,
  );
}

export function runCliArgs(args: string[]): number | null {
  const first = args[0];
  if (first === "-V" || first === "--version") {
    console.log(`agent-browser-kit ${pkg.version}`);
    return 0;
  }
  if (first === "-h" || first === "--help") {
    printHelp();
    return 0;
  }
  if (first !== undefined) {
    console.error(`Unknown argument: ${first}`);
    return 2;
  }
  return null;
}

export async function runMain(args: string[]): Promise<number> {
  const handled = runCliArgs(args);
  if (handled !== null) {
    return handled;
  }
  if (process.stdin.isTTY) {
    printHelp();
    return 0;
  }

  const rawText = await Bun.stdin.text();
  if (!rawText.trim()) {
    console.log(
      JSON.stringify({
        protocol: "agent-browser.plugin.v1",
        success: false,
        error: "Empty stdin request.",
      }),
    );
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    console.log(
      JSON.stringify({
        protocol: "agent-browser.plugin.v1",
        success: false,
        error: `Invalid JSON request: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
    return 1;
  }

  const response = await handlePluginRequest({ storageRoot: getDefaultStorageRoot() }, parsed);
  console.log(JSON.stringify(response));
  return response.success ? 0 : 1;
}

if (import.meta.main) {
  const code = await runMain(process.argv.slice(2));
  process.exit(code);
}
