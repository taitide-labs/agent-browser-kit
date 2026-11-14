import { existsSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import type { RuntimeState } from "@/protocol/types.ts";

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
      return {
        pid: parsed.pid,
        cdpUrl: parsed.cdpUrl,
        ...(typeof parsed.profileDir === "string" ? { profileDir: parsed.profileDir } : {}),
      };
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
