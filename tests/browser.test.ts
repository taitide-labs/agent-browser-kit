import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProcessAlive } from "@/browser/lifecycle.ts";
import { getProfileDir } from "@/config/paths.ts";
import { writeKitConfig } from "@/kernel/manager.ts";
import { createOrUpdateProfile } from "@/profile/store.ts";
import { handlePluginRequest } from "@/protocol/router.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "abk-browser-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("browser lifecycle and session isolation", () => {
  test("manages persistent profiles and mkdtempSync ephemeral sessions", async () => {
    const root = makeTempDir();
    const ephemeralRoot = join(root, "ephemeral");
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const fakeBrowser = join(root, "fake-chrome.sh");
      writeFileSync(
        fakeBrowser,
        `#!/bin/sh
ARGS_LOG="${root}/launched-args.txt"
printf '%s\n' "$@" > "$ARGS_LOG"
for arg in "$@"; do
  case "$arg" in
    --user-data-dir=*) DIR="\${arg#--user-data-dir=}" ;;
  esac
done
printf '${port}\n/devtools/browser/test\n' > "$DIR/DevToolsActivePort"
sleep 30
`,
        "utf8",
      );
      chmodSync(fakeBrowser, 0o755);
      writeKitConfig(root, {
        kernel: { version: "148.0.7778.215", executablePath: fakeBrowser, platform: "macos" },
        defaults: { "--mute-audio": true },
      });

      createOrUpdateProfile(root, { account: "verify-01", "--hide-scrollbars": null });
      const profileDir = getProfileDir(root, "verify-01");
      mkdirSync(profileDir, { recursive: true });
      symlinkSync("localhost-9999999", join(profileDir, "SingletonLock"));

      const launch1 = await handlePluginRequest(
        { storageRoot: root, ephemeralRoot },
        {
          protocol: "agent-browser.plugin.v1",
          type: "browser.launch",
          capability: "browser.provider",
          request: {
            provider: "kit",
            session: "verify-01",
            launchOptions: { headed: true },
          },
        },
      );
      expect(launch1.success).toBe(true);
      expect(launch1.browser?.cdpUrl).toBe(`ws://127.0.0.1:${port}/devtools/browser/test`);
      expect(launch1.browser?.cleanup).toEqual({ sessionId: "verify-01" });

      const spawnedPid = Number(launch1.browser?.metadata.pid);
      expect(isProcessAlive(spawnedPid)).toBe(true);
      const argsLog = readFileSync(join(root, "launched-args.txt"), "utf8");
      expect(argsLog).toContain("--fingerprint-brand=Chrome");
      expect(argsLog).toContain("--fingerprint-platform=macos");
      expect(argsLog).toContain("--mute-audio");
      expect(argsLog).not.toContain("--hide-scrollbars");
      expect(argsLog).not.toContain("--headless=new");

      const launch2 = await handlePluginRequest(
        { storageRoot: root, ephemeralRoot },
        {
          protocol: "agent-browser.plugin.v1",
          type: "browser.launch",
          capability: "browser.provider",
          request: { provider: "kit", session: "verify-01", launchOptions: {} },
        },
      );
      expect(launch2.success).toBe(true);
      expect(launch2.browser?.metadata.pid).toBe(spawnedPid);

      const closed = await handlePluginRequest(
        { storageRoot: root, ephemeralRoot },
        {
          protocol: "agent-browser.plugin.v1",
          type: "browser.close",
          capability: "browser.provider",
          request: { sessionId: "verify-01" },
        },
      );
      expect(closed.success).toBe(true);
      expect(isProcessAlive(spawnedPid)).toBe(false);
      expect(existsSync(profileDir)).toBe(true);

      const ephemeralLaunch = await handlePluginRequest(
        { storageRoot: root, ephemeralRoot },
        {
          protocol: "agent-browser.plugin.v1",
          type: "browser.launch",
          capability: "browser.provider",
          request: {
            provider: "kit",
            session: "temp-session",
            launchOptions: { headed: false },
          },
        },
      );
      expect(ephemeralLaunch.success).toBe(true);
      expect(existsSync(getProfileDir(root, "temp-session"))).toBe(false);
      const ephemeralDir = ephemeralLaunch.browser?.cleanup.ephemeralDir;
      expect(typeof ephemeralDir).toBe("string");
      expect(ephemeralDir?.startsWith(join(ephemeralRoot, "temp-session-"))).toBe(true);
      expect(existsSync(ephemeralDir!)).toBe(true);

      const ephemeralReuse = await handlePluginRequest(
        { storageRoot: root, ephemeralRoot },
        {
          protocol: "agent-browser.plugin.v1",
          type: "browser.launch",
          capability: "browser.provider",
          request: { provider: "kit", session: "temp-session", launchOptions: {} },
        },
      );
      expect(ephemeralReuse.success).toBe(true);
      expect(ephemeralReuse.browser?.metadata.pid).toBe(ephemeralLaunch.browser?.metadata.pid);
      expect(ephemeralReuse.browser?.cleanup.ephemeralDir).toBe(ephemeralDir);

      const tempPid = Number(ephemeralLaunch.browser?.metadata.pid);
      const ephemeralClose = await handlePluginRequest(
        { storageRoot: root, ephemeralRoot },
        {
          protocol: "agent-browser.plugin.v1",
          type: "browser.close",
          capability: "browser.provider",
          request: ephemeralLaunch.browser?.cleanup,
        },
      );
      expect(ephemeralClose.success).toBe(true);
      expect(isProcessAlive(tempPid)).toBe(false);
      expect(existsSync(ephemeralDir!)).toBe(false);
    } finally {
      server.close();
    }
  });
});
