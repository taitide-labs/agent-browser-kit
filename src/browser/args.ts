import type {
  ArgOverrideValue,
  BrowserDefaultsConfig,
  LaunchOptions,
  ProfileConfig,
} from "@/protocol/types.ts";
import { buildUpstreamChromeArgs, type UpstreamEnv } from "./upstream-args.ts";

export type ChromiumArgLayer = string[] | Record<string, ArgOverrideValue>;

const DEFAULT_WINDOW_SIZE = "1920,1080";

function normalizeFlagKey(rawKey: string): string {
  const prefixed = rawKey.startsWith("--") ? rawKey : `--${rawKey}`;
  if (prefixed === "--headless" || prefixed.startsWith("--headless=")) {
    return "--headless";
  }
  const eqIndex = prefixed.indexOf("=");
  return eqIndex > 2 ? prefixed.slice(0, eqIndex) : prefixed;
}

function getArgKey(flag: string): string {
  if (flag === "--headless" || flag.startsWith("--headless=")) {
    return "--headless";
  }
  const eqIndex = flag.indexOf("=");
  if (flag.startsWith("--") && eqIndex > 2) {
    return flag.slice(0, eqIndex);
  }
  return flag;
}

function removeFlagByKey(
  merged: string[],
  key: string,
  enabledFeatures: string[],
  featureSlotIndex: number,
): number {
  let nextSlotIndex = featureSlotIndex;
  const existingIndex = merged.findIndex((item) => getArgKey(item) === key);
  if (existingIndex !== -1) {
    merged.splice(existingIndex, 1);
    if (existingIndex === nextSlotIndex) {
      enabledFeatures.length = 0;
      nextSlotIndex = -1;
    } else if (existingIndex < nextSlotIndex) {
      nextSlotIndex -= 1;
    }
  }
  return nextSlotIndex;
}

function setEnableFeatures(
  merged: string[],
  rawFeatures: string,
  enabledFeatures: string[],
  featureSlotIndex: number,
): number {
  const items = rawFeatures
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const item of items) {
    if (!enabledFeatures.includes(item)) {
      enabledFeatures.push(item);
    }
  }
  if (featureSlotIndex === -1) {
    const nextIndex = merged.length;
    merged.push(`--enable-features=${enabledFeatures.join(",")}`);
    return nextIndex;
  }
  merged[featureSlotIndex] = `--enable-features=${enabledFeatures.join(",")}`;
  return featureSlotIndex;
}

export function mergeChromiumArgs(...layers: ChromiumArgLayer[]): string[] {
  const merged: string[] = [];
  const enabledFeatures: string[] = [];
  let featureSlotIndex = -1;

  for (const layer of layers) {
    if (Array.isArray(layer)) {
      for (const rawFlag of layer) {
        const flag = rawFlag.trim();
        if (!flag) {
          continue;
        }
        if (flag.startsWith("--enable-features=")) {
          featureSlotIndex = setEnableFeatures(
            merged,
            flag.slice("--enable-features=".length),
            enabledFeatures,
            featureSlotIndex,
          );
          continue;
        }
        const key = getArgKey(flag);
        featureSlotIndex = removeFlagByKey(merged, key, enabledFeatures, featureSlotIndex);
        merged.push(flag);
      }
      continue;
    }

    for (const [rawKey, value] of Object.entries(layer)) {
      if (value === undefined) {
        continue;
      }
      const key = normalizeFlagKey(rawKey.trim());
      if (value === null || value === false) {
        featureSlotIndex = removeFlagByKey(merged, key, enabledFeatures, featureSlotIndex);
        continue;
      }
      if (key === "--enable-features" && typeof value === "string") {
        featureSlotIndex = setEnableFeatures(merged, value, enabledFeatures, featureSlotIndex);
        continue;
      }
      featureSlotIndex = removeFlagByKey(merged, key, enabledFeatures, featureSlotIndex);
      merged.push(value === true ? key : `${key}=${value}`);
    }
  }

  return merged;
}

function settingsToArgLayer(settings?: BrowserDefaultsConfig): Record<string, ArgOverrideValue> {
  if (!settings) {
    return {};
  }
  const layer: Record<string, ArgOverrideValue> = {
    ...(settings.proxy !== undefined ? { "--proxy-server": settings.proxy } : {}),
    ...(settings.timezone !== undefined ? { "--timezone": settings.timezone } : {}),
    ...(settings.lang !== undefined ? { "--lang": settings.lang } : {}),
    ...(settings.acceptLang !== undefined ? { "--accept-lang": settings.acceptLang } : {}),
    ...(settings.windowSize !== undefined ? { "--window-size": settings.windowSize } : {}),
  };
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("--") && value !== undefined) {
      layer[key] = value as ArgOverrideValue;
    }
  }
  return layer;
}

function buildCliOverrideLayers(launchOptions: LaunchOptions): ChromiumArgLayer[] {
  const layers: ChromiumArgLayer[] = [];
  const optionMap: Record<string, ArgOverrideValue> = {};

  if (launchOptions.userAgent !== undefined) {
    optionMap["--user-agent"] = launchOptions.userAgent;
  }
  if (launchOptions.proxy !== undefined) {
    optionMap["--proxy-server"] = launchOptions.proxy;
  }
  if (launchOptions.windowSize !== undefined) {
    optionMap["--window-size"] = launchOptions.windowSize;
  }
  for (const [key, value] of Object.entries(launchOptions)) {
    if (key.startsWith("--") && value !== undefined) {
      optionMap[key] = value as ArgOverrideValue;
    }
  }
  if (Object.keys(optionMap).length > 0) {
    layers.push(optionMap);
  }
  if (Array.isArray(launchOptions.args)) {
    const rawArgs = launchOptions.args
      .filter((arg): arg is string => typeof arg === "string")
      .map((arg) => arg.trim())
      .filter(Boolean);
    if (rawArgs.length > 0) {
      layers.push(rawArgs);
    }
  }

  return layers;
}

function hasExplicitFlag(layers: ChromiumArgLayer[], targetKey: string): boolean {
  for (const layer of layers) {
    if (Array.isArray(layer)) {
      if (layer.some((flag) => getArgKey(flag.trim()) === targetKey)) {
        return true;
      }
      continue;
    }
    for (const [rawKey, value] of Object.entries(layer)) {
      if (value !== undefined && normalizeFlagKey(rawKey.trim()) === targetKey) {
        return true;
      }
    }
  }
  return false;
}

export function buildChromiumArgs(
  profileDir: string,
  profile: ProfileConfig,
  launchOptions: LaunchOptions,
  upstreamEnv?: UpstreamEnv,
  globalDefaults?: BrowserDefaultsConfig,
  kernelPlatform?: string,
  kitOverrides?: Record<string, ArgOverrideValue>,
): string[] {
  const upstreamArgs = buildUpstreamChromeArgs({ headless: !launchOptions.headed }, upstreamEnv);
  const kitLayer: Record<string, ArgOverrideValue> = {
    "--user-data-dir": profileDir,
    "--fingerprint": String(profile.fingerprint),
    "--fingerprint-brand": "Chrome",
    "--window-size": DEFAULT_WINDOW_SIZE,
    ...(kernelPlatform ? { "--fingerprint-platform": kernelPlatform } : {}),
    ...kitOverrides,
  };
  const globalLayer = settingsToArgLayer(globalDefaults);
  const profileLayer = settingsToArgLayer(profile);
  const cliLayers = buildCliOverrideLayers(launchOptions);
  const upperLayers: ChromiumArgLayer[] = [globalLayer, profileLayer, ...cliLayers];
  const merged = mergeChromiumArgs(upstreamArgs, kitLayer, ...upperLayers);

  if (!launchOptions.headed && !hasExplicitFlag(upperLayers, "--screen-info")) {
    const windowSizeArg = merged.find((arg) => /^--window-size=(\d+),(\d+)$/.test(arg));
    const match = windowSizeArg?.match(/^--window-size=(\d+),(\d+)$/);
    if (match) {
      merged.push(`--screen-info={${match[1]}x${match[2]}}`);
    }
  }

  return merged;
}
