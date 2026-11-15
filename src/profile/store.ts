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
import { normalizeBrowserSettings, readKitConfig, writeKitConfig } from "@/config/store.ts";
import type { BrowserDefaultsConfig, ProfileConfig } from "@/protocol/types.ts";

export const MAX_FINGERPRINT_SEED = 0x7fff_ffff;

export function generateFingerprint(): number {
  return randomInt(1, MAX_FINGERPRINT_SEED + 1);
}

function assertValidFingerprint(value: unknown, sourceLabel: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_FINGERPRINT_SEED
  ) {
    throw new Error(
      `Invalid fingerprint for profile "${sourceLabel}": expected an integer between 1 and ${MAX_FINGERPRINT_SEED}.`,
    );
  }
  return value;
}

function readFingerprintFile(storageRoot: string, account: string): number | null {
  const fpPath = getFingerprintPath(storageRoot, account);
  if (!existsSync(fpPath)) {
    return null;
  }
  const raw = readFileSync(fpPath, "utf8").trim();
  const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return assertValidFingerprint(parsed, account);
}

function parseProfileOverrides(rawValue: unknown, sourceLabel: string): BrowserDefaultsConfig {
  if (rawValue === undefined) {
    return {};
  }
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    throw new Error(`Invalid profile entry for "${sourceLabel}".`);
  }
  return normalizeBrowserSettings(rawValue as Record<string, unknown>);
}

export function readProfileConfig(storageRoot: string, account: string): ProfileConfig | null {
  const normalizedAccount = assertValidAccount(account);
  const fingerprint = readFingerprintFile(storageRoot, normalizedAccount);
  if (fingerprint === null) {
    return null;
  }
  const overrides = parseProfileOverrides(
    readKitConfig(storageRoot).profiles?.[normalizedAccount],
    normalizedAccount,
  );
  return {
    fingerprint,
    ...overrides,
  };
}

export function createProfile(
  storageRoot: string,
  payload: Record<string, unknown>,
): ProfileConfig & { account: string } {
  const account = assertValidAccount(String(payload.account ?? ""));
  const kitConfig = readKitConfig(storageRoot);
  const hasEntry = Boolean(kitConfig.profiles && account in kitConfig.profiles);
  const dir = getProfileDir(storageRoot, account);
  const hasDir = existsSync(dir);
  if (hasEntry || hasDir) {
    throw new Error(`Profile "${account}" already exists.`);
  }

  const fingerprint =
    payload.fingerprint !== undefined
      ? assertValidFingerprint(payload.fingerprint, account)
      : generateFingerprint();
  const overrides = normalizeBrowserSettings(payload);

  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(getFingerprintPath(storageRoot, account), `${fingerprint}\n`, "utf8");
    if (Object.keys(overrides).length > 0) {
      writeKitConfig(storageRoot, {
        ...kitConfig,
        profiles: {
          ...kitConfig.profiles,
          [account]: overrides,
        },
      });
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }

  return { account, fingerprint, ...overrides };
}

export interface ProfileSummary extends ProfileConfig {
  account: string;
  running: boolean;
  pid: number | null;
}

export function listProfiles(storageRoot: string): ProfileSummary[] {
  const profilesDir = getProfilesDir(storageRoot);
  if (!existsSync(profilesDir)) {
    return [];
  }
  const profileOverrides = readKitConfig(storageRoot).profiles ?? {};
  const results: ProfileSummary[] = [];

  for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const account = assertValidAccount(entry.name);
    const fingerprint = readFingerprintFile(storageRoot, account);
    if (fingerprint === null) {
      continue;
    }
    const overrides = parseProfileOverrides(profileOverrides[account], account);
    const runtime = readRuntimeState(getRuntimeStatePath(storageRoot, account));
    const running = runtime !== null && isProcessAlive(runtime.pid);
    results.push({
      account,
      fingerprint,
      ...overrides,
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
  const kitConfig = readKitConfig(storageRoot);
  const hasEntry = Boolean(kitConfig.profiles && account in kitConfig.profiles);
  const dir = getProfileDir(storageRoot, account);
  const hasDir = existsSync(dir);
  if (!hasEntry && !hasDir) {
    return { account, deleted: false };
  }

  if (hasDir) {
    const runtime = readRuntimeState(getRuntimeStatePath(storageRoot, account));
    if (runtime && isProcessAlive(runtime.pid)) {
      await terminateProcess(runtime.pid);
    }
    rmSync(dir, { recursive: true, force: true });
  }

  if (hasEntry && kitConfig.profiles) {
    const nextProfiles = { ...kitConfig.profiles };
    delete nextProfiles[account];
    const nextConfig = { ...kitConfig };
    if (Object.keys(nextProfiles).length > 0) {
      nextConfig.profiles = nextProfiles;
    } else {
      delete nextConfig.profiles;
    }
    writeKitConfig(storageRoot, nextConfig);
  }
  return { account, deleted: true };
}
