import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  assertValidAccount,
  getFingerprintPath,
  getProfileDir,
  getProfilesDir,
  getRuntimeStatePath,
} from "./paths.ts";
import { isProcessAlive, readRuntimeState, terminateProcess } from "./process.ts";
import type { ProfileConfig } from "./types.ts";

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
  return {
    fingerprint: raw.fingerprint,
    ...normalizeOptionalFields(raw),
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

export function ensureProfile(storageRoot: string, account: string): ProfileConfig {
  const existing = readProfileConfig(storageRoot, account);
  if (existing) {
    return existing;
  }
  const created: ProfileConfig = { fingerprint: generateFingerprint() };
  writeProfileConfig(storageRoot, account, created);
  return created;
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
