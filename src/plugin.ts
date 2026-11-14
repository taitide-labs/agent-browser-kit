import { getProfileDir, getRuntimeStatePath, assertValidAccount } from "./paths.ts";
import {
  buildChromiumArgs,
  cleanupStaleLocks,
  isCdpUrlReachable,
  isProcessAlive,
  launchChromiumProcess,
  readRuntimeState,
  terminateProcess,
  writeRuntimeState,
} from "./process.ts";
import { createOrUpdateProfile, deleteProfile, ensureProfile, listProfiles } from "./profile.ts";
import {
  getKernelStatus,
  installKernel,
  requireActiveKernelPath,
  upgradeKernel,
  type KernelDeps,
} from "./kernel.ts";
import type { LaunchOptions, PluginRequest, PluginResponse } from "./types.ts";

const PROTOCOL = "agent-browser.plugin.v1" as const;

export interface PluginContext {
  storageRoot: string;
  kernelDeps?: KernelDeps;
}

function fail(message: string): PluginResponse {
  return {
    protocol: PROTOCOL,
    success: false,
    error: message,
  };
}

function launchSuccess(session: string, cdpUrl: string, pid: number): PluginResponse {
  return {
    protocol: PROTOCOL,
    success: true,
    browser: {
      cdpUrl,
      directPage: false,
      metadata: { sessionId: session, pid },
      // agent-browser only invokes browser.close when cleanup.sessionId is returned on launch.
      cleanup: { sessionId: session },
    },
  };
}

async function handleBrowserLaunch(
  ctx: PluginContext,
  request: Record<string, unknown>,
): Promise<PluginResponse> {
  const session = assertValidAccount(String(request.session ?? ""));
  const executablePath = requireActiveKernelPath(ctx.storageRoot);
  const runtimePath = getRuntimeStatePath(ctx.storageRoot, session);
  const existing = readRuntimeState(runtimePath);
  if (existing && isProcessAlive(existing.pid) && (await isCdpUrlReachable(existing.cdpUrl))) {
    return launchSuccess(session, existing.cdpUrl, existing.pid);
  }

  const profileDir = getProfileDir(ctx.storageRoot, session);
  const profile = ensureProfile(ctx.storageRoot, session);
  cleanupStaleLocks(profileDir, runtimePath);

  const launchOptions = (request.launchOptions ?? {}) as LaunchOptions;
  const args = buildChromiumArgs(profileDir, profile, launchOptions);
  const runtime = await launchChromiumProcess(executablePath, profileDir, args);
  writeRuntimeState(runtimePath, runtime);
  return launchSuccess(session, runtime.cdpUrl, runtime.pid);
}

async function handleBrowserClose(
  ctx: PluginContext,
  request: Record<string, unknown>,
): Promise<PluginResponse> {
  const session = assertValidAccount(String(request.sessionId ?? request.session ?? ""));
  const runtimePath = getRuntimeStatePath(ctx.storageRoot, session);
  const profileDir = getProfileDir(ctx.storageRoot, session);
  const runtime = readRuntimeState(runtimePath);
  if (runtime && isProcessAlive(runtime.pid)) {
    await terminateProcess(runtime.pid);
  }
  cleanupStaleLocks(profileDir, runtimePath);
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
