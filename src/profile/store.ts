import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isProcessAlive, readRuntimeState, terminateProcess } from "@/browser/lifecycle.ts";
import {
  assertValidAccount,
  getFingerprintPath,
  getProfileDir,
  getProfilesDir,
  getRuntimeStatePath,
} from "@/config/paths.ts";
import type { ArgOverrideMap, ProfileConfig } from "@/protocol/types.ts";

const OPTIONAL_STRING_FIELDS = [
  "proxy",
  "timezone",
  "lang",
  "acceptLang",
  "platform",
  "windowSize",
] as const;

export function generateFingerprint(): number {
  return randomInt(1, 0x1_0000_0000);
}

function normalizeOptionalFields(input: Record<string, unknown>): Partial<ProfileConfig> {
  const result: Partial<ProfileConfig> = {};
  for (const field of OPTIONAL_STRING_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim().length > 0) {
      result[field] = value.trim();
    }
  }
  return result;
}

function normalizeArgOverrides(
  existing: ArgOverrideMap | undefined,
  incoming: unknown,
): ArgOverrideMap | undefined {
  const merged: ArgOverrideMap = { ...existing };
  if (incoming && typeof incoming === "object" && !Array.isArray(incoming)) {
    for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
      if (value === undefined) {
        delete merged[key];
      } else if (value === null || typeof value === "string" || typeof value === "boolean") {
        merged[key] = value;
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function readProfileConfig(storageRoot: string, account: string): ProfileConfig | null {
  const fpPath = getFingerprintPath(storageRoot, account);
  if (!existsSync(fpPath)) {
    return null;
  }
  const raw = JSON.parse(readFileSync(fpPath, "utf8")) as Record<string, unknown>;
  if (
    typeof raw.fingerprint !== "number" ||
    !Number.isInteger(raw.fingerprint) ||
    raw.fingerprint < 1
  ) {
    throw new Error(`Invalid fingerprint in ${fpPath}.`);
  }
  const argOverrides = normalizeArgOverrides(undefined, raw.argOverrides);
  return {
    fingerprint: raw.fingerprint,
    ...normalizeOptionalFields(raw),
    ...(argOverrides ? { argOverrides } : {}),
  };
}

export function writeProfileConfig(
  storageRoot: string,
  account: string,
  config: ProfileConfig,
): void {
  const dir = getProfileDir(storageRoot, account);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    getFingerprintPath(storageRoot, account),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
}

export function createOrUpdateProfile(
  storageRoot: string,
  payload: Record<string, unknown>,
): ProfileConfig & { account: string } {
  const account = assertValidAccount(String(payload.account ?? ""));
  const existing = readProfileConfig(storageRoot, account);
  const regenerate = payload.regenerate === true;
  const fingerprint = existing && !regenerate ? existing.fingerprint : generateFingerprint();
  const next: ProfileConfig = {
    fingerprint,
    ...(existing ? normalizeOptionalFields(existing as unknown as Record<string, unknown>) : {}),
    ...normalizeOptionalFields(payload),
  };
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (payload[field] === null) {
      delete next[field];
    }
  }
  const argOverrides =
    payload.argOverrides === null
      ? undefined
      : normalizeArgOverrides(existing?.argOverrides, payload.argOverrides);
  if (argOverrides) {
    next.argOverrides = argOverrides;
  } else {
    delete next.argOverrides;
  }
  writeProfileConfig(storageRoot, account, next);
  return { account, ...next };
}

export interface ProfileSummary extends ProfileConfig {
  account: string;
  running: boolean;
  pid: number | null;
}

export function listProfiles(storageRoot: string): ProfileSummary[] {
  const root = getProfilesDir(storageRoot);
  if (!existsSync(root)) {
    return [];
  }
  const entries = readdirSync(root, { withFileTypes: true });
  const results: ProfileSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const config = readProfileConfig(storageRoot, entry.name);
    if (!config) {
      continue;
    }
    const runtime = readRuntimeState(getRuntimeStatePath(storageRoot, entry.name));
    const running = runtime !== null && isProcessAlive(runtime.pid);
    results.push({
      account: entry.name,
      ...config,
      running,
      pid: running && runtime ? runtime.pid : null,
    });
  }
  results.sort((a, b) => a.account.localeCompare(b.account));
  return results;
}

export async function deleteProfile(
  storageRoot: string,
  accountInput: string,
): Promise<{ account: string; deleted: boolean }> {
  const account = assertValidAccount(accountInput);
  const dir = getProfileDir(storageRoot, account);
  if (!existsSync(dir)) {
    return { account, deleted: false };
  }
  const runtime = readRuntimeState(getRuntimeStatePath(storageRoot, account));
  if (runtime && isProcessAlive(runtime.pid)) {
    await terminateProcess(runtime.pid);
  }
  rmSync(dir, { recursive: true, force: true });
  return { account, deleted: true };
}
