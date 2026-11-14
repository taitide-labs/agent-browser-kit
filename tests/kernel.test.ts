import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareVersions,
  readKitConfig,
  resolveManifestEntry,
  type KernelDeps,
} from "@/kernel/manager.ts";
import { handlePluginRequest } from "@/protocol/router.ts";
import type { KernelManifest } from "@/protocol/types.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "abk-kernel-test-"));
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
      asset: "ungoogled-chromium_{version}-1.1_macos.dmg",
    },
    "linux-x64": {
      version: "150.0.7871.186",
      asset: "ungoogled-chromium-{version}-1-x86_64_linux.tar.xz",
    },
  },
};

function makeFakeKernelDeps(
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

describe("kernel.install and kernel.upgrade", () => {
  test("resolveManifestEntry builds assetName and download url from version and template", () => {
    expect(resolveManifestEntry(TEST_MANIFEST.repo, TEST_MANIFEST.platforms.darwin)).toEqual({
      version: "148.0.7778.215",
      assetName: "ungoogled-chromium_148.0.7778.215-1.1_macos.dmg",
      url: "https://github.com/adryfish/fingerprint-chromium/releases/download/148.0.7778.215/ungoogled-chromium_148.0.7778.215-1.1_macos.dmg",
    });
  });

  test("compareVersions compares dotted numeric segments", () => {
    expect(compareVersions("150.0.7871.186", "148.0.7778.215")).toBe(1);
    expect(compareVersions("148.0.7778.215", "150.0.7871.186")).toBe(-1);
    expect(compareVersions("150.0.7871.186", "150.0.7871.186")).toBe(0);
  });

  test("kernel.install downloads when missing and skips when already installed", async () => {
    const root = makeTempDir();
    const { deps, downloads } = makeFakeKernelDeps([
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
    expect(downloads).toEqual([
      "https://github.com/adryfish/fingerprint-chromium/releases/download/150.0.7871.186/ungoogled-chromium-150.0.7871.186-1-x86_64_linux.tar.xz",
    ]);

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
    const { deps, downloads } = makeFakeKernelDeps(cloud);

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
