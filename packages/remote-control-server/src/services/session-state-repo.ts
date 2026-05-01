import { log } from "../logger";
import {
  storeGetSessionState,
  storeUpsertSessionState,
  type SessionStateRecord,
} from "../store";

export type { SessionStateRecord };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export interface SessionStatePatch {
  model?: string | null;
  permissionMode?: string | null;
  thinkingEffort?: string | null;
  selectedRepos?: string[] | null;
  commandProfile?: string | null;
}

export function getSessionState(sessionId: string): SessionStateRecord | null {
  if (!isNonEmptyString(sessionId)) {
    log(`[session-state-repo] getSessionState: invalid sessionId`);
    return null;
  }
  log(`[session-state-repo] getSessionState sessionId=${sessionId}`);
  return storeGetSessionState(sessionId) ?? null;
}

export function updateSessionState(
  sessionId: string,
  patch: SessionStatePatch,
): SessionStateRecord {
  if (!isNonEmptyString(sessionId)) {
    log(`[session-state-repo] updateSessionState: invalid sessionId`);
    throw new Error(`Invalid sessionId: must be a non-empty string`);
  }
  log(`[session-state-repo] updateSessionState sessionId=${sessionId}`);
  return storeUpsertSessionState(sessionId, {
    model: patch.model,
    permissionMode: patch.permissionMode,
    thinkingEffort: patch.thinkingEffort,
    selectedRepos: patch.selectedRepos,
    commandProfile: patch.commandProfile,
  });
}

export function getSessionModel(sessionId: string): string | null {
  if (!isNonEmptyString(sessionId)) {
    log(`[session-state-repo] getSessionModel: invalid sessionId`);
    return null;
  }
  log(`[session-state-repo] getSessionModel sessionId=${sessionId}`);
  const state = storeGetSessionState(sessionId);
  return state?.model ?? null;
}

export function setSessionModel(sessionId: string, model: string | null): string | null {
  if (!isNonEmptyString(sessionId)) {
    log(`[session-state-repo] setSessionModel: invalid sessionId`);
    return null;
  }
  if (model !== null && !isNonEmptyString(model)) {
    log(`[session-state-repo] setSessionModel: invalid model value`);
    return null;
  }
  log(`[session-state-repo] setSessionModel sessionId=${sessionId} model=${model ?? "null"}`);
  const state = storeUpsertSessionState(sessionId, { model });
  return state.model;
}

export function getSessionPermissionMode(sessionId: string): string | null {
  if (!isNonEmptyString(sessionId)) {
    log(`[session-state-repo] getSessionPermissionMode: invalid sessionId`);
    return null;
  }
  log(`[session-state-repo] getSessionPermissionMode sessionId=${sessionId}`);
  const state = storeGetSessionState(sessionId);
  return state?.permissionMode ?? null;
}

export function setSessionPermissionMode(
  sessionId: string,
  mode: string | null,
): string | null {
  if (!isNonEmptyString(sessionId)) {
    log(`[session-state-repo] setSessionPermissionMode: invalid sessionId`);
    return null;
  }
  if (mode !== null && !isNonEmptyString(mode)) {
    log(`[session-state-repo] setSessionPermissionMode: invalid mode value`);
    return null;
  }
  log(`[session-state-repo] setSessionPermissionMode sessionId=${sessionId} mode=${mode ?? "null"}`);
  const state = storeUpsertSessionState(sessionId, { permissionMode: mode });
  return state.permissionMode;
}