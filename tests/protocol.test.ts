import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProfileDir } from "@/config/paths.ts";
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
