import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ACCOUNT_PATTERN = /^[\p{L}\p{N}_-]+$/u;

export function getDefaultStorageRoot(): string {
  return join(homedir(), ".local", "share", "agent-browser-kit");
}

export function getDefaultEphemeralRoot(): string {
  return join(tmpdir(), "agent-browser-kit");
}

export function getConfigPath(storageRoot: string): string {
  return join(storageRoot, "config.json");
}

export function getKernelsDir(storageRoot: string): string {
  return join(storageRoot, "kernels");
}

export function getTempDir(storageRoot: string): string {
  return join(storageRoot, "tmp");
}

export function getProfilesDir(storageRoot: string): string {
  return join(storageRoot, "profiles");
}

export function assertValidAccount(account: string): string {
  if (!account || !ACCOUNT_PATTERN.test(account)) {
    throw new Error(
      `Invalid account/session name "${account}": must contain only letters, numbers, hyphens, or underscores.`,
    );
  }
  return account;
}

export function getProfileDir(storageRoot: string, account: string): string {
  return join(getProfilesDir(storageRoot), assertValidAccount(account));
}

export function getFingerprintPath(storageRoot: string, account: string): string {
  return join(getProfileDir(storageRoot, account), "fp.json");
}

export function getRuntimeStatePath(storageRoot: string, account: string): string {
  return join(getProfileDir(storageRoot, account), "runtime.json");
}

export function getEphemeralIndexPath(ephemeralRoot: string, account: string): string {
  return join(ephemeralRoot, `${assertValidAccount(account)}.runtime.json`);
}
