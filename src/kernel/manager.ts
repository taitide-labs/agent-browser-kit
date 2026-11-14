import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getConfigPath, getKernelsDir, getTempDir } from "@/config/paths.ts";
import type {
  KernelEntry,
  KernelManifest,
  KernelManifestEntry,
  KitConfig,
  PlatformKey,
} from "@/protocol/types.ts";
import manifestJson from "../../kernel-manifest.json" with { type: "json" };

const DEFAULT_MANIFEST = manifestJson as KernelManifest;

export function resolveManifestEntry(repo: string, entry: KernelManifestEntry): KernelEntry {
  const assetName = entry.asset.replaceAll("{version}", entry.version);
  return {
    version: entry.version,
    assetName,
    url: `https://github.com/${repo}/releases/download/${encodeURIComponent(entry.version)}/${assetName}`,
  };
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface KernelDeps {
  platform?: NodeJS.Platform;
  arch?: string;
  manifest?: KernelManifest;
  fetchFn?: typeof fetch;
  runCommand?: (cmd: string[]) => Promise<CommandResult>;
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GitHubReleaseAsset[];
}

export function resolvePlatformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): PlatformKey {
  if (platform === "darwin") {
    return "darwin";
  }
  if (platform === "linux" && arch === "x64") {
    return "linux-x64";
  }
  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

export function compareVersions(a: string, b: string): number {
  const partsA = a
    .replace(/^v/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  const partsB = b
    .replace(/^v/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) {
      return numA > numB ? 1 : -1;
    }
  }
  return 0;
}

export function readKitConfig(storageRoot: string): KitConfig {
  const path = getConfigPath(storageRoot);
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8")) as KitConfig;
}

export function writeKitConfig(storageRoot: string, config: KitConfig): void {
  mkdirSync(storageRoot, { recursive: true });
  writeFileSync(getConfigPath(storageRoot), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function matchReleaseAsset(
  assets: GitHubReleaseAsset[],
  platformKey: PlatformKey,
): GitHubReleaseAsset | null {
  if (platformKey === "darwin") {
    return assets.find((a) => /macos\.dmg$/i.test(a.name)) ?? null;
  }
  return assets.find((a) => /(?:x86_64|amd64)[_-]linux\.tar\.xz$/i.test(a.name)) ?? null;
}

async function defaultRunCommand(cmd: string[]): Promise<CommandResult> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export async function fetchCloudRelease(
  repo: string,
  platformKey: PlatformKey,
  targetVersion?: string,
  fetchFn: typeof fetch = fetch,
): Promise<KernelEntry> {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "agent-browser-kit",
  };
  if (targetVersion) {
    const res = await fetchFn(
      `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(targetVersion)}`,
      { headers },
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch release "${targetVersion}": HTTP ${res.status}`);
    }
    const release = (await res.json()) as GitHubRelease;
    const asset = matchReleaseAsset(release.assets ?? [], platformKey);
    if (!asset) {
      throw new Error(`Release "${targetVersion}" has no compatible asset for ${platformKey}.`);
    }
    return {
      version: release.tag_name,
      assetName: asset.name,
      url: asset.browser_download_url,
    };
  }

  const res = await fetchFn(`https://api.github.com/repos/${repo}/releases?per_page=15`, {
    headers,
  });
  if (!res.ok) {
    throw new Error(`Failed to list releases for ${repo}: HTTP ${res.status}`);
  }
  const releases = (await res.json()) as GitHubRelease[];
  const candidates: KernelEntry[] = [];
  for (const release of releases) {
    if (release.draft || release.prerelease) {
      continue;
    }
    const asset = matchReleaseAsset(release.assets ?? [], platformKey);
    if (asset) {
      candidates.push({
        version: release.tag_name,
        assetName: asset.name,
        url: asset.browser_download_url,
      });
    }
  }
  if (candidates.length === 0) {
    throw new Error(`No compatible release found for ${platformKey} in ${repo}.`);
  }
  candidates.sort((a, b) => compareVersions(b.version, a.version));
  return candidates[0]!;
}

async function downloadFile(url: string, destPath: string, fetchFn: typeof fetch): Promise<void> {
  const res = await fetchFn(url, {
    headers: { "User-Agent": "agent-browser-kit" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}): ${url}`);
  }
  const buffer = await res.arrayBuffer();
  writeFileSync(destPath, new Uint8Array(buffer));
}

function findMacOsAppExecutable(appDir: string): string {
  const macOsDir = join(appDir, "Contents", "MacOS");
  if (!existsSync(macOsDir)) {
    throw new Error(`Invalid macOS app bundle: missing ${macOsDir}`);
  }
  const preferred = ["Chromium", "Google Chrome", "chrome", "chromium"];
  for (const candidate of preferred) {
    const full = join(macOsDir, candidate);
    if (existsSync(full) && statSync(full).isFile()) {
      return full;
    }
  }
  const files = readdirSync(macOsDir).filter((name) => statSync(join(macOsDir, name)).isFile());
  const first = files[0];
  if (!first) {
    throw new Error(`No executable found inside ${macOsDir}`);
  }
  return join(macOsDir, first);
}

function findLinuxExecutable(kernelDir: string): string {
  for (const candidate of ["chrome", "chromium", "chromium-browser"]) {
    const full = join(kernelDir, candidate);
    if (existsSync(full) && statSync(full).isFile()) {
      return full;
    }
  }
  throw new Error(`No browser executable found in ${kernelDir}`);
}

async function extractKernelArchive(
  archivePath: string,
  kernelDir: string,
  platformKey: PlatformKey,
  runCommand: (cmd: string[]) => Promise<CommandResult>,
): Promise<string> {
  rmSync(kernelDir, { recursive: true, force: true });
  mkdirSync(kernelDir, { recursive: true });

  if (platformKey === "darwin") {
    const mountDir = mkdtempSync(join(kernelDir, ".mnt-"));
    try {
      const attach = await runCommand([
        "hdiutil",
        "attach",
        archivePath,
        "-nobrowse",
        "-readonly",
        "-mountpoint",
        mountDir,
      ]);
      if (attach.exitCode !== 0) {
        throw new Error(`hdiutil attach failed: ${attach.stderr || attach.stdout}`);
      }
      const apps = readdirSync(mountDir).filter((name) => name.endsWith(".app"));
      const appName = apps[0];
      if (!appName) {
        throw new Error(`No .app bundle found inside ${archivePath}`);
      }
      const targetApp = join(kernelDir, appName);
      const copy = await runCommand(["ditto", join(mountDir, appName), targetApp]);
      if (copy.exitCode !== 0) {
        throw new Error(`ditto failed: ${copy.stderr || copy.stdout}`);
      }
      await runCommand(["xattr", "-dr", "com.apple.quarantine", targetApp]);
      return findMacOsAppExecutable(targetApp);
    } finally {
      await runCommand(["hdiutil", "detach", mountDir, "-force"]);
      rmSync(mountDir, { recursive: true, force: true });
    }
  }

  const extract = await runCommand([
    "tar",
    "-xJf",
    archivePath,
    "-C",
    kernelDir,
    "--strip-components=1",
  ]);
  if (extract.exitCode !== 0) {
    throw new Error(`tar extract failed: ${extract.stderr || extract.stdout}`);
  }
  const executablePath = findLinuxExecutable(kernelDir);
  chmodSync(executablePath, 0o755);
  return executablePath;
}

async function downloadAndActivateKernel(
  storageRoot: string,
  entry: KernelEntry,
  platformKey: PlatformKey,
  fetchFn: typeof fetch,
  runCommand: (cmd: string[]) => Promise<CommandResult>,
): Promise<string> {
  const tempRoot = getTempDir(storageRoot);
  mkdirSync(tempRoot, { recursive: true });
  const archivePath = join(tempRoot, entry.assetName);
  const kernelDir = join(getKernelsDir(storageRoot), entry.version);
  try {
    await downloadFile(entry.url, archivePath, fetchFn);
    const executablePath = await extractKernelArchive(
      archivePath,
      kernelDir,
      platformKey,
      runCommand,
    );
    const config = readKitConfig(storageRoot);
    config.kernel = { version: entry.version, executablePath };
    writeKitConfig(storageRoot, config);
    return executablePath;
  } finally {
    rmSync(archivePath, { force: true });
  }
}

export function getKernelStatus(storageRoot: string): {
  installed: boolean;
  version: string | null;
  executablePath: string | null;
} {
  const config = readKitConfig(storageRoot);
  const path = config.kernel?.executablePath ?? null;
  const installed = path !== null && existsSync(path);
  return {
    installed,
    version: installed ? (config.kernel?.version ?? null) : null,
    executablePath: installed ? path : null,
  };
}

export function requireActiveKernelPath(storageRoot: string): string {
  const status = getKernelStatus(storageRoot);
  if (!status.installed || !status.executablePath) {
    throw new Error("Kernel is not installed. Run: agent-browser plugin run kit kernel.install");
  }
  return status.executablePath;
}

export async function installKernel(
  storageRoot: string,
  payload: Record<string, unknown> = {},
  deps: KernelDeps = {},
): Promise<{
  installed: boolean;
  alreadyInstalled: boolean;
  version: string;
  executablePath: string;
}> {
  const current = getKernelStatus(storageRoot);
  if (current.installed && current.executablePath && current.version) {
    return {
      installed: false,
      alreadyInstalled: true,
      version: current.version,
      executablePath: current.executablePath,
    };
  }

  const platformKey = resolvePlatformKey(deps.platform, deps.arch);
  const manifest = deps.manifest ?? DEFAULT_MANIFEST;
  const fetchFn = deps.fetchFn ?? fetch;
  const runCommand = deps.runCommand ?? defaultRunCommand;
  const requestedVersion =
    typeof payload.version === "string" && payload.version.trim()
      ? payload.version.trim()
      : undefined;

  const entry = requestedVersion
    ? await fetchCloudRelease(manifest.repo, platformKey, requestedVersion, fetchFn)
    : resolveManifestEntry(manifest.repo, manifest.platforms[platformKey]);

  const executablePath = await downloadAndActivateKernel(
    storageRoot,
    entry,
    platformKey,
    fetchFn,
    runCommand,
  );
  return {
    installed: true,
    alreadyInstalled: false,
    version: entry.version,
    executablePath,
  };
}

export async function upgradeKernel(
  storageRoot: string,
  payload: Record<string, unknown> = {},
  deps: KernelDeps = {},
): Promise<{
  upgraded: boolean;
  installed: boolean;
  version: string;
  previousVersion: string | null;
  executablePath: string;
}> {
  const platformKey = resolvePlatformKey(deps.platform, deps.arch);
  const manifest = deps.manifest ?? DEFAULT_MANIFEST;
  const fetchFn = deps.fetchFn ?? fetch;
  const runCommand = deps.runCommand ?? defaultRunCommand;
  const requestedVersion =
    typeof payload.version === "string" && payload.version.trim()
      ? payload.version.trim()
      : undefined;

  const current = getKernelStatus(storageRoot);
  const cloudEntry = await fetchCloudRelease(manifest.repo, platformKey, requestedVersion, fetchFn);

  if (
    current.installed &&
    current.version &&
    current.executablePath &&
    ((!requestedVersion && compareVersions(cloudEntry.version, current.version) <= 0) ||
      cloudEntry.version === current.version)
  ) {
    return {
      upgraded: false,
      installed: false,
      version: current.version,
      previousVersion: current.version,
      executablePath: current.executablePath,
    };
  }

  const previousVersion = current.version;
  const executablePath = await downloadAndActivateKernel(
    storageRoot,
    cloudEntry,
    platformKey,
    fetchFn,
    runCommand,
  );

  if (previousVersion && previousVersion !== cloudEntry.version) {
    rmSync(join(getKernelsDir(storageRoot), previousVersion), { recursive: true, force: true });
  }

  return {
    upgraded: previousVersion !== null,
    installed: previousVersion === null,
    version: cloudEntry.version,
    previousVersion,
    executablePath,
  };
}
