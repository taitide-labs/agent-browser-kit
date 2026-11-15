import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConfigPath, getFingerprintPath, getProfileDir } from "@/config/paths.ts";
import { readKitConfig } from "@/config/store.ts";
import { generateFingerprint, MAX_FINGERPRINT_SEED } from "@/profile/store.ts";
import { handlePluginRequest } from "@/protocol/router.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "abk-protocol-test-"));
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

describe("plugin manifest, help, and profile commands", () => {
  test("returns kit manifest and rejects invalid account names", async () => {
    const root = makeTempDir();
    const manifest = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        type: "plugin.manifest",
        capability: "plugin.manifest",
        request: {},
      },
    );
    expect(manifest.success).toBe(true);
    expect(manifest.manifest?.name).toBe("kit");
    expect(manifest.manifest?.capabilities).toEqual(["browser.provider", "command.run"]);

    const invalid = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "profile.create",
        request: { account: "../escape" },
      },
    );
    expect(invalid.success).toBe(false);
    expect(invalid.error).toContain("Invalid account/session name");
  });

  test("creates, lists, and deletes profiles while rejecting duplicate creation", async () => {
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
          windowSize: "1440,900",
          "--disable-sync": null,
        },
      },
    );
    expect(created.success).toBe(true);
    const data = created.data as {
      account: string;
      fingerprint: number;
      proxy: string;
      "--disable-sync": null;
    };
    expect(data.account).toBe("acct-1");
    expect(data.fingerprint).toBeGreaterThanOrEqual(1);
    expect(data.fingerprint).toBeLessThanOrEqual(MAX_FINGERPRINT_SEED);
    expect(data["--disable-sync"]).toBeNull();
    expect(readFileSync(getFingerprintPath(root, "acct-1"), "utf8").trim()).toBe(
      String(data.fingerprint),
    );
    expect(
      (readKitConfig(root).profiles?.["acct-1"] as Record<string, unknown>)?.fingerprint,
    ).toBeUndefined();

    const duplicate = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "profile.create",
        request: { account: "acct-1", fingerprint: 100023, proxy: null },
      },
    );
    expect(duplicate.success).toBe(false);
    expect(duplicate.error).toBe('Profile "acct-1" already exists.');
    expect(readFileSync(getFingerprintPath(root, "acct-1"), "utf8").trim()).toBe(
      String(data.fingerprint),
    );
    expect(readKitConfig(root).profiles?.["acct-1"]?.proxy).toBe("http://127.0.0.1:7890");

    mkdirSync(getProfileDir(root, "orphan-1"), { recursive: true });
    const orphanDuplicate = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "profile.create",
        request: { account: "orphan-1" },
      },
    );
    expect(orphanDuplicate.success).toBe(false);
    expect(orphanDuplicate.error).toBe('Profile "orphan-1" already exists.');

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
    expect(readKitConfig(root).profiles).toBeUndefined();
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
      repository: string;
      config: string;
      capabilities?: unknown;
      protocol?: unknown;
      commands: Record<string, { description: string }>;
    };
    expect(data.plugin).toBe("kit");
    expect(data.repository).toBe("https://github.com/taitide-labs/agent-browser-kit");
    expect(data.config.endsWith("/config.json")).toBe(true);
    expect(data.capabilities).toBeUndefined();
    expect(data.protocol).toBeUndefined();
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

  test("generateFingerprint stays within signed 32-bit positive integer range", () => {
    for (let i = 0; i < 200; i += 1) {
      const seed = generateFingerprint();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(1);
      expect(seed).toBeLessThanOrEqual(2147483647);
    }
  });

  test("profile.create accepts optional fingerprint and rejects invalid values", async () => {
    const root = makeTempDir();

    const created = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "profile.create",
        request: { account: "seeded-1", fingerprint: 100023 },
      },
    );
    expect(created.success).toBe(true);
    expect((created.data as { fingerprint: number }).fingerprint).toBe(100023);
    expect(readFileSync(getFingerprintPath(root, "seeded-1"), "utf8").trim()).toBe("100023");
    expect(existsSync(getConfigPath(root))).toBe(false);

    const createdMax = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "profile.create",
        request: { account: "seeded-max", fingerprint: MAX_FINGERPRINT_SEED },
      },
    );
    expect(createdMax.success).toBe(true);
    expect((createdMax.data as { fingerprint: number }).fingerprint).toBe(MAX_FINGERPRINT_SEED);
    expect(readFileSync(getFingerprintPath(root, "seeded-max"), "utf8").trim()).toBe(
      String(MAX_FINGERPRINT_SEED),
    );

    for (const invalidFingerprint of [0, -1, 2147483648, 1.5, "100023", null]) {
      const rejected = await handlePluginRequest(
        { storageRoot: root },
        {
          protocol: "agent-browser.plugin.v1",
          capability: "command.run",
          type: "profile.create",
          request: { account: "seeded-invalid", fingerprint: invalidFingerprint },
        },
      );
      expect(rejected.success).toBe(false);
      expect(rejected.error).toContain("Invalid fingerprint for profile");
    }

    mkdirSync(getProfileDir(root, "corrupt"), { recursive: true });
    writeFileSync(getFingerprintPath(root, "corrupt"), "2147483648\n", "utf8");
    const listed = await handlePluginRequest(
      { storageRoot: root },
      {
        protocol: "agent-browser.plugin.v1",
        capability: "command.run",
        type: "profile.list",
        request: {},
      },
    );
    expect(listed.success).toBe(false);
    expect(listed.error).toContain("Invalid fingerprint for profile");
  });
});
