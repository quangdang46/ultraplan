import {
  resolveSessionWorkspacePaths,
  resolveWorkspaceLayout,
  type WorkspaceMaterializationStrategy,
} from "./workspace-paths";
import { resolveWorkspaceRoot } from "./workspace-root";

export function createConfig(env: NodeJS.ProcessEnv = process.env) {
  const workspace = resolveWorkspaceLayout(resolveWorkspaceRoot(env.RCS_WORKSPACE_ROOT));

  return {
    version: env.RCS_VERSION || "0.1.0",
    port: parseInt(env.RCS_PORT || "8080"),
    host: env.RCS_HOST || "0.0.0.0",
    apiKeys: (env.RCS_API_KEYS || "").split(",").filter(Boolean),
    baseUrl: env.RCS_BASE_URL || "",
    pollTimeout: parseInt(env.RCS_POLL_TIMEOUT || "8"),
    heartbeatInterval: parseInt(env.RCS_HEARTBEAT_INTERVAL || "20"),
    jwtExpiresIn: parseInt(env.RCS_JWT_EXPIRES_IN || "3600"),
    disconnectTimeout: parseInt(env.RCS_DISCONNECT_TIMEOUT || "300"),
    webCorsOrigins: (env.RCS_WEB_CORS_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    /** Bun WebSocket idle timeout (seconds). Bun sends protocol-level pings after
     *  this many seconds of no received data. Must be shorter than any reverse
     *  proxy's idle timeout (nginx default 60s, Cloudflare 100s). Default 30s. */
    wsIdleTimeout: parseInt(env.RCS_WS_IDLE_TIMEOUT || "30"),
    /** Server→client keep_alive data-frame interval (seconds). Keeps reverse
     *  proxies from closing idle connections. Default 20s. */
    wsKeepaliveInterval: parseInt(env.RCS_WS_KEEPALIVE_INTERVAL || "20"),
    workspaceRoot: workspace.root,
    workspace,
  } as const;
}

export type RcsConfig = ReturnType<typeof createConfig>;

export const config = createConfig();

export function getBaseUrl(currentConfig: Pick<RcsConfig, "baseUrl" | "port"> = config): string {
  const url = currentConfig.baseUrl || `http://localhost:${currentConfig.port}`;
  return url.replace(/\/+$/, "");
}

export function resolveManagedSessionPaths(
  sessionId: string,
  materializationStrategy: WorkspaceMaterializationStrategy = "worktree",
  currentConfig: Pick<RcsConfig, "workspaceRoot"> = config,
) {
  return resolveSessionWorkspacePaths({
    sessionId,
    root: currentConfig.workspaceRoot,
    materializationStrategy,
  });
}
