import { existsSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import type { LaunchOptions, ProfileConfig, RuntimeState } from "./types.ts";
import { buildUpstreamChromeArgs, type UpstreamEnv } from "./upstream-args.ts";

const DEFAULT_WINDOW_SIZE = "1920,1080";

const LOCK_FILES = [
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
  "DevToolsActivePort",
  "runtime.json",
];

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

export function isTcpReachable(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export async function isCdpUrlReachable(cdpUrl: string): Promise<boolean> {
  try {
    const url = new URL(cdpUrl);
    const port = Number(url.port);
    if (!Number.isInteger(port) || port <= 0) {
      return false;
    }
    return await isTcpReachable(url.hostname || "127.0.0.1", port);
  } catch {
    return false;
  }
}

export function readRuntimeState(runtimePath: string): RuntimeState | null {
  if (!existsSync(runtimePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(runtimePath, "utf8")) as Partial<RuntimeState>;
    if (typeof parsed.pid === "number" && typeof parsed.cdpUrl === "string") {
      return { pid: parsed.pid, cdpUrl: parsed.cdpUrl };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeRuntimeState(runtimePath: string, state: RuntimeState): void {
  writeFileSync(runtimePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function readSingletonLockPid(profileDir: string): number | null {
  const lockPath = join(profileDir, "SingletonLock");
  try {
    const target = readlinkSync(lockPath);
    const match = /-(\d+)$/.exec(target);
    if (!match?.[1]) {
      return null;
    }
    const pid = Number(match[1]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function cleanupStaleLocks(profileDir: string, runtimePath: string): void {
  const runtime = readRuntimeState(runtimePath);
  if (runtime && isProcessAlive(runtime.pid)) {
    throw new Error(`Profile "${profileDir}" is already locked by running process ${runtime.pid}.`);
  }
  const lockPid = readSingletonLockPid(profileDir);
  if (lockPid && isProcessAlive(lockPid)) {
    throw new Error(`Profile "${profileDir}" is already locked by running process ${lockPid}.`);
  }
  for (const file of LOCK_FILES) {
    rmSync(join(profileDir, file), { force: true });
  }
}

export async function terminateProcess(pid: number, timeoutMs = 5000): Promise<void> {
  if (!isProcessAlive(pid)) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await Bun.sleep(50);
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

function getFlagKey(flag: string): string {
  if (flag === "--headless" || flag.startsWith("--headless=")) {
    return "--headless";
  }
  const eqIndex = flag.indexOf("=");
  if (flag.startsWith("--") && eqIndex > 2) {
    return flag.slice(0, eqIndex);
  }
  return flag;
}

export function mergeChromiumArgs(...layers: string[][]): string[] {
  const merged: string[] = [];
  const enabledFeatures: string[] = [];
  let featureSlotIndex = -1;

  for (const layer of layers) {
    for (const rawFlag of layer) {
      const flag = rawFlag.trim();
      if (!flag) {
        continue;
      }
      if (flag.startsWith("--enable-features=")) {
        const items = flag
          .slice("--enable-features=".length)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        for (const item of items) {
          if (!enabledFeatures.includes(item)) {
            enabledFeatures.push(item);
          }
        }
        if (featureSlotIndex === -1) {
          featureSlotIndex = merged.length;
          merged.push(`--enable-features=${enabledFeatures.join(",")}`);
        } else {
          merged[featureSlotIndex] = `--enable-features=${enabledFeatures.join(",")}`;
        }
        continue;
      }

      const key = getFlagKey(flag);
      const existingIndex = merged.findIndex((item) => getFlagKey(item) === key);
      if (existingIndex !== -1) {
        merged.splice(existingIndex, 1);
        if (existingIndex < featureSlotIndex) {
          featureSlotIndex -= 1;
        }
      }
      merged.push(flag);
    }
  }

  return merged;
}

export function buildKitOverrideArgs(profileDir: string, profile: ProfileConfig): string[] {
  const args = [
    `--user-data-dir=${profileDir}`,
    `--fingerprint=${profile.fingerprint}`,
    "--fingerprint-brand=Chrome",
    `--window-size=${profile.windowSize ?? DEFAULT_WINDOW_SIZE}`,
  ];
  if (profile.proxy) {
    args.push(`--proxy-server=${profile.proxy}`);
  }
  if (profile.timezone) {
    args.push(`--timezone=${profile.timezone}`);
  }
  if (profile.lang) {
    args.push(`--lang=${profile.lang}`);
  }
  if (profile.acceptLang) {
    args.push(`--accept-lang=${profile.acceptLang}`);
  }
  if (profile.platform) {
    args.push(`--fingerprint-platform=${profile.platform}`);
  }
  return args;
}

export function buildCliOverrideArgs(launchOptions: LaunchOptions): string[] {
  const args: string[] = [];
  if (launchOptions.userAgent) {
    args.push(`--user-agent=${launchOptions.userAgent}`);
  }
  if (launchOptions.proxy) {
    args.push(`--proxy-server=${launchOptions.proxy}`);
  }
  if (Array.isArray(launchOptions.args)) {
    for (const arg of launchOptions.args) {
      if (typeof arg === "string" && arg.trim()) {
        args.push(arg.trim());
      }
    }
  }
  return args;
}

export function buildChromiumArgs(
  profileDir: string,
  profile: ProfileConfig,
  launchOptions: LaunchOptions,
  upstreamEnv?: UpstreamEnv,
): string[] {
  const upstreamArgs = buildUpstreamChromeArgs(
    {
      headless: !launchOptions.headed,
    },
    upstreamEnv,
  );
  const kitArgs = buildKitOverrideArgs(profileDir, profile);
  const cliArgs = buildCliOverrideArgs(launchOptions);
  return mergeChromiumArgs(upstreamArgs, kitArgs, cliArgs);
}

export async function launchChromiumProcess(
  executablePath: string,
  profileDir: string,
  args: string[],
  timeoutMs = 25000,
): Promise<RuntimeState> {
  // Detach and unref so Bun does not keep stdio handles open and stall agent-browser after exit.
  const proc = Bun.spawn([executablePath, ...args], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  });
  proc.unref();

  const portFile = join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(
        `Browser exited early with code ${proc.exitCode} before writing DevToolsActivePort.`,
      );
    }
    if (existsSync(portFile)) {
      const content = readFileSync(portFile, "utf8").trim();
      const [portStr, wsPath] = content.split(/\r?\n/);
      const port = Number(portStr);
      if (Number.isInteger(port) && port > 0 && wsPath?.startsWith("/")) {
        return {
          pid: proc.pid,
          cdpUrl: `ws://127.0.0.1:${port}${wsPath}`,
        };
      }
    }
    await Bun.sleep(50);
  }
  await terminateProcess(proc.pid, 2000);
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for DevToolsActivePort in ${profileDir}.`,
  );
}
