import type { ArgOverrideMap, LaunchOptions, ProfileConfig } from "@/protocol/types.ts";
import { buildUpstreamChromeArgs, type UpstreamEnv } from "./upstream-args.ts";

export type ChromiumArgLayer = string[] | ArgOverrideMap;

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

export function buildKitOverrideMap(
  profileDir: string,
  profile: ProfileConfig,
  kitOverrides?: ArgOverrideMap,
): ArgOverrideMap {
  return {
    "--user-data-dir": profileDir,
    "--fingerprint": String(profile.fingerprint),
    "--fingerprint-brand": "Chrome",
    "--window-size": profile.windowSize ?? DEFAULT_WINDOW_SIZE,
    ...(profile.proxy !== undefined ? { "--proxy-server": profile.proxy } : {}),
    ...(profile.timezone !== undefined ? { "--timezone": profile.timezone } : {}),
    ...(profile.lang !== undefined ? { "--lang": profile.lang } : {}),
    ...(profile.acceptLang !== undefined ? { "--accept-lang": profile.acceptLang } : {}),
    ...(profile.platform !== undefined ? { "--fingerprint-platform": profile.platform } : {}),
    ...profile.argOverrides,
    ...kitOverrides,
  };
}

export function buildCliOverrideLayers(launchOptions: LaunchOptions): ChromiumArgLayer[] {
  const layers: ChromiumArgLayer[] = [];
  const optionMap: ArgOverrideMap = {};

  if (launchOptions.userAgent !== undefined) {
    optionMap["--user-agent"] = launchOptions.userAgent;
  }
  if (launchOptions.proxy !== undefined) {
    optionMap["--proxy-server"] = launchOptions.proxy;
  }
  if (launchOptions.windowSize !== undefined) {
    optionMap["--window-size"] = launchOptions.windowSize;
  }
  if (Object.keys(optionMap).length > 0) {
    layers.push(optionMap);
  }
  if (launchOptions.argOverrides) {
    layers.push(launchOptions.argOverrides);
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

export function buildChromiumArgs(
  profileDir: string,
  profile: ProfileConfig,
  launchOptions: LaunchOptions,
  upstreamEnv?: UpstreamEnv,
  kitOverrides?: ArgOverrideMap,
): string[] {
  const upstreamArgs = buildUpstreamChromeArgs(
    {
      headless: !launchOptions.headed,
    },
    upstreamEnv,
  );
  const kitMap = buildKitOverrideMap(profileDir, profile, kitOverrides);
  const cliLayers = buildCliOverrideLayers(launchOptions);
  return mergeChromiumArgs(upstreamArgs, kitMap, ...cliLayers);
}
