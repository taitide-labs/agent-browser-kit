import pkg from "../../package.json";
import { buildChromiumArgs } from "@/browser/args.ts";
import { launchChromiumProcess } from "@/browser/lifecycle.ts";
import {
  cleanupSessionOnClose,
  prepareSessionLaunch,
  saveSessionRuntime,
} from "@/browser/session.ts";
import {
  getKernelStatus,
  installKernel,
  requireActiveKernelPath,
  upgradeKernel,
  type KernelDeps,
} from "@/kernel/manager.ts";
import { createOrUpdateProfile, deleteProfile, listProfiles } from "@/profile/store.ts";
import type { LaunchOptions, PluginRequest, PluginResponse } from "./types.ts";

const PROTOCOL = "agent-browser.plugin.v1" as const;

const COMMAND_HELP = {
  help: {
    description: "List available plugin commands and payload schemas.",
    payload: {
      command: "string (optional)",
    },
    example: "agent-browser plugin run kit help",
  },
  "profile.create": {
    description: "Create or update an isolated account profile and fingerprint.",
    payload: {
      account: "string (required)",
      proxy: "string | null (optional)",
      timezone: "string | null (optional)",
      lang: "string | null (optional)",
      acceptLang: "string | null (optional)",
      platform: "string | null (optional)",
      windowSize: "string | null (optional)",
      argOverrides: "Record<string, string | boolean | null> | null (optional)",
      regenerate: "boolean (optional)",
    },
    example:
      'agent-browser plugin run kit profile.create --payload \'{"account":"account-01","proxy":"http://127.0.0.1:7890"}\'',
  },
  "profile.list": {
    description: "List stored account profiles and running status.",
    payload: {},
    example: "agent-browser plugin run kit profile.list",
  },
  "profile.delete": {
    description: "Stop any running browser for the account and delete its profile directory.",
    payload: {
      account: "string (required)",
    },
    example: 'agent-browser plugin run kit profile.delete --payload \'{"account":"account-01"}\'',
  },
  "kernel.install": {
    description: "Download and activate the fingerprint-chromium kernel if not already installed.",
    payload: {
      version: "string (optional)",
    },
    example: "agent-browser plugin run kit kernel.install",
  },
  "kernel.upgrade": {
    description: "Install the kernel if missing, or upgrade to a newer release from upstream.",
    payload: {
      version: "string (optional)",
    },
    example: "agent-browser plugin run kit kernel.upgrade",
  },
  "kernel.status": {
    description: "Show the currently active kernel version and executable path.",
    payload: {},
    example: "agent-browser plugin run kit kernel.status",
  },
} as const;

function getHelpData(payload: Record<string, unknown>): Record<string, unknown> {
  const requested = typeof payload.command === "string" ? payload.command.trim() : "";
  if (requested) {
    const spec = COMMAND_HELP[requested as keyof typeof COMMAND_HELP];
    if (!spec) {
      throw new Error(`Unsupported plugin command: ${requested}`);
    }
    return {
      plugin: "kit",
      version: pkg.version,
      command: requested,
      ...spec,
    };
  }
  return {
    plugin: "kit",
    version: pkg.version,
    protocol: PROTOCOL,
    capabilities: ["browser.provider", "command.run"],
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
  const executablePath = requireActiveKernelPath(ctx.storageRoot);
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
  const args = buildChromiumArgs(prepared.profileDir, prepared.profile, launchOptions);
  const runtime = await launchChromiumProcess(executablePath, prepared.profileDir, args);
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
        data: getHelpData(payload),
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
