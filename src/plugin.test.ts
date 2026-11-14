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
import { compareVersions, readKitConfig, writeKitConfig, type KernelDeps } from "./kernel.ts";
import { getEphemeralSessionDir, getProfileDir } from "./paths.ts";
import { handlePluginRequest } from "./plugin.ts";
import { buildChromiumArgs, isProcessAlive } from "./process.ts";
import { createOrUpdateProfile } from "./profile.ts";
import type { KernelManifest } from "./types.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "abk-test-"));
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

const TEST_MANIFEST: KernelManifest = {
  repo: "adryfish/fingerprint-chromium",
  platforms: {
    darwin: {
      version: "148.0.7778.215",
      assetName: "ungoogled-chromium_148.0.7778.215-1.1_macos.dmg",
      url: "https://example.test/148/macos.dmg",
    },
    "linux-x64": {
      version: "150.0.7871.186",
      assetName: "ungoogled-chromium-150.0.7871.186-1-x86_64_linux.tar.xz",
      url: "https://example.test/150/linux.tar.xz",
    },
  },
};

function makeFakeKernelDeps(
  storageRoot: string,
  cloudReleases: Array<{
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  }>,
): { deps: KernelDeps; downloads: string[] } {
  const downloads: string[] = [];
  const deps: KernelDeps = {
    platform: "linux",
    arch: "x64",
    manifest: TEST_MANIFEST,
    fetchFn: (async (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/releases?")) {
        return new Response(JSON.stringify(cloudReleases), { status: 200 });
      }
      if (url.includes("/releases/tags/")) {
        const tag = decodeURIComponent(url.split("/releases/tags/")[1] ?? "");
        const hit = cloudReleases.find((r) => r.tag_name === tag);
        if (!hit) {
          return new Response("not found", { status: 404 });
        }
        return new Response(JSON.stringify(hit), { status: 200 });
      }
      downloads.push(url);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof fetch,
    runCommand: async (cmd: string[]) => {
      if (cmd[0] === "tar") {
        const cIndex = cmd.indexOf("-C");
        const destDir = cmd[cIndex + 1];
        if (!destDir) {
          return { exitCode: 1, stdout: "", stderr: "missing -C" };
        }
        mkdirSync(destDir, { recursive: true });
        const binPath = join(destDir, "chrome");
        writeFileSync(binPath, "#!/bin/sh\nexit 0\n", "utf8");
        chmodSync(binPath, 0o755);
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  return { deps, downloads };
}

describe("plugin.manifest and routing", () => {
  test("returns kit manifest", async () => {
    const root = makeTempDir();
    const res = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        type: "plugin.manifest",
        capability: "plugin.manifest",
        request: {},
      },
    );
    expect(res.success).toBe(true);
    expect(res.manifest?.name).toBe("kit");
    expect(res.manifest?.capabilities).toEqual(["browser.provider", "command.run"]);
  });

  test("rejects invalid account names", async () => {
    const root = makeTempDir();
    const res = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "profile.create",
        request: { account: "../escape" },
      },
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("Invalid account/session name");
  });
});

describe("kernel.install and kernel.upgrade", () => {
  test("compareVersions compares dotted numeric segments", () => {
    expect(compareVersions("150.0.7871.186", "148.0.7778.215")).toBe(1);
    expect(compareVersions("148.0.7778.215", "150.0.7871.186")).toBe(-1);
    expect(compareVersions("150.0.7871.186", "150.0.7871.186")).toBe(0);
  });

  test("kernel.install downloads when missing and skips when already installed", async () => {
    const root = makeTempDir();
    const { deps, downloads } = makeFakeKernelDeps(root, [
      {
        tag_name: "152.0.0.1",
        assets: [
          {
            name: "ungoogled-chromium-152.0.0.1-1-x86_64_linux.tar.xz",
            browser_download_url: "https://example.test/152/linux.tar.xz",
          },
        ],
      },
    ]);

    const first = await handlePluginRequest(
      { storageRoot: root, kernelDeps: deps },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "kernel.install",
        request: {},
      },
    );
    expect(first.success).toBe(true);
    expect(first.data).toMatchObject({
      installed: true,
      alreadyInstalled: false,
      version: "150.0.7871.186",
    });
    expect(downloads).toEqual(["https://example.test/150/linux.tar.xz"]);

    const second = await handlePluginRequest(
      { storageRoot: root, kernelDeps: deps },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "kernel.install",
        request: {},
      },
    );
    expect(second.success).toBe(true);
    expect(second.data).toMatchObject({
      installed: false,
      alreadyInstalled: true,
      version: "150.0.7871.186",
    });
    expect(downloads.length).toBe(1);
  });

  test("kernel.upgrade installs if missing and upgrades only when cloud has newer version", async () => {
    const root = makeTempDir();
    const cloud = [
      {
        tag_name: "150.0.7871.186",
        assets: [
          {
            name: "ungoogled-chromium-150.0.7871.186-1-x86_64_linux.tar.xz",
            browser_download_url: "https://example.test/150/linux.tar.xz",
          },
        ],
      },
    ];
    const { deps, downloads } = makeFakeKernelDeps(root, cloud);

    const first = await handlePluginRequest(
      { storageRoot: root, kernelDeps: deps },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "kernel.upgrade",
        request: {},
      },
    );
    expect(first.success).toBe(true);
    expect(first.data).toMatchObject({
      installed: true,
      upgraded: false,
      version: "150.0.7871.186",
    });
    expect(downloads).toEqual(["https://example.test/150/linux.tar.xz"]);

    const same = await handlePluginRequest(
      { storageRoot: root, kernelDeps: deps },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "kernel.upgrade",
        request: {},
      },
    );
    expect(same.success).toBe(true);
    expect(same.data).toMatchObject({
      upgraded: false,
      installed: false,
      version: "150.0.7871.186",
    });
    expect(downloads.length).toBe(1);

    cloud.unshift({
      tag_name: "151.0.8000.10",
      assets: [
        {
          name: "ungoogled-chromium-151.0.8000.10-1-x86_64_linux.tar.xz",
          browser_download_url: "https://example.test/151/linux.tar.xz",
        },
      ],
    });

    const upgraded = await handlePluginRequest(
      { storageRoot: root, kernelDeps: deps },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "kernel.upgrade",
        request: {},
      },
    );
    expect(upgraded.success).toBe(true);
    expect(upgraded.data).toMatchObject({
      upgraded: true,
      installed: false,
      version: "151.0.8000.10",
      previousVersion: "150.0.7871.186",
    });
    expect(downloads).toEqual([
      "https://example.test/150/linux.tar.xz",
      "https://example.test/151/linux.tar.xz",
    ]);
    expect(readKitConfig(root).kernel?.version).toBe("151.0.8000.10");
  });
});

describe("profile management and browser lifecycle", () => {
  test("creates, lists, updates, and deletes profiles", async () => {
    const root = makeTempDir();
    const created = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "profile.create",
        request: {
          account: "acct-1",
          proxy: "http://127.0.0.1:7890",
          timezone: "Asia/Tokyo",
          lang: "ja-JP",
          acceptLang: "ja-JP,ja",
          platform: "macos",
          windowSize: "1440,900",
        },
      },
    );
    expect(created.success).toBe(true);
    const data = created.data as { account: string; fingerprint: number; proxy: string };
    expect(data.account).toBe("acct-1");
    expect(data.fingerprint).toBeGreaterThanOrEqual(1);
    expect(data.fingerprint).toBeLessThanOrEqual(4294967295);

    const updated = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "profile.create",
        request: { account: "acct-1", proxy: null },
      },
    );
    expect((updated.data as { fingerprint: number; proxy?: string }).fingerprint).toBe(
      data.fingerprint,
    );
    expect((updated.data as { proxy?: string }).proxy).toBeUndefined();

    const listed = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "profile.list",
        request: {},
      },
    );
    expect(
      (listed.data as { profiles: Array<{ account: string }> }).profiles.map((p) => p.account),
    ).toEqual(["acct-1"]);

    const deleted = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "profile.delete",
        request: { account: "acct-1" },
      },
    );
    expect(deleted.data).toEqual({ account: "acct-1", deleted: true });
    expect(existsSync(getProfileDir(root, "acct-1"))).toBe(false);
  });

  test("builds layered Chromium args with CLI > Kit > Upstream priority and 1080p default", () => {
    const cleanEnv = {
      platform: "darwin" as const,
      ci: false,
      isRoot: false,
      inContainer: false,
      devShmAvailableBytes: null,
    };

    const defaultArgs = buildChromiumArgs(
      "/tmp/profiles/a1",
      { fingerprint: 123456 },
      { headed: false },
      cleanEnv,
    );
    expect(defaultArgs).toContain("--user-data-dir=/tmp/profiles/a1");
    expect(defaultArgs).toContain("--remote-debugging-port=0");
    expect(defaultArgs).toContain("--no-first-run");
    expect(defaultArgs).toContain("--no-default-browser-check");
    expect(defaultArgs).toContain("--disable-background-networking");
    expect(defaultArgs).toContain("--disable-component-update");
    expect(defaultArgs).toContain("--disable-sync");
    expect(defaultArgs).toContain(
      "--enable-features=NetworkService,NetworkServiceInProcess,WebMCPTesting,DevToolsWebMCPSupport",
    );
    expect(defaultArgs).toContain("--password-store=basic");
    expect(defaultArgs).toContain("--use-mock-keychain");
    expect(defaultArgs).toContain("--headless=new");
    expect(defaultArgs).toContain("--hide-scrollbars");
    expect(defaultArgs).toContain("--enable-unsafe-swiftshader");
    expect(defaultArgs).toContain("--fingerprint=123456");
    expect(defaultArgs).toContain("--fingerprint-brand=Chrome");
    expect(defaultArgs.filter((arg) => arg.startsWith("--window-size="))).toEqual([
      "--window-size=1920,1080",
    ]);

    const overriddenArgs = buildChromiumArgs(
      "/tmp/profiles/a1",
      {
        fingerprint: 123456,
        proxy: "socks5://127.0.0.1:1080",
        timezone: "UTC",
        lang: "en-US",
        acceptLang: "en-US,en",
        platform: "linux",
        windowSize: "1280,800",
      },
      {
        headed: false,
        userAgent: "CustomUA",
        proxy: "http://127.0.0.1:9999",
        args: ["--window-size=1600,900", "--enable-features=CustomFeature"],
      },
      cleanEnv,
    );
    expect(overriddenArgs.filter((arg) => arg.startsWith("--window-size="))).toEqual([
      "--window-size=1600,900",
    ]);
    expect(overriddenArgs.filter((arg) => arg.startsWith("--proxy-server="))).toEqual([
      "--proxy-server=http://127.0.0.1:9999",
    ]);
    expect(overriddenArgs).toContain(
      "--enable-features=NetworkService,NetworkServiceInProcess,WebMCPTesting,DevToolsWebMCPSupport,CustomFeature",
    );
    expect(overriddenArgs).toContain("--user-agent=CustomUA");
    expect(overriddenArgs).toContain("--timezone=UTC");
    expect(overriddenArgs).toContain("--lang=en-US");
    expect(overriddenArgs).toContain("--accept-lang=en-US,en");
    expect(overriddenArgs).toContain("--fingerprint-platform=linux");

    const headedArgs = buildChromiumArgs(
      "/tmp/profiles/a1",
      { fingerprint: 123456 },
      { headed: true },
      { ...cleanEnv, ci: true },
    );
    expect(headedArgs).not.toContain("--headless=new");
    expect(headedArgs).not.toContain("--enable-unsafe-swiftshader");
    expect(headedArgs).toContain("--window-size=1920,1080");
    expect(headedArgs).toContain("--no-sandbox");
    expect(headedArgs).toContain("--disable-dev-shm-usage");
  });

  test("launches, reuses, cleans stale locks, and closes mock browser process", async () => {
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
      writeKitConfig(root, { kernel: { version: "148.0.7778.215", executablePath: fakeBrowser } });

      createOrUpdateProfile(root, { account: "verify-01" });
      const profileDir = getProfileDir(root, "verify-01");
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
      expect(launch1.browser?.cleanup.sessionId).toBe("verify-01");

      const spawnedPid = Number(launch1.browser?.metadata.pid);
      expect(isProcessAlive(spawnedPid)).toBe(true);
      const argsLog = readFileSync(join(root, "launched-args.txt"), "utf8");
      expect(argsLog).toContain("--fingerprint-brand=Chrome");
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
      const tempSessionDir = getEphemeralSessionDir(ephemeralRoot, "temp-session");
      expect(existsSync(tempSessionDir)).toBe(true);

      const tempPid = Number(ephemeralLaunch.browser?.metadata.pid);
      const ephemeralClose = await handlePluginRequest(
        { storageRoot: root, ephemeralRoot },
        {
          protocol: "agent-browser.plugin.v1",
          type: "browser.close",
          capability: "browser.provider",
          request: { sessionId: "temp-session" },
        },
      );
      expect(ephemeralClose.success).toBe(true);
      expect(isProcessAlive(tempPid)).toBe(false);
      expect(existsSync(tempSessionDir)).toBe(false);
    } finally {
      server.close();
    }
  });

  test("returns structured command help for all commands or a single command", async () => {
    const root = makeTempDir();
    const allHelp = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        type: "help",
        capability: "command.run",
        request: {},
      },
    );
    expect(allHelp.success).toBe(true);
    const data = allHelp.data as {
      plugin: string;
      commands: Record<string, { description: string }>;
    };
    expect(data.plugin).toBe("kit");
    expect(Object.keys(data.commands)).toEqual([
      "help",
      "profile.create",
      "profile.list",
      "profile.delete",
      "kernel.install",
      "kernel.upgrade",
      "kernel.status",
    ]);

    const singleHelp = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        type: "command.run",
        capability: "command.run",
        request: { command: "help", payload: { command: "profile.create" } },
      },
    );
    expect(singleHelp.success).toBe(true);
    expect((singleHelp.data as { command: string }).command).toBe("profile.create");

    const invalidHelp = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        type: "help",
        capability: "command.run",
        request: { command: "unknown.cmd" },
      },
    );
    expect(invalidHelp.success).toBe(false);
    expect(invalidHelp.error).toContain("Unsupported plugin command");
  });
});
