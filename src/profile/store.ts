import { randomInt } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { isProcessAlive, readRuntimeState, terminateProcess } from "@/browser/lifecycle.ts";
import { assertValidAccount, getProfileDir, getRuntimeStatePath } from "@/config/paths.ts";
import { normalizeBrowserSettings, readKitConfig, writeKitConfig } from "@/config/store.ts";
import type { ProfileConfig } from "@/protocol/types.ts";

export function generateFingerprint(): number {
  return randomInt(1, 0x1_0000_0000);
}

function parseProfileRecord(rawValue: unknown, sourceLabel: string): ProfileConfig {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    throw new Error(`Invalid profile entry for "${sourceLabel}".`);
  }
  const raw = rawValue as Record<string, unknown>;
  if (
    typeof raw.fingerprint !== "number" ||
    !Number.isInteger(raw.fingerprint) ||
    raw.fingerprint < 1
  ) {
    throw new Error(`Invalid fingerprint for profile "${sourceLabel}".`);
  }
  return {
    fingerprint: raw.fingerprint,
    ...normalizeBrowserSettings(raw),
  };
}

export function readProfileConfig(storageRoot: string, account: string): ProfileConfig | null {
  const normalizedAccount = assertValidAccount(account);
  const rawProfile = readKitConfig(storageRoot).profiles?.[normalizedAccount];
  if (!rawProfile) {
    return null;
  }
  return parseProfileRecord(rawProfile, normalizedAccount);
}

export function createOrUpdateProfile(
  storageRoot: string,
  payload: Record<string, unknown>,
): ProfileConfig & { account: string } {
  const account = assertValidAccount(String(payload.account ?? ""));
  const kitConfig = readKitConfig(storageRoot);
  const existing = kitConfig.profiles?.[account]
    ? parseProfileRecord(kitConfig.profiles[account], account)
    : null;
  const fingerprint = existing ? existing.fingerprint : generateFingerprint();
  const next: ProfileConfig = {
    fingerprint,
    ...normalizeBrowserSettings(
      payload,
      existing ? (existing as unknown as Record<string, unknown>) : undefined,
    ),
  };

  writeKitConfig(storageRoot, {
    ...kitConfig,
    profiles: {
      ...kitConfig.profiles,
      [account]: next,
    },
  });
  return { account, ...next };
}

export interface ProfileSummary extends ProfileConfig {
  account: string;
  running: boolean;
  pid: number | null;
}

export function listProfiles(storageRoot: string): ProfileSummary[] {
  const profiles = readKitConfig(storageRoot).profiles ?? {};
  const results: ProfileSummary[] = [];
  for (const [account, rawProfile] of Object.entries(profiles)) {
    const config = parseProfileRecord(rawProfile, account);
    const runtime = readRuntimeState(getRuntimeStatePath(storageRoot, account));
    const running = runtime !== null && isProcessAlive(runtime.pid);
    results.push({
      account,
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
