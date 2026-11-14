export type PlatformKey = "darwin" | "linux-x64";

export interface KernelEntry {
  version: string;
  assetName: string;
  url: string;
}

export interface KernelManifest {
  repo: string;
  platforms: Record<PlatformKey, KernelEntry>;
}

export interface ActiveKernel {
  version: string;
  executablePath: string;
}

export interface KitConfig {
  kernel?: ActiveKernel;
}

export interface ProfileConfig {
  fingerprint: number;
  proxy?: string;
  timezone?: string;
  lang?: string;
  acceptLang?: string;
  platform?: string;
  windowSize?: string;
}

export interface RuntimeState {
  pid: number;
  cdpUrl: string;
}

export interface LaunchOptions {
  engine?: string | null;
  headed?: boolean | null;
  colorScheme?: string | null;
  userAgent?: string | null;
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
  name?: string;
  capabilities?: string[];
  browser?: {
    cdpUrl: string;
    directPage: boolean;
    metadata: Record<string, unknown>;
    cleanup: {
      sessionId: string;
    };
  };
  data?: unknown;
}
