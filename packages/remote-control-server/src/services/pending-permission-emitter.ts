import { log } from "../logger";
import {
  storeListPendingPermissions,
  storeRemovePendingPermission,
  type PendingPermissionRecord,
} from "../store";
import { publishSessionEvent } from "./transport";

export type { PendingPermissionRecord };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function listPendingPermissionsForSession(sessionId: string): PendingPermissionRecord[] {
  if (!isNonEmptyString(sessionId)) {
    log(`[pending-permission-emitter] listPendingPermissionsForSession: invalid sessionId`);
    return [];
  }
  return storeListPendingPermissions(sessionId);
}

export function removePendingPermission(
  sessionId: string,
  requestId: string,
): boolean {
  if (!isNonEmptyString(sessionId)) {
    log(`[pending-permission-emitter] removePendingPermission: invalid sessionId`);
    return false;
  }
  if (!isNonEmptyString(requestId)) {
    log(`[pending-permission-emitter] removePendingPermission: invalid requestId`);
    return false;
  }
  log(`[pending-permission-emitter] removePendingPermission sessionId=${sessionId} requestId=${requestId}`);
  return storeRemovePendingPermission(sessionId, requestId);
}

export function replayPendingPermissionsToBus(
  sessionId: string,
  alreadyReplayedRequestIds: Set<string>,
): Array<{ event: ReturnType<typeof publishSessionEvent>; requestId: string }> {
  if (!isNonEmptyString(sessionId)) {
    log(`[pending-permission-emitter] replayPendingPermissionsToBus: invalid sessionId`);
    return [];
  }

  const pending = listPendingPermissionsForSession(sessionId);
  const results: Array<{ event: ReturnType<typeof publishSessionEvent>; requestId: string }> = [];

  for (const perm of pending) {
    if (alreadyReplayedRequestIds.has(perm.requestId)) continue;
    if (!isNonEmptyString(perm.requestId)) continue;

    const event = publishSessionEvent(sessionId, "permission_request", perm.payload, "outbound");
    results.push({ event, requestId: perm.requestId });
  }

  return results;
}