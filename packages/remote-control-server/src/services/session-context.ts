/**
 * Session context for per-request isolation using AsyncLocalStorage.
 *
 * RCS uses in-process route handlers that may share state between concurrent
 * sessions. Each subprocess is already isolated, but in-process state needs
 * AsyncLocalStorage to prevent session state from leaking across concurrent
 * requests.
 *
 * This is similar to src/utils/agentContext.ts but for session-level isolation.
 */

import { AsyncLocalStorage } from "async_hooks";

/**
 * Context for the current session request.
 */
export type SessionContext = {
  /** The session ID for this request */
  sessionId: string;
  /** The owner UUID (from auth token) */
  ownerUuid: string;
};

const sessionContextStorage = new AsyncLocalStorage<SessionContext>();

/**
 * Get the current session context, if any.
 * Returns undefined if not running within a session context.
 */
export function getCurrentSessionContext(): SessionContext | undefined {
  return sessionContextStorage.getStore();
}

/**
 * Run an async function with the given session context.
 * All async operations within the function will have access to this context.
 */
export function runWithSessionContext<T>(
  sessionId: string,
  ownerUuid: string,
  fn: () => T,
): T {
  return sessionContextStorage.run({ sessionId, ownerUuid }, fn);
}

/**
 * Get the current session ID, if any.
 * Convenience helper when you only need the sessionId.
 */
export function getCurrentSessionId(): string | undefined {
  return sessionContextStorage.getStore()?.sessionId;
}