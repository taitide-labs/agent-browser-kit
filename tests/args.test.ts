import { describe, expect, test } from "bun:test";
import { buildChromiumArgs, mergeChromiumArgs } from "@/browser/args.ts";

const CLEAN_ENV = {
  platform: "darwin" as const,
  ci: false,
  isRoot: false,
  inContainer: false,
  devShmAvailableBytes: null,
};

describe("chromium arg layering and null deletion", () => {
  test("mirrors upstream defaults and derives headless 1080p screen-info", () => {
    const args = buildChromiumArgs(
      "/tmp/profiles/a1",
      { fingerprint: 123456 },
      { headed: false },
      CLEAN_ENV,
      undefined,
      "macos",
    );
    expect(args).toContain("--user-data-dir=/tmp/profiles/a1");
    expect(args).toContain("--no-startup-window");
    expect(args).toContain("--remote-debugging-port=0");
    expect(args).toContain("--no-first-run");
    expect(args).toContain("--no-default-browser-check");
    expect(args).toContain("--disable-background-networking");
    expect(args).toContain("--disable-component-update");
    expect(args).toContain("--disable-sync");
    expect(args).toContain(
      "--enable-features=NetworkService,NetworkServiceInProcess,WebMCPTesting,DevToolsWebMCPSupport",
    );
    expect(args).toContain("--password-store=basic");
    expect(args).toContain("--use-mock-keychain");
    expect(args).toContain("--headless=new");
    expect(args).toContain("--hide-scrollbars");
    expect(args).toContain("--enable-unsafe-swiftshader");
    expect(args).toContain("--fingerprint=123456");
    expect(args).toContain("--fingerprint-brand=Chrome");
    expect(args).toContain("--fingerprint-platform=macos");
    expect(args).toContain("--screen-info={1920x1080}");
    expect(args.filter((arg) => arg.startsWith("--window-size="))).toEqual([
      "--window-size=1920,1080",
    ]);
  });

  test("enforces CLI > Profile > Global > Kit > Upstream priority and unions enable-features", () => {
    const args = buildChromiumArgs(
      "/tmp/profiles/a1",
      {
        fingerprint: 123456,
        proxy: "socks5://127.0.0.1:1080",
        timezone: "UTC",
        lang: "en-US",
        acceptLang: "en-US,en",
        windowSize: "1280,800",
        "--mute-audio": true,
      },
      {
        headed: false,
        userAgent: "CustomUA",
        proxy: "http://127.0.0.1:9999",
        args: ["--window-size=1600,900", "--enable-features=CustomFeature"],
      },
      CLEAN_ENV,
      {
        proxy: "http://127.0.0.1:8888",
        timezone: "Asia/Shanghai",
        "--fingerprint-platform": "linux",
      },
      "macos",
    );
    expect(args.filter((arg) => arg.startsWith("--window-size="))).toEqual([
      "--window-size=1600,900",
    ]);
    expect(args).toContain("--screen-info={1600x900}");
    expect(args.filter((arg) => arg.startsWith("--proxy-server="))).toEqual([
      "--proxy-server=http://127.0.0.1:9999",
    ]);
    expect(args).toContain(
      "--enable-features=NetworkService,NetworkServiceInProcess,WebMCPTesting,DevToolsWebMCPSupport,CustomFeature",
    );
    expect(args).toContain("--user-agent=CustomUA");
    expect(args).toContain("--timezone=UTC");
    expect(args).toContain("--lang=en-US");
    expect(args).toContain("--accept-lang=en-US,en");
    expect(args).toContain("--fingerprint-platform=linux");
    expect(args).toContain("--mute-audio");
  });

  test("deletes lower-layer args when null is explicitly passed instead of falling back", () => {
    const kitDeleted = buildChromiumArgs(
      "/tmp/profiles/a1",
      {
        fingerprint: 123456,
        "--hide-scrollbars": null,
        "--disable-sync": null,
        "--no-startup-window": null,
        "--screen-info": null,
      },
      {
        headed: false,
        windowSize: null,
        proxy: null,
        "--enable-unsafe-swiftshader": null,
      },
      CLEAN_ENV,
    );
    expect(kitDeleted).not.toContain("--hide-scrollbars");
    expect(kitDeleted).not.toContain("--disable-sync");
    expect(kitDeleted).not.toContain("--no-startup-window");
    expect(kitDeleted).not.toContain("--enable-unsafe-swiftshader");
    expect(kitDeleted.some((arg) => arg.startsWith("--window-size="))).toBe(false);
    expect(kitDeleted.some((arg) => arg.startsWith("--screen-info="))).toBe(false);
    expect(kitDeleted.some((arg) => arg.startsWith("--proxy-server="))).toBe(false);

    const directMerge = mergeChromiumArgs(["--foo=1", "--bar"], { "--foo": null, "--bar": false });
    expect(directMerge).toEqual([]);
  });

  test("respects headed mode without screen-info and CI sandbox/shm flags", () => {
    const headedArgs = buildChromiumArgs(
      "/tmp/profiles/a1",
      { fingerprint: 123456 },
      { headed: true },
      { ...CLEAN_ENV, ci: true },
    );
    expect(headedArgs).not.toContain("--headless=new");
    expect(headedArgs).not.toContain("--enable-unsafe-swiftshader");
    expect(headedArgs.some((arg) => arg.startsWith("--screen-info="))).toBe(false);
    expect(headedArgs).toContain("--window-size=1920,1080");
    expect(headedArgs).toContain("--no-sandbox");
    expect(headedArgs).toContain("--disable-dev-shm-usage");
  });
});
