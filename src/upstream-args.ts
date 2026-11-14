import { existsSync, readFileSync, statfsSync } from "node:fs";

export interface UpstreamLaunchOptions {
  headless?: boolean;
  hideScrollbars?: boolean;
  useRealKeychain?: boolean;
  webmcp?: boolean;
  webgpu?: boolean;
  restrictWebrtc?: boolean;
  ignoreHttpsErrors?: boolean;
  allowFileAccess?: boolean;
  extensions?: string[];
  proxy?: string;
  proxyBypass?: string;
  viewportSize?: [number, number];
  args?: string[];
}

export interface UpstreamEnv {
  platform?: NodeJS.Platform;
  ci?: boolean;
  isRoot?: boolean;
  inContainer?: boolean;
  devShmAvailableBytes?: number | null;
}

const DEFAULT_ENABLE_FEATURES = ["NetworkService", "NetworkServiceInProcess"];
const WEBMCP_FEATURES = ["WebMCPTesting", "DevToolsWebMCPSupport"];

export const UPSTREAM_BASE_ARGS = [
  "--remote-debugging-port=0",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-backgrounding-occluded-windows",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-hang-monitor",
  "--disable-popup-blocking",
  "--disable-prompt-on-repost",
  "--disable-sync",
  "--disable-features=Translate",
  "--metrics-recording-only",
] as const;

function detectInContainer(): boolean {
  if (existsSync("/.dockerenv") || existsSync("/run/.containerenv")) {
    return true;
  }
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf8");
    return cgroup.includes("docker") || cgroup.includes("kubepods") || cgroup.includes("lxc");
  } catch {
    return false;
  }
}

function detectDevShmAvailableBytes(platform: NodeJS.Platform): number | null {
  if (platform !== "linux") {
    return null;
  }
  try {
    const stat = statfsSync("/dev/shm");
    return stat.bavail * stat.bsize;
  } catch {
    return null;
  }
}

function shouldDisableSandbox(args: string[], env: UpstreamEnv): boolean {
  if (args.includes("--no-sandbox")) {
    return false;
  }
  if (env.ci ?? process.env.CI !== undefined) {
    return true;
  }
  if (env.isRoot ?? (typeof process.getuid === "function" && process.getuid() === 0)) {
    return true;
  }
  return env.inContainer ?? (existsSync("/.dockerenv") || existsSync("/run/.containerenv"));
}

function shouldDisableDevShm(args: string[], env: UpstreamEnv): boolean {
  if (args.includes("--disable-dev-shm-usage")) {
    return false;
  }
  const platform = env.platform ?? process.platform;
  const devShmBytes =
    env.devShmAvailableBytes !== undefined
      ? env.devShmAvailableBytes
      : detectDevShmAvailableBytes(platform);
  if (devShmBytes !== null) {
    return devShmBytes < 128 * 1024 * 1024;
  }
  if (env.ci ?? process.env.CI !== undefined) {
    return true;
  }
  if (env.isRoot ?? (typeof process.getuid === "function" && process.getuid() === 0)) {
    return true;
  }
  return env.inContainer ?? detectInContainer();
}

export function buildUpstreamChromeArgs(
  options: UpstreamLaunchOptions = {},
  env: UpstreamEnv = {},
): string[] {
  const platform = env.platform ?? process.platform;
  const enableFeatures = [...DEFAULT_ENABLE_FEATURES];
  if (options.webmcp ?? true) {
    enableFeatures.push(...WEBMCP_FEATURES);
  }
  if (options.webgpu && platform === "linux") {
    enableFeatures.push("Vulkan");
  }

  const userArgs: string[] = [];
  for (const arg of options.args ?? []) {
    if (arg.startsWith("--enable-features=")) {
      const values = arg.slice("--enable-features=".length);
      for (const feature of values
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)) {
        if (!enableFeatures.includes(feature)) {
          enableFeatures.push(feature);
        }
      }
    } else {
      userArgs.push(arg);
    }
  }

  const args: string[] = [
    ...UPSTREAM_BASE_ARGS.slice(0, 12),
    `--enable-features=${enableFeatures.join(",")}`,
    UPSTREAM_BASE_ARGS[12],
  ];

  if (options.webgpu) {
    args.push("--enable-unsafe-webgpu");
    if (platform === "linux") {
      args.push(
        "--use-angle=vulkan",
        "--use-vulkan=swiftshader",
        "--use-webgpu-adapter=swiftshader",
        "--disable-vulkan-surface",
      );
    }
  }

  if (!options.useRealKeychain) {
    args.push("--password-store=basic", "--use-mock-keychain");
  }

  const hasExtensions = Boolean(options.extensions && options.extensions.length > 0);
  const effectivelyHeadless = (options.headless ?? true) && !hasExtensions;

  if (effectivelyHeadless) {
    args.push("--headless=new");
    if (options.hideScrollbars ?? true) {
      args.push("--hide-scrollbars");
    }
    args.push("--enable-unsafe-swiftshader");
  }

  if (options.proxy) {
    const trimmed = options.proxy.replace(/\/+$/, "");
    const server = !trimmed || options.proxy.endsWith("://") ? options.proxy : trimmed;
    args.push(`--proxy-server=${server}`);
  }

  if (options.proxyBypass) {
    args.push(`--proxy-bypass-list=${options.proxyBypass}`);
  }

  if (options.ignoreHttpsErrors) {
    args.push("--ignore-certificate-errors");
  }

  if (options.allowFileAccess) {
    args.push("--allow-file-access-from-files", "--allow-file-access");
  }

  if (options.extensions && options.extensions.length > 0) {
    const extList = options.extensions.join(",");
    args.push(`--load-extension=${extList}`, `--disable-extensions-except=${extList}`);
  }

  const hasWindowSize = userArgs.some(
    (arg) => arg.startsWith("--start-maximized") || arg.startsWith("--window-size="),
  );
  if (!hasWindowSize && effectivelyHeadless) {
    const [w, h] = options.viewportSize ?? [1280, 720];
    args.push(`--window-size=${w},${h}`);
  }

  args.push(...userArgs);

  if (options.restrictWebrtc) {
    const filtered = args.filter((arg) => !arg.startsWith("--force-webrtc-ip-handling-policy="));
    args.length = 0;
    args.push(...filtered, "--force-webrtc-ip-handling-policy=disable_non_proxied_udp");
  }

  if (shouldDisableSandbox(args, env)) {
    args.push("--no-sandbox");
  }

  if (shouldDisableDevShm(args, env)) {
    args.push("--disable-dev-shm-usage");
  }

  return args;
}
