import pkg from "../../package.json";
import { buildChromiumArgs } from "@/browser/args.ts";
import { launchChromiumProcess } from "@/browser/lifecycle.ts";
import {
  cleanupSessionOnClose,
  prepareSessionLaunch,
  saveSessionRuntime,
} from "@/browser/session.ts";
import { getConfigPath } from "@/config/paths.ts";
import { readGlobalDefaults } from "@/config/store.ts";
import {
  getKernelStatus,
  installKernel,
  requireActiveKernel,
  upgradeKernel,
  type KernelDeps,
} from "@/kernel/manager.ts";
import { createOrUpdateProfile, deleteProfile, listProfiles } from "@/profile/store.ts";
import type { LaunchOptions, PluginRequest, PluginResponse } from "./types.ts";

const PROTOCOL = "agent-browser.plugin.v1" as const;
const REPOSITORY_URL = pkg.repository.url.replace(/\.git$/, "");

const COMMAND_HELP = {
  help: {
    description: "List commands (?command)",
    payload: {
      command: "string",
    },
  },
  "profile.create": {
    description: "Create or update profile & fingerprint",
    payload: {
      account: "string (required)",
      seed: "integer (1..2147483647)",
      proxy: "string | null",
      timezone: "string | null",
      lang: "string | null",
      acceptLang: "string | null",
      windowSize: "string | null",
      "--*": "string | boolean | null",
    },
  },
  "profile.list": {
    description: "List profiles and running status",
  },
  "profile.delete": {
    description: "Stop browser and delete profile",
    payload: {
      account: "string (required)",
    },
  },
  "kernel.install": {
    description: "Install kernel from manifest (?version)",
    payload: {
      version: "string",
    },
  },
  "kernel.upgrade": {
    description: "Upgrade kernel from upstream (?version)",
    payload: {
      version: "string",
    },
  },
  "kernel.status": {
    description: "Show active kernel status",
  },
} as const;

function getHelpData(
  storageRoot: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const requested = typeof payload.command === "string" ? payload.command.trim() : "";
  if (requested) {
    const spec = COMMAND_HELP[requested as keyof typeof COMMAND_HELP];
    if (!spec) {
      throw new Error(`Unsupported plugin command: ${requested}`);
    }
    return {
      plugin: "kit",
      version: pkg.version,
      repository: REPOSITORY_URL,
      command: requested,
      ...spec,
    };
  }
  return {
    plugin: "kit",
    version: pkg.version,
    repository: REPOSITORY_URL,
    config: getConfigPath(storageRoot),
    commands: COMMAND_HELP,
  };
}

export interface PluginContext {
  storageRoot: string;
  ephemeralRoot?: string;
  kernelDeps?: KernelDeps;
}

function fail(message: string): PluginResponse {
  return {
    protocol: PROTOCOL,
    success: false,
    error: message,
  };
}

function launchSuccess(
  session: string,
  cdpUrl: string,
  pid: number,
  ephemeralDir?: string,
): PluginResponse {
  return {
    protocol: PROTOCOL,
    success: true,
    browser: {
      cdpUrl,
      directPage: false,
      metadata: { sessionId: session, pid },
      // agent-browser only invokes browser.close when cleanup.sessionId is returned on launch.
      cleanup: ephemeralDir ? { sessionId: session, ephemeralDir } : { sessionId: session },
    },
  };
}

async function handleBrowserLaunch(
  ctx: PluginContext,
  request: Record<string, unknown>,
): Promise<PluginResponse> {
  const session = String(request.session ?? "");
  const kernel = requireActiveKernel(ctx.storageRoot);
  const prepared = await prepareSessionLaunch(ctx.storageRoot, ctx.ephemeralRoot, session);
  if (prepared.reused) {
    return launchSuccess(
      prepared.session,
      prepared.reused.cdpUrl,
      prepared.reused.pid,
      prepared.ephemeral ? prepared.profileDir : undefined,
    );
  }

  const launchOptions = (request.launchOptions ?? {}) as LaunchOptions;
  const globalDefaults = readGlobalDefaults(ctx.storageRoot);
  const args = buildChromiumArgs(
    prepared.profileDir,
    prepared.profile,
    launchOptions,
    undefined,
    globalDefaults,
    kernel.platform,
  );
  const runtime = await launchChromiumProcess(kernel.executablePath, prepared.profileDir, args);
  saveSessionRuntime(prepared, runtime);
  return launchSuccess(
    prepared.session,
    runtime.cdpUrl,
    runtime.pid,
    prepared.ephemeral ? prepared.profileDir : undefined,
  );
}

async function handleBrowserClose(
  ctx: PluginContext,
  request: Record<string, unknown>,
): Promise<PluginResponse> {
  const session = String(request.sessionId ?? request.session ?? "");
  const ephemeralDir = typeof request.ephemeralDir === "string" ? request.ephemeralDir : undefined;
  await cleanupSessionOnClose(ctx.storageRoot, ctx.ephemeralRoot, session, ephemeralDir);
  return {
    protocol: PROTOCOL,
    success: true,
  };
}

async function handleCommand(
  ctx: PluginContext,
  command: string,
  payload: Record<string, unknown>,
): Promise<PluginResponse> {
  switch (command) {
    case "help":
      return {
        protocol: PROTOCOL,
        success: true,
        data: getHelpData(ctx.storageRoot, payload),
      };
    case "profile.create":
      return {
        protocol: PROTOCOL,
        success: true,
        data: createOrUpdateProfile(ctx.storageRoot, payload),
      };
    case "profile.list":
      return {
        protocol: PROTOCOL,
        success: true,
        data: { profiles: listProfiles(ctx.storageRoot) },
      };
    case "profile.delete":
      return {
        protocol: PROTOCOL,
        success: true,
        data: await deleteProfile(ctx.storageRoot, String(payload.account ?? "")),
      };
    case "kernel.install":
      return {
        protocol: PROTOCOL,
        success: true,
        data: await installKernel(ctx.storageRoot, payload, ctx.kernelDeps),
      };
    case "kernel.upgrade":
      return {
        protocol: PROTOCOL,
        success: true,
        data: await upgradeKernel(ctx.storageRoot, payload, ctx.kernelDeps),
      };
    case "kernel.status":
      return {
        protocol: PROTOCOL,
        success: true,
        data: getKernelStatus(ctx.storageRoot),
      };
    default:
      return fail(`Unsupported plugin command: ${command}`);
  }
}

export async function handlePluginRequest(
  ctx: PluginContext,
  raw: unknown,
): Promise<PluginResponse> {
  try {
    if (!raw || typeof raw !== "object") {
      return fail("Invalid plugin request payload.");
    }
    const req = raw as Partial<PluginRequest>;
    if (req.protocol !== PROTOCOL) {
      return fail(`Unsupported protocol: ${String(req.protocol)}`);
    }
    const request = (req.request && typeof req.request === "object" ? req.request : {}) as Record<
      string,
      unknown
    >;

    if (req.type === "plugin.manifest") {
      return {
        protocol: PROTOCOL,
        success: true,
        manifest: {
          name: "kit",
          capabilities: ["browser.provider", "command.run"],
        },
      };
    }
    if (req.type === "browser.launch") {
      return await handleBrowserLaunch(ctx, request);
    }
    if (req.type === "browser.close") {
      return await handleBrowserClose(ctx, request);
    }
    if (req.type === "command.run") {
      const cmd = typeof request.command === "string" ? request.command : "";
      const payload =
        request.payload && typeof request.payload === "object"
          ? (request.payload as Record<string, unknown>)
          : request;
      return await handleCommand(ctx, cmd, payload);
    }
    if (req.capability === "command.run" && typeof req.type === "string") {
      return await handleCommand(ctx, req.type, request);
    }
    return fail(`Unsupported request type: ${String(req.type)}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
