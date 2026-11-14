import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getConfigPath } from "@/config/paths.ts";
import type { BrowserDefaultsConfig, KitConfig } from "@/protocol/types.ts";

export const OPTIONAL_BROWSER_STRING_FIELDS = [
  "proxy",
  "timezone",
  "lang",
  "acceptLang",
  "windowSize",
] as const;

export function normalizeBrowserSettings(
  input: Record<string, unknown>,
  existing?: Record<string, unknown>,
): BrowserDefaultsConfig {
  const result: BrowserDefaultsConfig = {};

  for (const field of OPTIONAL_BROWSER_STRING_FIELDS) {
    const incoming = input[field];
    if (incoming === null) {
      continue;
    }
    if (typeof incoming === "string" && incoming.trim().length > 0) {
      result[field] = incoming.trim();
      continue;
    }
    const prev = existing?.[field];
    if (typeof prev === "string" && prev.trim().length > 0) {
      result[field] = prev.trim();
    }
  }

  for (const source of [existing, input]) {
    if (!source) {
      continue;
    }
    for (const [key, value] of Object.entries(source)) {
      if (!key.startsWith("--")) {
        continue;
      }
      if (value === undefined) {
        delete result[key as `--${string}`];
      } else if (value === null || typeof value === "string" || typeof value === "boolean") {
        result[key as `--${string}`] = value;
      }
    }
  }

  return result;
}

export function readKitConfig(storageRoot: string): KitConfig {
  const path = getConfigPath(storageRoot);
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8")) as KitConfig;
}

export function writeKitConfig(storageRoot: string, config: KitConfig): void {
  mkdirSync(storageRoot, { recursive: true });
  writeFileSync(getConfigPath(storageRoot), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function readGlobalDefaults(storageRoot: string): BrowserDefaultsConfig {
  const rawDefaults = readKitConfig(storageRoot).defaults;
  if (!rawDefaults || typeof rawDefaults !== "object" || Array.isArray(rawDefaults)) {
    return {};
  }
  return normalizeBrowserSettings(rawDefaults as unknown as Record<string, unknown>);
}
