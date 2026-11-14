export type PlatformKey = "darwin" | "linux-x64";

export interface KernelEntry {
  version: string;
  assetName: string;
  url: string;
}

export interface KernelManifestEntry {
  version: string;
  asset: string;
}

export interface KernelManifest {
  repo: string;
  platforms: Record<PlatformKey, KernelManifestEntry>;
}

export interface ActiveKernel {
  version: string;
  executablePath: string;
}

export interface KitConfig {
  kernel?: ActiveKernel;
}

export type ArgOverrideValue = string | boolean | null | undefined;
export type ArgOverrideMap = Record<string, ArgOverrideValue>;

export interface ProfileConfig {
  fingerprint: number;
  proxy?: string;
  timezone?: string;
  lang?: string;
  acceptLang?: string;
  platform?: string;
  windowSize?: string;
  argOverrides?: ArgOverrideMap;
}

export interface RuntimeState {
  pid: number;
  cdpUrl: string;
  profileDir?: string;
}

export interface LaunchOptions {
  engine?: string | null;
  headed?: boolean | null;
  colorScheme?: string | null;
  userAgent?: string | null;
  proxy?: string | null;
  windowSize?: string | null;
  argOverrides?: ArgOverrideMap | null;
  args?: string[] | null;
}

export interface PluginRequest {
  protocol: string;
  type: string;
  capability?: string;
  request?: Record<string, unknown>;
}

export interface PluginResponse {
  protocol: "agent-browser.plugin.v1";
  success: boolean;
  error?: string;
  manifest?: {
    name: string;
    capabilities: string[];
    description?: string;
  };
  browser?: {
    cdpUrl: string;
    directPage: boolean;
    metadata: Record<string, unknown>;
    cleanup: {
      sessionId: string;
      ephemeralDir?: string;
    };
  };
  data?: unknown;
}
