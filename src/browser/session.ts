import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  assertValidAccount,
  getDefaultEphemeralRoot,
  getEphemeralIndexPath,
  getProfileDir,
  getRuntimeStatePath,
} from "@/config/paths.ts";
import { generateFingerprint, readProfileConfig } from "@/profile/store.ts";
import type { ProfileConfig } from "@/protocol/types.ts";
import {
  cleanupStaleLocks,
  isCdpUrlReachable,
  isProcessAlive,
  readRuntimeState,
  terminateProcess,
  writeRuntimeState,
} from "./lifecycle.ts";

export interface PreparedSession {
  session: string;
  ephemeral: boolean;
  profileDir: string;
  runtimePath: string;
  profile: ProfileConfig;
  reused?: { cdpUrl: string; pid: number };
}

export async function prepareSessionLaunch(
  storageRoot: string,
  ephemeralRootInput: string | undefined,
  sessionInput: string,
): Promise<PreparedSession> {
  const session = assertValidAccount(sessionInput);
  const ephemeralRoot = ephemeralRootInput ?? getDefaultEphemeralRoot();
  const savedProfile = readProfileConfig(storageRoot, session);

  if (savedProfile !== null) {
    const profileDir = getProfileDir(storageRoot, session);
    const runtimePath = getRuntimeStatePath(storageRoot, session);
    const existing = readRuntimeState(runtimePath);
    if (existing && isProcessAlive(existing.pid) && (await isCdpUrlReachable(existing.cdpUrl))) {
      return {
        session,
        ephemeral: false,
        profileDir,
        runtimePath,
        profile: savedProfile,
        reused: existing,
      };
    }
    cleanupStaleLocks(profileDir, runtimePath);
    return {
      session,
      ephemeral: false,
      profileDir,
      runtimePath,
      profile: savedProfile,
    };
  }

  mkdirSync(ephemeralRoot, { recursive: true });
  const indexPath = getEphemeralIndexPath(ephemeralRoot, session);
  const existing = readRuntimeState(indexPath);
  if (
    existing &&
    existing.profileDir &&
    existsSync(existing.profileDir) &&
    isProcessAlive(existing.pid) &&
    (await isCdpUrlReachable(existing.cdpUrl))
  ) {
    return {
      session,
      ephemeral: true,
      profileDir: existing.profileDir,
      runtimePath: indexPath,
      profile: { fingerprint: generateFingerprint() },
      reused: { cdpUrl: existing.cdpUrl, pid: existing.pid },
    };
  }

  if (existing && isProcessAlive(existing.pid)) {
    throw new Error(
      `Ephemeral session "${session}" is already locked by running process ${existing.pid}.`,
    );
  }
  if (existing?.profileDir && existsSync(existing.profileDir)) {
    rmSync(existing.profileDir, { recursive: true, force: true });
  }
  rmSync(indexPath, { force: true });

  const profileDir = mkdtempSync(join(ephemeralRoot, `${session}-`));
  return {
    session,
    ephemeral: true,
    profileDir,
    runtimePath: indexPath,
    profile: { fingerprint: generateFingerprint() },
  };
}

export function saveSessionRuntime(
  prepared: PreparedSession,
  runtime: { pid: number; cdpUrl: string },
): void {
  writeRuntimeState(
    prepared.runtimePath,
    prepared.ephemeral ? { ...runtime, profileDir: prepared.profileDir } : runtime,
  );
}

export async function cleanupSessionOnClose(
  storageRoot: string,
  ephemeralRootInput: string | undefined,
  sessionInput: string,
  ephemeralDirFromCleanup?: string,
): Promise<void> {
  const session = assertValidAccount(sessionInput);
  const ephemeralRoot = ephemeralRootInput ?? getDefaultEphemeralRoot();

  const persistentDir = getProfileDir(storageRoot, session);
  const persistentRuntimePath = getRuntimeStatePath(storageRoot, session);
  const persistentRuntime = readRuntimeState(persistentRuntimePath);
  if (persistentRuntime && isProcessAlive(persistentRuntime.pid)) {
    await terminateProcess(persistentRuntime.pid);
  }
  if (existsSync(persistentDir)) {
    cleanupStaleLocks(persistentDir, persistentRuntimePath);
  }

  const indexPath = getEphemeralIndexPath(ephemeralRoot, session);
  const indexedRuntime = readRuntimeState(indexPath);
  if (indexedRuntime && isProcessAlive(indexedRuntime.pid)) {
    await terminateProcess(indexedRuntime.pid);
  }

  for (const dir of [indexedRuntime?.profileDir, ephemeralDirFromCleanup]) {
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  rmSync(indexPath, { force: true });
}
