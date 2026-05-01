/**
 * Execution mode boundaries for managed-web vs remote-control.
 *
 * Managed Web: New hybrid platform with UUID auth and web client sessions.
 *             Web client calls /api/* and /web/* endpoints.
 * Remote Control: Legacy RC API with API key auth and CLI bridge sessions.
 *                CLI bridge calls /v1/* and /v2/* endpoints.
 *
 * This module prevents RC assumptions from leaking into managed-web routes.
 * Routes that MUST NOT use process.cwd() fallback should assert mode === 'managed-web'.
 */

import { feature } from "bun:bundle";

export type ExecutionMode = "managed-web" | "remote-control";

export interface ModeContext {
  mode: ExecutionMode;
  isManagedWeb: boolean;
  isRemoteControl: boolean;
}

const RC_ROUTE_PREFIXES = ["/v1/", "/v2/"];

const RC_FLAG_NAMES = ["BRIDGE_MODE", "DAEMON"] as const;

/**
 * Detect execution mode based on feature flags and route pattern.
 *
 * Detection priority:
 * 1. If any RC feature flag is set → remote-control mode
 * 2. If route matches /v1/* or /v2/* → remote-control mode
 * 3. Otherwise → managed-web mode
 */
export function detectMode(req: Request | { url: string }): ModeContext {
  const urlString = typeof req.url === "string" ? req.url : String(req.url);
  const pathname = new URL(urlString).pathname;

  const hasRcFlag = RC_FLAG_NAMES.some((flag) => feature(flag));

  if (hasRcFlag) {
    return {
      mode: "remote-control",
      isManagedWeb: false,
      isRemoteControl: true,
    };
  }

  const isRcRoute = RC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (isRcRoute) {
    return {
      mode: "remote-control",
      isManagedWeb: false,
      isRemoteControl: true,
    };
  }

  return {
    mode: "managed-web",
    isManagedWeb: true,
    isRemoteControl: false,
  };
}

/**
 * Assert that the current mode is managed-web.
 * Throws if called in remote-control context.
 *
 * Use this at the top of route handlers that MUST NOT use process.cwd() fallback.
 * In managed-web, the web client MUST provide explicit cwd.
 *
 * @example
 * ```ts
 * // api/some-route.ts
 * assertManagedWebMode(req); // dies if in RC mode
 * const cwd = req.query("cwd") || process.cwd(); // only reached in managed-web
 * ```
 */
export function assertManagedWebMode(req: Request | { url: string }): void {
  const ctx = detectMode(req);
  if (!ctx.isManagedWeb) {
    throw new Error(
      "This route is only available in managed-web mode. " +
        "Remote Control mode does not support implicit cwd fallback.",
    );
  }
}
