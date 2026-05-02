/**
 * /api/* routes — Adapter layer for the standalone web UI (web/).
 *
 * The web client calls /api/* endpoints. This file implements the ones
 * that don't map 1:1 to existing /web/* routes (auth, state, tools,
 * suggest, command, chat stream/control, session messages).
 */
import { Hono } from "hono";
import { apiKeyAuth, uuidAuth } from "../../auth/middleware";
import { issueToken, resolveToken } from "../../auth/token";
import { validateApiKey } from "../../auth/api-key";
import {
  createSession,
  getSession,
  listWebSessionsByOwnerUuid,
  resolveOwnedWebSessionId,
  toWebSessionResponse,
  updateSessionTitle,
  updateSessionStatus,
  resolveExistingWebSessionId,
} from "../../services/session";
import {
  storeBindSession,
  storeClearSessionRequiresAction,
  storeCreateUser,
  storeGetSessionWorker,
  storeGetWorkspaceBySession,
  storeListPendingPermissions,
  storeListSessions,
  storeRemovePendingPermission,
  storeListSessionsByOwnerUuid,
} from "../../store";
import {
  publishSessionEvent,
  loadPersistedEvents,
  getLastPersistedSeqNum,
  hydrateEventBusFromPersistence,
  truncateSessionEvents,
} from "../../services/transport";
import { getEventBus } from "../../transport/event-bus";
import { log, error as logError } from "../../logger";
import { spawn, spawnSync } from "child_process";
import { subprocessManager } from "../../services/subprocess-manager";
import { resumeSession } from "../../services/session-resume";
import { ensureSessionWorkspace } from "../../services/session-workspace";
import { forkSession } from "../../services/session-fork";
import { suggestFiles, suggestCommands } from "../../services/suggest/composerService";
import { runWithSessionContext } from "../../services/session-context";
import { listActiveEnvironmentsResponse } from "../../services/environment";
import { config } from "../../config";
import {
  resolveOwnedWebSessionRuntimeContext,
  upsertSessionRuntimeState,
} from "../../services/session-runtime-context";
import { archiveSession as archiveManagedSession } from "../../services/session-archive";
import { toClientPayload } from "../../transport/client-payload";
import { resolveOwnedWorkspaceCwd } from "../../services/workspace-access";

const app = new Hono();
const SSE_KEEPALIVE_MS = Math.max(1000, config.wsKeepaliveInterval * 1000);

type PermissionControlPayload = {
  request_id?: unknown;
  approved?: unknown;
  updated_input?: unknown;
  updated_permissions?: unknown;
  message?: unknown;
};

function buildSdkPermissionControlMessage(
  sessionId: string,
  payload: PermissionControlPayload,
): string {
  const sdkMessage = toClientPayload({
    id:
      typeof payload.request_id === "string" && payload.request_id
        ? payload.request_id
        : crypto.randomUUID(),
    sessionId,
    type: "permission_response",
    payload,
    direction: "outbound",
    seqNum: 1,
    createdAt: Date.now(),
  });

  return JSON.stringify(sdkMessage);
}

/**
 * Helper to wrap route handlers with session context.
 * Extracts sessionId from route params and resolves it to the internal session ID.
 */
function withSessionContext(
  paramName: string, // e.g., "id" for /sessions/:id
  handler: (c: import("hono").Context, sessionId: string, uuid: string) => Response | Promise<Response>,
) {
  return async (c: import("hono").Context) => {
    const uuid = c.get("uuid")!;
    const sessionIdParam = c.req.param(paramName);
    const sessionId = resolveOwnedWebSessionId(sessionIdParam ?? "", uuid);
    if (!sessionId) {
      return c.json({ error: "Session not found or not owned" }, 404);
    }
    return runWithSessionContext(sessionId, uuid, () => handler(c, sessionId, uuid));
  };
}

type SessionHistoryBlock = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  summary?: string;
  title?: string;
  url?: string;
  mimeType?: string;
  sourceType?: string;
};

type SessionHistoryMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  blocks?: SessionHistoryBlock[];
  quote?: {
    text: string;
    sourceMessageId?: string;
    sourceRole?: "user" | "assistant";
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeOptionalString(
  value: unknown,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Map effort level strings to thinking token budgets for live CLI updates.
 * The CLI's `set_max_thinking_tokens` control request accepts numeric budgets.
 * null clears the override (model default), 0 disables extended thinking.
 */
function effortToThinkingTokens(effort: string | null): number | null {
  if (effort === null || effort === "") return null; // clear → model default
  switch (effort) {
    case "low":
      return 0; // disable extended thinking for fastest responses
    case "medium":
      return 10_000;
    case "high":
      return 32_000;
    case "xhigh":
      return 64_000;
    case "max":
      return 128_000;
    default:
      return null;
  }
}

async function applyLiveSessionRuntimeUpdates(
  sessionId: string,
  patch: {
    model?: string | null;
    permissionMode?: string | null;
    thinkingEffort?: string | null;
  },
): Promise<void> {
  if (!subprocessManager.isRunning(sessionId)) {
    return;
  }

  if (patch.model !== undefined) {
    await subprocessManager.requestControl(sessionId, {
      subtype: "set_model",
      ...(patch.model ? { model: patch.model } : {}),
    });
  }

  if (patch.permissionMode !== undefined) {
    await subprocessManager.requestControl(sessionId, {
      subtype: "set_permission_mode",
      mode: patch.permissionMode ?? "default",
    });
  }

  if (patch.thinkingEffort !== undefined) {
    const tokens = effortToThinkingTokens(patch.thinkingEffort);
    await subprocessManager.requestControl(sessionId, {
      subtype: "set_max_thinking_tokens",
      max_thinking_tokens: tokens,
    });
  }
}

function resolveRequestedSessionId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

async function ensureOwnedSessionWorkspace(input: {
  uuid: string;
  sessionId?: string | null;
  cwd?: string | null;
}): Promise<
  | { ok: true; sessionId: string; cwd: string }
  | { ok: false; status: number; error: string }
> {
  const requestedSessionId = resolveRequestedSessionId(input.sessionId);

  let resolvedId: string | undefined;
  if (requestedSessionId) {
    resolvedId = resolveOwnedWebSessionId(requestedSessionId, input.uuid) ?? undefined;
    if (!resolvedId) {
      return { ok: false, status: 403, error: "Session not found or not owned" };
    }
  } else {
    const session = createSession({
      title: "New Session",
      source: "web",
      cwd: input.cwd ?? null,
    });
    storeBindSession(session.id, input.uuid);

    try {
      await ensureSessionWorkspace(session.id, {
        cwd: input.cwd ?? null,
        forceIsolation: true,
      });
    } catch (err) {
      return {
        ok: false,
        status: 500,
        error: `Failed to create isolated workspace: ${String(err)}`,
      };
    }

    resolvedId = session.id;
  }

  let workspace = storeGetWorkspaceBySession(resolvedId);
  if (!workspace || workspace.strategy === "same-dir") {
    try {
      const ensured = await ensureSessionWorkspace(resolvedId, {
        cwd:
          input.cwd ||
          workspace?.workspacePath ||
          workspace?.sourceRoot ||
          process.cwd(),
        forceIsolation: true,
      });
      workspace = ensured.workspace;
    } catch (err) {
      return {
        ok: false,
        status: 500,
        error: `Failed to create isolated workspace: ${String(err)}`,
      };
    }
  }

  return {
    ok: true,
    sessionId: resolvedId,
    cwd:
      workspace?.workspacePath ||
      workspace?.sourceRoot ||
      input.cwd ||
      process.cwd(),
  };
}

function toEventTimestamp(event: { createdAt?: number }): string {
  return new Date(event.createdAt ?? Date.now()).toISOString();
}

function extractQuote(value: unknown): SessionHistoryMessage["quote"] | undefined {
  const record = asRecord(value);
  if (!record || typeof record.text !== "string" || record.text.length === 0) {
    return undefined;
  }

  return {
    text: record.text,
    ...(typeof record.sourceMessageId === "string"
      ? { sourceMessageId: record.sourceMessageId }
      : {}),
    ...(record.sourceRole === "user" || record.sourceRole === "assistant"
      ? { sourceRole: record.sourceRole }
      : {}),
  };
}

function collectSessionEvents(sessionId: string) {
  const persisted = loadPersistedEvents(sessionId, 0).map((event) => ({
    ...event,
    direction: event.direction as "inbound" | "outbound",
  }));
  const live = getEventBus(sessionId, getLastPersistedSeqNum(sessionId))
    .getEventsSince(0)
    .map((event) => ({
      ...event,
      direction: event.direction as "inbound" | "outbound",
    }));

  const seenSeqNums = new Set<number>();
  return [...persisted, ...live]
    .filter((event) => {
      if (seenSeqNums.has(event.seqNum)) {
        return false;
      }
      seenSeqNums.add(event.seqNum);
      return true;
    })
    .sort((a, b) => a.seqNum - b.seqNum);
}

export function buildSessionMessagesFromEvents(
  events: Array<{
    type: string;
    payload: unknown;
    seqNum: number;
    createdAt: number;
  }>,
): SessionHistoryMessage[] {
  const messages: SessionHistoryMessage[] = [];
  let assistantDraft:
    | { role: "assistant"; content: string; timestamp: string; blocks: SessionHistoryBlock[] }
    | null = null;

  const flushAssistantDraft = () => {
    if (!assistantDraft) return;
    if (!assistantDraft.content && assistantDraft.blocks.length === 0) {
      assistantDraft = null;
      return;
    }

    messages.push({
      role: "assistant",
      content: assistantDraft.content,
      timestamp: assistantDraft.timestamp,
      ...(assistantDraft.blocks.length > 0 ? { blocks: assistantDraft.blocks } : {}),
    });
    assistantDraft = null;
  };

  const ensureAssistantDraft = (timestamp: string) => {
    if (!assistantDraft) {
      assistantDraft = {
        role: "assistant",
        content: "",
        timestamp,
        blocks: [],
      };
    }
    return assistantDraft;
  };

  for (const event of events) {
    const payload = asRecord(event.payload);
    const timestamp = toEventTimestamp(event);

    switch (event.type) {
      case "system": {
        if (payload?.type === "clear") {
          assistantDraft = null;
          messages.length = 0;
        }
        break;
      }
      case "user":
      case "user_message": {
        flushAssistantDraft();
        const content =
          typeof payload?.content === "string"
            ? payload.content
            : typeof payload?.message === "string"
              ? payload.message
              : "";
        const quote = extractQuote(payload?.quote);
        if (!content && !quote) {
          break;
        }
        messages.push({
          role: "user",
          content,
          timestamp,
          ...(quote ? { quote } : {}),
        });
        break;
      }
      case "content_delta": {
        const delta = asRecord(payload?.delta);
        const text =
          typeof delta?.text === "string"
            ? delta.text
            : typeof payload?.content === "string"
              ? payload.content
              : "";
        if (!text) {
          break;
        }
        const assistant = ensureAssistantDraft(timestamp);
        assistant.content += text;
        assistant.blocks.push({ type: "text", text });
        break;
      }
      case "thinking_delta": {
        const delta = asRecord(payload?.delta);
        const thinking =
          typeof delta?.thinking === "string"
            ? delta.thinking
            : typeof payload?.content === "string"
              ? payload.content
              : "";
        if (!thinking) {
          break;
        }
        ensureAssistantDraft(timestamp).blocks.push({ type: "thinking", thinking });
        break;
      }
      case "tool_start": {
        const toolId =
          typeof payload?.id === "string"
            ? payload.id
            : typeof payload?.toolCallId === "string"
              ? payload.toolCallId
              : "";
        ensureAssistantDraft(timestamp).blocks.push({
          type: "tool_use",
          ...(toolId ? { id: toolId } : {}),
          ...(typeof payload?.name === "string" ? { name: payload.name } : {}),
          ...(payload?.input && typeof payload.input === "object"
            ? { input: payload.input as Record<string, unknown> }
            : {}),
        });
        break;
      }
      case "tool_result": {
        flushAssistantDraft();
        const toolUseId =
          typeof payload?.toolCallId === "string"
            ? payload.toolCallId
            : typeof payload?.id === "string"
              ? payload.id
              : "";
        messages.push({
          role: "user",
          content: "",
          timestamp,
          blocks: [
            {
              type: "tool_result",
              ...(toolUseId ? { tool_use_id: toolUseId } : {}),
              content: payload?.result ?? payload?.content ?? "",
              is_error:
                Boolean(payload?.isError) ||
                Boolean(payload?.is_error) ||
                Number(payload?.exitCode ?? 0) !== 0,
            },
          ],
        });
        break;
      }
      case "content_block": {
        const block = asRecord(payload?.block);
        if (!block || typeof block.type !== "string") {
          break;
        }
        if (block.type === "tool_result") {
          flushAssistantDraft();
          messages.push({
            role: "user",
            content: "",
            timestamp,
            blocks: [
              {
                type: "tool_result",
                ...(typeof block.tool_use_id === "string"
                  ? { tool_use_id: block.tool_use_id }
                  : {}),
                content: block.content ?? block.text ?? "",
                is_error: Boolean(block.is_error),
              },
            ],
          });
          break;
        }

        const assistant = ensureAssistantDraft(timestamp);
        assistant.blocks.push({
          type: block.type,
          ...(typeof block.text === "string" ? { text: block.text } : {}),
          ...(typeof block.thinking === "string" ? { thinking: block.thinking } : {}),
          ...(typeof block.id === "string" ? { id: block.id } : {}),
          ...(typeof block.name === "string" ? { name: block.name } : {}),
          ...(block.input && typeof block.input === "object"
            ? { input: block.input as Record<string, unknown> }
            : {}),
          ...("content" in block ? { content: block.content } : {}),
          ...(typeof block.tool_use_id === "string"
            ? { tool_use_id: block.tool_use_id }
            : {}),
          ...(typeof block.summary === "string" ? { summary: block.summary } : {}),
          ...(typeof block.title === "string" ? { title: block.title } : {}),
          ...(typeof block.url === "string" ? { url: block.url } : {}),
          ...(typeof block.mimeType === "string" ? { mimeType: block.mimeType } : {}),
          ...(typeof block.sourceType === "string"
            ? { sourceType: block.sourceType }
            : {}),
        });
        if (block.type === "text" && typeof block.text === "string") {
          assistant.content += block.text;
        }
        break;
      }
      case "message_end":
        flushAssistantDraft();
        break;
      default:
        break;
    }
  }

  flushAssistantDraft();
  return messages;
}

export function buildSessionHistoryResponse(
  events: Array<{
    type: string;
    payload: unknown;
    seqNum: number;
    createdAt: number;
  }>,
) {
  return {
    messages: buildSessionMessagesFromEvents(events),
    lastSeqNum: events[events.length - 1]?.seqNum ?? 0,
  };
}

function resolveLatestRewindTarget(sessionId: string): {
  targetUserMessageId: string;
  resumeSessionAt: string | null;
  retainedSeqNum: number;
} {
  const events = collectSessionEvents(sessionId);
  const latestUserEvent = [...events].reverse().find((event) => {
    if (event.direction !== "inbound") return false;
    if (event.type !== "user" && event.type !== "user_message") return false;
    const payload = asRecord(event.payload);
    return typeof payload?.uuid === "string" && payload.uuid.length > 0;
  });
  const latestUserPayload = asRecord(latestUserEvent?.payload);
  const targetUserMessageId =
    typeof latestUserPayload?.uuid === "string" && latestUserPayload.uuid
      ? latestUserPayload.uuid
      : null;

  if (!targetUserMessageId || !latestUserEvent) {
    throw new Error("Latest user turn is missing a stable message id for rewind");
  }

  let resumeSessionAt: string | null = null;
  let retainedSeqNum = 0;

  for (const event of events) {
    if (event.seqNum >= latestUserEvent.seqNum) {
      break;
    }
    if (event.direction !== "outbound" || event.type !== "message_end") {
      continue;
    }

    const payload = asRecord(event.payload);
    if (typeof payload?.id !== "string" || payload.id.length === 0) {
      continue;
    }

    resumeSessionAt = payload.id;
    retainedSeqNum = event.seqNum;
  }

  return {
    targetUserMessageId,
    resumeSessionAt,
    retainedSeqNum,
  };
}

async function rewindLatestTurnFiles(
  sessionId: string,
  cwd: string,
): Promise<{
  success: true;
  userMessageId: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}> {
  const {
    targetUserMessageId,
    resumeSessionAt,
    retainedSeqNum,
  } = resolveLatestRewindTarget(sessionId);

  const resumeSession = !subprocessManager.isRunning(sessionId);
  await subprocessManager.getOrSpawn(sessionId, cwd, resumeSession);

  const dryRunResult = await subprocessManager.requestControl(sessionId, {
    subtype: "rewind_files",
    user_message_id: targetUserMessageId,
    dry_run: true,
  });

  await subprocessManager.requestControl(sessionId, {
    subtype: "rewind_files",
    user_message_id: targetUserMessageId,
  });

  await subprocessManager.stop(sessionId, { suppressExitEvents: true });
  truncateSessionEvents(sessionId, retainedSeqNum);
  await subprocessManager.getOrSpawn(
    sessionId,
    cwd,
    Boolean(resumeSessionAt),
    resumeSessionAt ?? undefined,
  );

  return {
    success: true,
    userMessageId: targetUserMessageId,
    ...(Array.isArray(dryRunResult.filesChanged)
      ? { filesChanged: dryRunResult.filesChanged as string[] }
      : {}),
    ...(typeof dryRunResult.insertions === "number"
      ? { insertions: dryRunResult.insertions }
      : {}),
    ...(typeof dryRunResult.deletions === "number"
      ? { deletions: dryRunResult.deletions }
      : {}),
  };
}

// ── Auth ─────────────────────────────────────────────────────────────────────

app.post("/auth/init", async (c) => {
  const uuid = crypto.randomUUID();
  storeCreateUser(uuid);
  const { token, expires_in } = issueToken(uuid);
  return c.json({
    tempToken: token,
    expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
  });
});

app.post("/auth/verify", async (c) => {
  const body = await c.req.json();
  const tempToken = body.tempToken || body.token;
  const username = resolveToken(tempToken);
  if (!username) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
  return c.json({
    apiKey: tempToken,
    expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
  });
});

app.get("/auth/validate", async (c) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) return c.json({ valid: false });
  if (resolveToken(token)) return c.json({ valid: true });
  if (validateApiKey(token)) return c.json({ valid: true });
  return c.json({ valid: false });
});

app.post("/bind", async (c) => {
  const body = await c.req.json();
  const sessionId = body.sessionId;
  const uuid = c.req.query("uuid") || body.uuid;

  if (!sessionId || !uuid) {
    return c.json({ error: "sessionId and uuid are required" }, 400);
  }

  const resolvedSessionId = resolveExistingWebSessionId(sessionId);
  if (!resolvedSessionId) {
    return c.json({ error: "Session not found" }, 404);
  }

  storeBindSession(resolvedSessionId, uuid);
  return c.json({ ok: true, sessionId: toWebSessionResponse({ ...getSession(resolvedSessionId)!, id: resolvedSessionId }).id });
});

// ── Sessions CRUD (web client shape) ─────────────────────────────────────────

app.get("/sessions", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const sessions = listWebSessionsByOwnerUuid(uuid);
  return c.json({ sessions, hasMore: false });
});

app.post("/sessions", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const body = await c.req.json().catch(() => ({}));
  const session = createSession({
    environment_id: body.environment_id || null,
    title: body.title || "New Session",
    source: "web",
    permission_mode: body.permission_mode || "default",
    cwd: body.cwd || null,
  });
  storeBindSession(session.id, uuid);

  try {
    await ensureSessionWorkspace(session.id, {
      cwd: body.cwd || null,
      forceIsolation: true,
    });
  } catch (err) {
    logError("Failed to provision session workspace", String(err));
    return c.json({ error: `Failed to create isolated workspace: ${String(err)}` }, 500);
  }

  const hydrated = getSession(session.id);
  return c.json({ session: toWebSessionResponse(hydrated ?? session) });
});

app.get("/sessions/:id/history", uuidAuth, withSessionContext("id", (c, sessionId) => {
  const persisted = loadPersistedEvents(sessionId, 0).map((event) => ({
    ...event,
    direction: event.direction as "inbound" | "outbound",
  }));
  const lastPersistedSeq = persisted[persisted.length - 1]?.seqNum ?? 0;
  const bus = getEventBus(sessionId, getLastPersistedSeqNum(sessionId));
  const live = bus
    .getEventsSince(lastPersistedSeq)
    .map((event) => ({
      ...event,
      direction: event.direction as "inbound" | "outbound",
    }));

  const replayedRequestIds = new Set(
    persisted
      .filter((event) => event.type === "permission_request")
      .map((event) => (event.payload as Record<string, unknown> | null)?.request_id as string | undefined)
      .filter(Boolean),
  );
  const pendingPermissions = storeListPendingPermissions(sessionId)
    .filter((perm) => !replayedRequestIds.has(perm.requestId))
    .map((perm) => ({
      id: perm.id,
      sessionId: perm.sessionId,
      type: "permission_request",
      payload: perm.payload,
      direction: "outbound" as const,
      seqNum: Number.MAX_SAFE_INTEGER,
      createdAt: perm.createdAt.getTime(),
    }));

  return c.json({ events: [...persisted, ...live, ...pendingPermissions] });
}));

app.get("/sessions/:id", uuidAuth, withSessionContext("id", (c, sessionId) => {
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "SESSION_NOT_FOUND", message: "Session not found" }, 404);

  // If session is in DB but subprocess is gone, surface as interrupted
  const liveStatus = subprocessManager.isRunning(sessionId)
    ? session.status
    : session.status === "running"
      ? "interrupted"
      : session.status;

  return c.json({ session: toWebSessionResponse({ ...session, status: liveStatus }) });
}));

app.patch("/sessions/:id", uuidAuth, withSessionContext("id", async (c, sessionId) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.name || body.title) {
    updateSessionTitle(sessionId, body.name || body.title);
  }
  return c.json({ success: true });
}));

app.delete("/sessions/:id", uuidAuth, withSessionContext("id", async (c, sessionId) => {
  await archiveManagedSession(sessionId);
  return c.json({ success: true });
}));

app.post("/sessions/:id/fork", uuidAuth, withSessionContext("id", async (c, sessionId, uuid) => {
  const sourceWorkspace = storeGetWorkspaceBySession(sessionId);
  if (!sourceWorkspace || sourceWorkspace.strategy === "same-dir") {
    await ensureSessionWorkspace(sessionId, {
      cwd: sourceWorkspace?.workspacePath || sourceWorkspace?.sourceRoot || process.cwd(),
      forceIsolation: true,
    });
  }

  const result = await forkSession(sessionId);
  if (!result.success || !result.newSessionId) {
    return c.json({ error: result.error ?? "Failed to fork session" }, 500);
  }

  storeBindSession(result.newSessionId, uuid);
  const session = getSession(result.newSessionId);
  if (!session) {
    return c.json({ error: "Forked session not found" }, 500);
  }

  return c.json({ session: toWebSessionResponse(session) });
}));

// Resume an interrupted session (re-spawn subprocess)
app.post("/sessions/:id/resume", uuidAuth, withSessionContext("id", async (c, sessionId) => {
  if (subprocessManager.isRunning(sessionId)) {
    return c.json({ success: true, status: "already_running" });
  }

  try {
    const existingWorkspace = storeGetWorkspaceBySession(sessionId);
    if (!existingWorkspace || existingWorkspace.strategy === "same-dir") {
      await ensureSessionWorkspace(sessionId, {
        cwd:
          existingWorkspace?.workspacePath ||
          existingWorkspace?.sourceRoot ||
          process.cwd(),
        forceIsolation: true,
      });
    }

    const resumed = await resumeSession(sessionId);
    if (!resumed.success) {
      updateSessionStatus(sessionId, "interrupted");
      return c.json({ error: resumed.error ?? "Failed to resume session" }, 500);
    }

    const workspace = storeGetWorkspaceBySession(sessionId);
    const resumeCwd =
      resumed.workspacePath ||
      workspace?.workspacePath ||
      workspace?.sourceRoot ||
      process.cwd();
    await subprocessManager.getOrSpawn(sessionId, resumeCwd, true);
    return c.json({ success: true, status: "resumed" });
  } catch (err) {
    updateSessionStatus(sessionId, "interrupted");
    logError("Failed to resume session", String(err));
    return c.json({ error: `Failed to resume: ${String(err)}` }, 500);
  }
}));

// ── State ────────────────────────────────────────────────────────────────────

app.get("/state", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const requestedSessionId = c.req.query("sessionId");
  const sessions = listWebSessionsByOwnerUuid(uuid);
  const fallbackSessionId =
    requestedSessionId ||
    sessions.find((s) => subprocessManager.isRunning(s.id))?.id ||
    sessions[0]?.id ||
    null;

  if (fallbackSessionId) {
    const runtime = resolveOwnedWebSessionRuntimeContext(
      fallbackSessionId,
      uuid,
    );
    if (runtime.ok) {
      const handle = subprocessManager.get(runtime.context.sessionId);
      return c.json({
        permissionMode:
          handle?.permissionState.mode ??
          runtime.context.effectivePermissionMode ??
          "default",
        approvedTools: handle?.permissionState.approvedTools ?? [],
        pendingTools: [],
        model:
          runtime.context.sessionState?.model ?? "claude-sonnet-4-6",
        tokenUsage:
          handle?.tokenUsage ?? { inputTokens: 0, outputTokens: 0 },
        cwd:
          handle?.cwd ||
          runtime.context.workspace?.workspacePath ||
          runtime.context.workspace?.sourceRoot ||
          process.cwd(),
        gitBranch: runtime.context.workspace?.branch ?? null,
        connected: Boolean(handle),
        thinkingEffort: runtime.context.sessionState?.thinkingEffort ?? null,
      });
    }
  }

  return c.json({
    permissionMode: "default",
    approvedTools: [],
    pendingTools: [],
    model: "claude-sonnet-4-6",
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
    cwd: process.cwd(),
    gitBranch: null,
    connected: false,
    thinkingEffort: null,
  });
});

app.patch("/state", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const body = await c.req.json().catch(() => ({}));
  const requestedSessionId =
    (body as Record<string, unknown>).sessionId as string | undefined ??
    c.req.query("sessionId") ??
    undefined;
  const sessions = listWebSessionsByOwnerUuid(uuid);
  const fallbackSessionId =
    requestedSessionId ||
    sessions.find((s) => subprocessManager.isRunning(s.id))?.id ||
    sessions[0]?.id ||
    null;

  if (!fallbackSessionId) {
    return c.json({ success: true });
  }

  const runtime = resolveOwnedWebSessionRuntimeContext(fallbackSessionId, uuid);
  if (!runtime.ok) {
    return c.json(
      { error: runtime.error.message },
      runtime.error.status,
    );
  }

  const model = normalizeOptionalString((body as Record<string, unknown>).model);
  const permissionMode = normalizeOptionalString(
    (body as Record<string, unknown>).permissionMode,
  );
  const thinkingEffort = normalizeOptionalString(
    (body as Record<string, unknown>).thinkingEffort,
  );

  try {
    await applyLiveSessionRuntimeUpdates(runtime.context.sessionId, {
      ...(model !== undefined ? { model } : {}),
      ...(permissionMode !== undefined ? { permissionMode } : {}),
      ...(thinkingEffort !== undefined ? { thinkingEffort } : {}),
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      409,
    );
  }

  const updated = upsertSessionRuntimeState(runtime.context.sessionId, {
    ...(model !== undefined ? { model } : {}),
    ...(permissionMode !== undefined ? { permissionMode } : {}),
    ...(thinkingEffort !== undefined ? { thinkingEffort } : {}),
  });

  const handle = subprocessManager.get(runtime.context.sessionId);
  if (handle && permissionMode !== undefined) {
    handle.permissionState.mode = updated.permissionMode ?? "default";
  }

  return c.json({
    success: true,
    model: updated.model,
    permissionMode: updated.permissionMode,
    thinkingEffort: updated.thinkingEffort,
  });
});

// ── Tools ────────────────────────────────────────────────────────────────────

app.get("/tools", uuidAuth, async (c) => {
  const coreTools = [
    { name: "Bash", description: "Execute shell commands", category: "execution" },
    { name: "Read", description: "Read file contents", category: "filesystem" },
    { name: "Edit", description: "Edit file contents", category: "filesystem" },
    { name: "Write", description: "Write file contents", category: "filesystem" },
    { name: "Glob", description: "Find files by pattern", category: "filesystem" },
    { name: "Grep", description: "Search file contents", category: "filesystem" },
    { name: "Agent", description: "Launch sub-agent", category: "agent" },
    { name: "WebFetch", description: "Fetch URL content", category: "web" },
    { name: "WebSearch", description: "Search the web", category: "web" },
    { name: "AskUserQuestion", description: "Ask user a structured question", category: "interaction" },
    { name: "TaskCreate", description: "Create a task", category: "planning" },
    { name: "TaskUpdate", description: "Update a task", category: "planning" },
    { name: "EnterPlanMode", description: "Enter plan mode", category: "planning" },
    { name: "ExitPlanMode", description: "Exit plan mode", category: "planning" },
  ];
  return c.json({ tools: coreTools });
});

// ── Chat stream/control ──────────────────────────────────────────────────────

app.post("/chat/stream", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const body = await c.req.json();
  const { message, quote, sessionId: rawSessionId, cwd: rawCwd } = body as {
    message?: string;
    quote?: string;
    sessionId?: string;
    cwd?: string;
  };
  const userMessageId =
    normalizeOptionalString((body as Record<string, unknown>).userMessageId)
    ?? crypto.randomUUID();

  const resolved = await ensureOwnedSessionWorkspace({
    uuid,
    sessionId: rawSessionId,
    cwd: rawCwd ?? null,
  });
  if (!resolved.ok) {
    c.status(resolved.status as 403 | 500);
    return c.json({ error: resolved.error });
  }
  const resolvedId = resolved.sessionId;
  const effectiveCwd = resolved.cwd;

  // Run the streaming handler with session context isolation
  return runWithSessionContext(resolvedId, uuid, async () => {
    // Subscribe to the EventBus BEFORE spawning the subprocess so we don't
    // miss early events (session_created, message_start).
    const bus = getEventBus(resolvedId, getLastPersistedSeqNum(resolvedId));
    const encoder = new TextEncoder();
    const earlyEvents: Array<{ type: string; payload: unknown; seqNum: number }> = [];
    let sseController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let closed = false;
    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (closed) {
        return;
      }
      closed = true;
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
      sseController = null;
      unsub();
    };

    // Collect events that arrive before the SSE controller is ready
    const unsub = bus.subscribe((event) => {
      if (event.direction === "inbound") return;
      const data = JSON.stringify({
        type: event.type,
        data: event.payload,
        seqNum: event.seqNum,
      });
      const chunk = encoder.encode(`event: message\ndata: ${data}\n\n`);

      if (sseController) {
        try {
          sseController.enqueue(chunk);
        } catch {
          cleanup();
          return;
        }
        if (event.type === "message_end" || event.type === "session_ended") {
          try { sseController.close(); } catch { /* already closed */ }
          cleanup();
        }
      } else {
        earlyEvents.push({
          type: event.type,
          payload: event.payload,
          seqNum: event.seqNum,
        });
      }
    });

    // Publish user message to EventBus (for message history)
    publishSessionEvent(
      resolvedId,
      "user",
      { content: message ?? "", quote, uuid: userMessageId },
      "inbound",
    );

    // Spawn subprocess (no-op if already running), then enqueue the user message
    try {
      await subprocessManager.getOrSpawn(resolvedId, effectiveCwd);
      subprocessManager.enqueueMessage(
        resolvedId,
        JSON.stringify({
          type: "user",
          uuid: userMessageId,
          message: { role: "user", content: message ?? "" },
        }),
      );
    } catch (err) {
      cleanup();
      logError("Failed to spawn Claude subprocess", String(err));
      return c.json({ error: `Failed to start Claude: ${String(err)}` }, 500);
    }

    // Return live SSE stream from the outbound EventBus
    const stream = new ReadableStream({
      start(controller) {
        sseController = controller;

        // Flush any events that arrived before the controller was ready
        for (const early of earlyEvents) {
          const data = JSON.stringify({
            type: early.type,
            data: early.payload,
            seqNum: early.seqNum,
          });
          controller.enqueue(encoder.encode(`event: message\ndata: ${data}\n\n`));
        }
        earlyEvents.length = 0;
        keepAliveTimer = setInterval(() => {
          if (closed || !sseController) {
            return;
          }
          try {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch {
            cleanup();
          }
        }, SSE_KEEPALIVE_MS);
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });
});

app.post("/chat/control", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const body = await c.req.json();
  const sessionId = body.sessionId;

  if (!sessionId) {
    return c.json({ error: "sessionId is required" }, 400);
  }

  const resolvedId = resolveOwnedWebSessionId(sessionId, uuid);
  if (!resolvedId) {
    return c.json({ error: "Session not found or not owned" }, 403);
  }

  // Run with session context isolation
  return runWithSessionContext(resolvedId, uuid, async () => {
    const updatedInput =
      body.updatedInput &&
      typeof body.updatedInput === "object" &&
      !Array.isArray(body.updatedInput)
        ? (body.updatedInput as Record<string, unknown>)
        : body.updated_input &&
            typeof body.updated_input === "object" &&
            !Array.isArray(body.updated_input)
          ? (body.updated_input as Record<string, unknown>)
          : undefined;
    const updatedPermissions = Array.isArray(body.updatedPermissions)
      ? body.updatedPermissions
      : Array.isArray(body.updated_permissions)
        ? body.updated_permissions
        : undefined;
    const permissionResponsePayload: PermissionControlPayload = {
      request_id: body.request_id,
      approved: body.approved,
      ...(updatedInput ? { updated_input: updatedInput } : {}),
      ...(updatedPermissions ? { updated_permissions: updatedPermissions } : {}),
      ...(typeof body.message === "string" ? { message: body.message } : {}),
    };

    // Forward an SDK-compatible nested control_response to the subprocess.
    const controlPayload = buildSdkPermissionControlMessage(
      resolvedId,
      permissionResponsePayload,
    );
    subprocessManager.sendControl(resolvedId, controlPayload);
    storeClearSessionRequiresAction(resolvedId);

    // Remove from pending_permissions table
    if (body.request_id) {
      storeRemovePendingPermission(resolvedId, body.request_id);
    }

    publishSessionEvent(
      resolvedId,
      "permission_response",
      permissionResponsePayload,
      "inbound",
    );

    return c.json({ success: true });
  });
});

app.post("/chat/interrupt", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const body = await c.req.json();
  const sessionId = body.sessionId;

  if (!sessionId) {
    return c.json({ error: "sessionId is required" }, 400);
  }

  const resolvedId = resolveOwnedWebSessionId(sessionId, uuid);
  if (!resolvedId) {
    return c.json({ error: "Session not found or not owned" }, 403);
  }

  // Run with session context isolation
  return runWithSessionContext(resolvedId, uuid, async () => {
    subprocessManager.interrupt(resolvedId);
    publishSessionEvent(resolvedId, "interrupt", {}, "inbound");

    return c.json({ success: true });
  });
});

// ── Session messages ─────────────────────────────────────────────────────────

app.get("/sessions/:id/messages", uuidAuth, withSessionContext("id", (c, sessionId) => {
  return c.json(buildSessionHistoryResponse(collectSessionEvents(sessionId)));
}));

// ── Session stream (SSE with normalized { type, data } shape) ────────────────

app.get("/sessions/:id/stream", uuidAuth, withSessionContext("id", (c, sessionId) => {
  hydrateEventBusFromPersistence(sessionId);
  const bus = getEventBus(sessionId, getLastPersistedSeqNum(sessionId));
  const encoder = new TextEncoder();
  const fromSeqNum = Number(c.req.query("from") || "0");
  let unsub: (() => void) | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const persisted = loadPersistedEvents(sessionId, fromSeqNum).filter((event) => event.direction !== "inbound");
      const replayedSeqNums = new Set<number>();

      for (const event of persisted) {
        replayedSeqNums.add(event.seqNum);
        const data = JSON.stringify({
          type: event.type,
          data: event.payload,
          seqNum: event.seqNum,
        });
        controller.enqueue(encoder.encode(`id: ${event.seqNum}\nevent: message\ndata: ${data}\n\n`));
      }

      const missed = bus
        .getEventsSince(fromSeqNum)
        .filter((event) => event.direction !== "inbound" && !replayedSeqNums.has(event.seqNum));

      for (const event of missed) {
        const data = JSON.stringify({
          type: event.type,
          data: event.payload,
          seqNum: event.seqNum,
        });
        controller.enqueue(encoder.encode(`id: ${event.seqNum}\nevent: message\ndata: ${data}\n\n`));
      }

      // Replay pending permissions from pending_permissions table
      const pendingPermissions = storeListPendingPermissions(sessionId);
      const replayedRequestIds = new Set(
        [...persisted, ...missed]
          .filter((event) => event.type === "permission_request")
          .map((event) => (event.payload as Record<string, unknown>)?.request_id as string)
          .filter(Boolean),
      );
      for (const perm of pendingPermissions) {
        if (!replayedRequestIds.has(perm.requestId)) {
          const replayEvent = publishSessionEvent(
            sessionId,
            "permission_request",
            perm.payload,
            "outbound",
          );
          replayedRequestIds.add(perm.requestId);
          const data = JSON.stringify({
            type: replayEvent.type,
            data: replayEvent.payload,
            seqNum: replayEvent.seqNum,
          });
          controller.enqueue(
            encoder.encode(
              `id: ${replayEvent.seqNum}\nevent: message\ndata: ${data}\n\n`,
            ),
          );
        }
      }

      // Fallback: also check requiresActionDetails for backward compat
      const worker = storeGetSessionWorker(sessionId);
      const pendingPermission = worker?.requiresActionDetails;
      const pendingRequestId =
        pendingPermission && typeof pendingPermission === "object"
          ? (pendingPermission as Record<string, unknown>).request_id
          : null;
      if (
        pendingPermission &&
        typeof pendingPermission === "object" &&
        (typeof pendingRequestId !== "string" || !replayedRequestIds.has(pendingRequestId))
      ) {
        const replayEvent = publishSessionEvent(
          sessionId,
          "permission_request",
          pendingPermission,
          "outbound",
        );
        if (typeof pendingRequestId === "string" && pendingRequestId.length > 0) {
          replayedRequestIds.add(pendingRequestId);
        }
        const data = JSON.stringify({
          type: replayEvent.type,
          data: replayEvent.payload,
          seqNum: replayEvent.seqNum,
        });
        controller.enqueue(
          encoder.encode(
            `id: ${replayEvent.seqNum}\nevent: message\ndata: ${data}\n\n`,
          ),
        );
      }

      unsub = bus.subscribe((event) => {
        if (event.direction === "inbound") return;
        const data = JSON.stringify({
          type: event.type,
          data: event.payload,
          seqNum: event.seqNum,
        });
        try {
          controller.enqueue(encoder.encode(`id: ${event.seqNum}\nevent: message\ndata: ${data}\n\n`));
        } catch {
          unsub?.();
          unsub = null;
          if (keepAliveTimer) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
          }
        }
      });
      keepAliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          unsub?.();
          unsub = null;
          if (keepAliveTimer) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
          }
        }
      }, SSE_KEEPALIVE_MS);
    },
    cancel() {
      unsub?.();
      unsub = null;
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}));

app.get("/environments", uuidAuth, async (c) => {
  return c.json(listActiveEnvironmentsResponse());
});

// ── Suggest ──────────────────────────────────────────────────────────────────

app.get("/suggest/files", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const q = c.req.query("q") || "";
  const resolved = resolveOwnedWorkspaceCwd({
    uuid,
    sessionId: c.req.query("sessionId"),
    cwd: c.req.query("cwd"),
  });
  if (!resolved.ok) {
    return c.json({ error: resolved.error }, resolved.status);
  }
  const cwd = resolved.cwd;
  const suggestions = await suggestFiles(q, cwd);
  return c.json({ suggestions });
});

app.get("/suggest/commands", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const q = c.req.query("q") || "";
  const resolved = resolveOwnedWorkspaceCwd({
    uuid,
    sessionId: c.req.query("sessionId"),
    cwd: c.req.query("cwd"),
  });
  if (!resolved.ok) {
    return c.json({ error: resolved.error }, resolved.status);
  }
  const cwd = resolved.cwd;
  const suggestions = await suggestCommands(q, cwd);
  return c.json({ suggestions });
});

// ── Command execute ──────────────────────────────────────────────────────────

import {
  getCommandForWorkspace,
  getCommandPolicy,
  isCommandAvailable,
  isWebNativeCommand,
} from "../../services/command/catalog";
import { executeWebNativeCommand } from "../../services/command/executor";

app.post("/command/execute", uuidAuth, async (c) => {
  const body = await c.req.json();
  const command = body.command as string;
  const sessionId = body.sessionId as string | undefined;
  const rawCwd = body.cwd as string | undefined;
  const userMessageId =
    normalizeOptionalString((body as Record<string, unknown>).userMessageId)
    ?? crypto.randomUUID();

  if (!command) {
    return c.json({ error: "command is required" }, 400);
  }

  // Extract command name (strip leading slash and args)
  const commandName = command.replace(/^\//, "").split(/\s+/)[0].toLowerCase();
  const isStatelessClear = !sessionId && commandName === "clear";

  const uuid = c.get("uuid")!;
  const lookupCwdInput = rawCwd ?? c.req.query("cwd") ?? null;
  let lookupCwd: string | undefined;

  if (!isStatelessClear && (sessionId || lookupCwdInput)) {
    const resolvedLookup = resolveOwnedWorkspaceCwd({
      uuid,
      sessionId: sessionId ?? null,
      cwd: lookupCwdInput,
    });
    if (!resolvedLookup.ok) {
      return c.json({ error: resolvedLookup.error }, resolvedLookup.status);
    }
    lookupCwd = resolvedLookup.cwd;
  }

  // Check if command exists in catalog
  const cmd = await getCommandForWorkspace(commandName, lookupCwd);
  if (!cmd) {
    return c.json({ error: `Unknown command: /${commandName}` }, 404);
  }

  // Check feature flag availability
  if (!isCommandAvailable(cmd)) {
    return c.json(
      { error: `Command /${commandName} is not available. Enable required feature flag.` },
      403,
    );
  }

  // Get policy and check if allowed
  const policy = getCommandPolicy(cmd);
  if (!policy.allowed || policy.blocked) {
    return c.json({ error: `Command /${commandName} is blocked by policy` }, 403);
  }

  if (cmd.name === "rewind" && !sessionId) {
    c.status(409);
    return c.json({ error: "/rewind requires an active session" });
  }

  if (isStatelessClear) {
    return c.json({
      success: true,
      delegated: false,
      executionMode: policy.executionMode,
      webNative: true,
      clearConversation: true,
    });
  }

  const resolved = await ensureOwnedSessionWorkspace({
    uuid,
    sessionId: sessionId ?? null,
    cwd: lookupCwdInput,
  });
  if (!resolved.ok) {
    c.status(resolved.status as 400 | 403 | 404 | 500);
    return c.json({ error: resolved.error });
  }
  const resolvedId = resolved.sessionId;
  const effectiveCwd = resolved.cwd;

  return runWithSessionContext(resolvedId, uuid, async () => {
    if (cmd.name === "rewind") {
      try {
        const rewindResult = await rewindLatestTurnFiles(resolvedId, effectiveCwd);
        return c.json({
          ...rewindResult,
          delegated: false,
          executionMode: policy.executionMode,
          webNative: true,
          sessionId: resolvedId,
          refreshHistory: true,
        });
      } catch (error) {
        c.status(409);
        return c.json({ error: error instanceof Error ? error.message : String(error) });
      }
    }

    publishSessionEvent(
      resolvedId,
      "user",
      { content: command, uuid: userMessageId },
      "inbound",
    );

    if (
      cmd.name === "clear" ||
      cmd.name === "cost" ||
      cmd.name === "files" ||
      cmd.name === "release-notes" ||
      cmd.name === "provider"
    ) {
      const args = command.trim().replace(/^\/\S+/, "").trim();
      const result = await executeWebNativeCommand(
        cmd.name,
        args ? args.split(/\s+/) : [],
        resolvedId,
      );
      if (!result.success) {
        return c.json(
          { error: result.error ?? `Failed to execute command: /${commandName}` },
          500,
        );
      }

      return c.json({
        success: true,
        delegated: cmd.name !== "clear",
        executionMode: policy.executionMode,
        webNative: true,
        sessionId: resolvedId,
        ...(result.clearConversation ? { clearConversation: true } : {}),
      });
    }

    try {
      await subprocessManager.getOrSpawn(resolvedId, effectiveCwd);
      subprocessManager.enqueueMessage(
        resolvedId,
        JSON.stringify({
          type: "user",
          uuid: userMessageId,
          message: {
            role: "user",
            content: command,
          },
        }),
      );
    } catch (err) {
      logError("Failed to execute slash command", String(err));
      return c.json(
        { error: `Failed to execute command: ${String(err)}` },
        500,
      );
    }

    return c.json({
      success: true,
      delegated: true,
      executionMode: policy.executionMode,
      webNative: isWebNativeCommand(cmd),
      sessionId: resolvedId,
    });
  });
});

// ── Context window breakdown ─────────────────────────────────────────────────

app.get("/context", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const sessionId = c.req.query("sessionId");
  if (!sessionId) return c.json({ error: "sessionId required" }, 400);

  const resolvedId = resolveOwnedWebSessionId(sessionId, uuid);
  if (!resolvedId) return c.json({ error: "Session not found" }, 404);

  // Run with session context isolation
  return runWithSessionContext(resolvedId, uuid, () => {
    const bus = getEventBus(resolvedId, getLastPersistedSeqNum(resolvedId));
    const events = bus.getEventsSince(0);

    let systemTokens = 0;
    let userTokens = 0;
    let assistantTokens = 0;
    let toolTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;

    for (const event of events) {
      const payload = event.payload as Record<string, unknown> | null;
      if (event.type === "message_end") {
        const usage = payload?.usage as Record<string, unknown> | undefined;
        totalInput += Number(usage?.inputTokens ?? usage?.input_tokens ?? 0);
        totalOutput += Number(usage?.outputTokens ?? usage?.output_tokens ?? 0);
      }
      if (event.type === "user" || event.type === "user_message") {
        const content = String(payload?.content ?? payload?.message ?? "");
        userTokens += Math.ceil(content.length / 4);
      }
      if (event.type === "content_delta" || event.type === "content_block") {
        const text = String((payload?.delta as Record<string, unknown>)?.text ?? (payload?.block as Record<string, unknown>)?.text ?? "");
        assistantTokens += Math.ceil(text.length / 4);
      }
      if (event.type === "tool_result") {
        const content = String(payload?.content ?? payload?.result ?? "");
        toolTokens += Math.ceil(content.length / 4);
      }
    }

    systemTokens = Math.max(0, totalInput - userTokens - toolTokens);
    const maxTokens = 200000;

    return c.json({
      maxTokens,
      totalInput,
      totalOutput,
      breakdown: [
        { category: "System prompt", tokens: systemTokens, pct: Math.round((systemTokens / maxTokens) * 100) },
        { category: "User messages", tokens: userTokens, pct: Math.round((userTokens / maxTokens) * 100) },
        { category: "Assistant", tokens: assistantTokens, pct: Math.round((assistantTokens / maxTokens) * 100) },
        { category: "Tool results", tokens: toolTokens, pct: Math.round((toolTokens / maxTokens) * 100) },
      ],
      usedPct: Math.round((totalInput / maxTokens) * 100),
    });
  });
});

// ── Usage / rate limits ──────────────────────────────────────────────────────

app.get("/usage", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const sessions = storeListSessionsByOwnerUuid(uuid);

  let totalInput = 0;
  let totalOutput = 0;

  for (const session of sessions) {
    const bus = getEventBus(session.id);
    for (const event of bus.getEventsSince(0)) {
      if (event.type === "message_end") {
        const payload = event.payload as Record<string, unknown> | null;
        const usage = payload?.usage as Record<string, unknown> | undefined;
        totalInput += Number(usage?.inputTokens ?? usage?.input_tokens ?? 0);
        totalOutput += Number(usage?.outputTokens ?? usage?.output_tokens ?? 0);
      }
    }
  }

  const inputCost = (totalInput / 1_000_000) * 3;
  const outputCost = (totalOutput / 1_000_000) * 15;
  const totalCost = inputCost + outputCost;

  return c.json({
    totalInput,
    totalOutput,
    cost: { input: inputCost, output: outputCost, total: totalCost },
    rateLimit: {
      sessionLimit: 40000000,
      sessionUsed: totalInput + totalOutput,
      sessionPct: Math.round(((totalInput + totalOutput) / 40000000) * 100),
      resetAt: null,
    },
  });
});

// ── Prompt history ───────────────────────────────────────────────────────────

app.get("/history", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const sessions = storeListSessionsByOwnerUuid(uuid);
  const limit = Number(c.req.query("limit") || "50");

  const prompts: Array<{ text: string; sessionId: string; timestamp: string }> = [];

  for (const session of sessions) {
    const bus = getEventBus(session.id);
    for (const event of bus.getEventsSince(0)) {
      if (event.type === "user" || event.type === "user_message") {
        const payload = event.payload as Record<string, unknown> | null;
        const text = String(payload?.content ?? payload?.message ?? "");
        if (text.trim()) {
          prompts.push({
            text,
            sessionId: session.id,
            timestamp: new Date(event.createdAt).toISOString(),
          });
        }
      }
    }
  }

  prompts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return c.json({ prompts: prompts.slice(0, limit) });
});

// ── Admin ────────────────────────────────────────────────────────────────────

app.post("/admin/migrate-legacy-sessions", apiKeyAuth, async (c) => {
  const sessions = storeListSessions();
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const session of sessions) {
    const existing = storeGetWorkspaceBySession(session.id);
    if (existing && existing.strategy !== "same-dir") {
      skipped++;
      continue;
    }

    try {
      const cwd = existing?.sourceRoot || existing?.workspacePath || session.cwd || process.cwd();
      await ensureSessionWorkspace(session.id, {
        cwd,
        forceIsolation: true,
      });
      migrated++;
    } catch (err) {
      failed++;
      errors.push(`${session.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return c.json({
    success: true,
    total: sessions.length,
    migrated,
    skipped,
    failed,
    ...(errors.length > 0 ? { errors: errors.slice(0, 50) } : {}),
  });
});

// ── Rewind ───────────────────────────────────────────────────────────────────

app.post("/sessions/:id/rewind", uuidAuth, withSessionContext("id", async (c, sessionId, uuid) => {
  const resolved = await ensureOwnedSessionWorkspace({
    uuid,
    sessionId,
  });
  if (!resolved.ok) {
    c.status(resolved.status as 400 | 403 | 404 | 500);
    return c.json({ error: resolved.error });
  }

  try {
    return c.json(await rewindLatestTurnFiles(sessionId, resolved.cwd));
  } catch (error) {
    c.status(409);
    return c.json({ error: error instanceof Error ? error.message : String(error) });
  }
}));

// ── Workspace search (ripgrep) ──────────────────────────────────────────────

app.get("/search", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const query = c.req.query("q") || "";
  const limit = Math.min(Number(c.req.query("limit") || "50"), 100);
  if (!query.trim()) return c.json({ results: [] });

  const resolved = resolveOwnedWorkspaceCwd({
    uuid,
    sessionId: c.req.query("sessionId"),
    cwd: c.req.query("cwd"),
  });
  if (!resolved.ok) {
    return c.json({ error: resolved.error }, resolved.status);
  }
  const cwd = resolved.cwd;

  const rgArgs = [
    "--json",
    "--fixed-strings",
    "--max-count",
    "1",
    "--ignore-case",
    "--max-filesize", "1M",
    "--glob",
    "!**/node_modules/**",
    "--glob",
    "!**/.git/**",
    "--glob",
    "!**/dist/**",
    "--glob",
    "!**/.next/**",
    query,
    ".",
  ];

  const results: Array<{
    file: string;
    line: number;
    col: number;
    text: string;
    matchStart: number;
    matchEnd: number;
  }> = [];

  try {
    const proc = spawnSync("rg", rgArgs, {
      cwd,
      timeout: 2000,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });

    const stdout = typeof proc.stdout === "string" ? proc.stdout : "";
    for (const line of stdout.split("\n")) {
      if (results.length >= limit) break;
      try {
        const obj = JSON.parse(line);
        if (obj.type === "match") {
          const data = obj.data || {};
          results.push({
            file: data.path?.text ?? "",
            line: data.line_number ?? 0,
            col: (data.submatches?.[0]?.start ?? 0) + 1,
            text: data.lines?.text ?? "",
            matchStart: data.submatches?.[0]?.start ?? 0,
            matchEnd: data.submatches?.[0]?.end ?? 0,
          });
        }
      } catch {
        // skip non-JSON lines
      }
    }
  } catch {
    // rg not available or failed
  }

  return c.json({ results });
});

// ── MCP server management ────────────────────────────────────────────────────

app.get("/mcp", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const resolved = resolveOwnedWorkspaceCwd({
    uuid,
    sessionId: c.req.query("sessionId"),
    cwd: c.req.query("cwd"),
  });
  if (!resolved.ok) {
    return c.json({ error: resolved.error }, resolved.status);
  }
  const cwd = resolved.cwd;
  try {
    const { readFileSync, existsSync } = await import("fs");
    const { join } = await import("path");
    const settingsPath = join(cwd, ".claude", "settings.json");
    if (!existsSync(settingsPath)) return c.json({ servers: [] });

    const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const mcpServers = raw?.mcpServers ?? {};
    const servers = Object.entries(mcpServers).map(([name, config]) => ({
      name,
      command: (config as Record<string, unknown>)?.command ?? "",
      args: (config as Record<string, unknown>)?.args ?? [],
      env: (config as Record<string, unknown>)?.env ?? {},
      status: "configured" as const,
    }));

    return c.json({ servers });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.post("/mcp", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const body = await c.req.json();
  const { name, command, args, env, cwd: rawCwd, sessionId } = body as {
    name?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    sessionId?: string;
  };

  if (!name || !command) {
    return c.json({ error: "name and command are required" }, 400);
  }

  const resolved = resolveOwnedWorkspaceCwd({
    uuid,
    sessionId,
    cwd: rawCwd,
  });
  if (!resolved.ok) {
    return c.json({ error: resolved.error }, resolved.status);
  }
  const cwd = resolved.cwd;
  try {
    const { readFileSync, writeFileSync, mkdirSync, existsSync } = await import("fs");
    const { join } = await import("path");
    const settingsPath = join(cwd, ".claude", "settings.json");

    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }

    if (!settings.mcpServers) settings.mcpServers = {};
    (settings.mcpServers as Record<string, unknown>)[name] = { command, args: args ?? [], env: env ?? {} };

    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.delete("/mcp/:name", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const name = c.req.param("name");
  const resolved = resolveOwnedWorkspaceCwd({
    uuid,
    sessionId: c.req.query("sessionId"),
    cwd: c.req.query("cwd"),
  });
  if (!resolved.ok) {
    return c.json({ error: resolved.error }, resolved.status);
  }
  const cwd = resolved.cwd;
  try {
    const { readFileSync, writeFileSync, existsSync } = await import("fs");
    const { join } = await import("path");
    const settingsPath = join(cwd, ".claude", "settings.json");

    if (!existsSync(settingsPath)) return c.json({ error: "Not found" }, 404);
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!name || !(settings.mcpServers as Record<string, unknown>)?.[name]) {
      return c.json({ error: "Not found" }, 404);
    }

    delete (settings.mcpServers as Record<string, unknown>)[name];
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ── Memory files (CLAUDE.md) ─────────────────────────────────────────────────

app.get("/memory", uuidAuth, async (c) => {
  try {
    const { readFileSync, existsSync, readdirSync } = await import("fs");
    const { join } = await import("path");
    const uuid = c.get("uuid")!;
    const resolved = resolveOwnedWorkspaceCwd({
      uuid,
      sessionId: c.req.query("sessionId"),
      cwd: c.req.query("cwd"),
    });
    if (!resolved.ok) {
      return c.json({ error: resolved.error }, resolved.status);
    }
    const cwd = resolved.cwd;

    const files: Array<{ path: string; content: string }> = [];

    // Collect CLAUDE.md files from standard locations
    const locations = [
      join(cwd, "CLAUDE.md"),
      join(cwd, ".claude", "CLAUDE.md"),
    ];

    // Also check .claude/commands/ for custom commands
    const commandsDir = join(cwd, ".claude", "commands");
    if (existsSync(commandsDir)) {
      for (const entry of readdirSync(commandsDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          locations.push(join(commandsDir, entry.name));
        }
      }
    }

    for (const loc of locations) {
      if (existsSync(loc)) {
        const relativePath = loc.replace(cwd + "/", "");
        files.push({
          path: relativePath,
          content: readFileSync(loc, "utf-8"),
        });
      }
    }

    return c.json({ files });
  } catch {
    return c.json({ files: [] });
  }
});

app.put("/memory", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const body = await c.req.json();
  const { path: relativePath, content, cwd: rawCwd, sessionId } = body as {
    path?: string;
    content?: string;
    cwd?: string;
    sessionId?: string;
  };

  if (!relativePath || content === undefined) {
    return c.json({ error: "path and content are required" }, 400);
  }

  // Only allow writing to safe paths
  const safePaths = ["CLAUDE.md", ".claude/CLAUDE.md"];
  const isCommand = relativePath.startsWith(".claude/commands/") && relativePath.endsWith(".md");
  if (!safePaths.includes(relativePath) && !isCommand) {
    return c.json({ error: "Invalid memory file path" }, 400);
  }

  try {
    const { writeFileSync, mkdirSync } = await import("fs");
    const { join, dirname } = await import("path");
    const resolved = resolveOwnedWorkspaceCwd({
      uuid,
      sessionId,
      cwd: rawCwd,
    });
    if (!resolved.ok) {
      return c.json({ error: resolved.error }, resolved.status);
    }
    const cwd = resolved.cwd;
    const fullPath = join(cwd, relativePath);

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);

    return c.json({ success: true });
  } catch {
    return c.json({ error: "Failed to write memory file" }, 500);
  }
});

import commandsCatalog from "./commands/catalog";
import commandsPolicy from "./commands/policy";

app.route("/commands/catalog", commandsCatalog);
app.route("/commands", commandsPolicy);

export default app;
