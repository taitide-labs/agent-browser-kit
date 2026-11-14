import { readFileSync, writeFileSync } from "node:fs";
import { compareVersions, fetchCloudRelease } from "./kernel.ts";
import type { KernelManifest, PlatformKey } from "./types.ts";

const MANIFEST_PATH = new URL("./kernel-manifest.json", import.meta.url);

export async function syncManifest(
  fetchFn: typeof fetch = fetch,
): Promise<{ updated: boolean; changes: string[]; manifest: KernelManifest }> {
  const current = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as KernelManifest;
  const next: KernelManifest = {
    repo: current.repo,
    platforms: { ...current.platforms },
  };
  const changes: string[] = [];

  for (const platformKey of Object.keys(current.platforms) as PlatformKey[]) {
    const prev = current.platforms[platformKey];
    const latest = await fetchCloudRelease(current.repo, platformKey, undefined, fetchFn);
    if (compareVersions(latest.version, prev.version) > 0) {
      next.platforms[platformKey] = latest;
      changes.push(`${platformKey}: ${prev.version} -> ${latest.version}`);
    }
  }

  if (changes.length > 0) {
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }
  return { updated: changes.length > 0, changes, manifest: next };
}

if (import.meta.main) {
  const result = await syncManifest();
  console.log(JSON.stringify(result));
}
