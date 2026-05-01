/**
 * /api/* routes — Adapter layer for the standalone web UI (web/).
 *
 * The web client calls /api/* endpoints. This file implements the ones
 * that don't map 1:1 to existing /web/* routes (auth, state, tools,
 * suggest, command, chat stream/control, session messages).
 */
import { Hono } from "hono";
import { uuidAuth } from "../../auth/middleware";
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
  archiveSession,
  resolveExistingWebSessionId,
} from "../../services/session";
import {
  storeBindSession,
  storeClearSessionRequiresAction,
  storeCreateUser,
  storeGetSessionWorker,
  storeGetWorkspaceBySession,
  storeListPendingPermissions,
  storeRemovePendingPermission,
  storeListSessionsByOwnerUuid,
} from "../../store";
import { publishSessionEvent, loadPersistedEvents, getLastPersistedSeqNum, hydrateEventBusFromPersistence } from "../../services/transport";
import { getEventBus } from "../../transport/event-bus";
import { log, error as logError } from "../../logger";
import { spawn, spawnSync } from "child_process";
import { subprocessManager } from "../../services/subprocess-manager";
import { resumeSession } from "../../services/session-resume";
import { suggestFiles, suggestCommands } from "../../services/suggest/composerService";
import { runWithSessionContext, getCurrentSessionContext } from "../../services/session-context";
import { listActiveEnvironmentsResponse } from "../../services/environment";
import {
  resolveOwnedWebSessionRuntimeContext,
  upsertSessionRuntimeState,
} from "../../services/session-runtime-context";

const app = new Hono();

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
  return c.json({ session: toWebSessionResponse(session) });
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

app.delete("/sessions/:id", uuidAuth, withSessionContext("id", (c, sessionId) => {
  archiveSession(sessionId);
  return c.json({ success: true });
}));

// Resume an interrupted session (re-spawn subprocess)
app.post("/sessions/:id/resume", uuidAuth, withSessionContext("id", async (c, sessionId) => {
  if (subprocessManager.isRunning(sessionId)) {
    return c.json({ success: true, status: "already_running" });
  }

  try {
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

  // Resolve or auto-create session
  let resolvedId: string | undefined;
  if (rawSessionId) {
    resolvedId = resolveOwnedWebSessionId(rawSessionId, uuid) ?? undefined;
    if (!resolvedId) return c.json({ error: "Session not found or not owned" }, 403);
  } else {
    const session = createSession({
      title: "New Session",
      source: "web",
      cwd: rawCwd ?? null,
    });
    storeBindSession(session.id, uuid);
    resolvedId = session.id;
  }

  const workspace = storeGetWorkspaceBySession(resolvedId);
  const effectiveCwd =
    rawCwd ||
    workspace?.workspacePath ||
    workspace?.sourceRoot ||
    process.cwd();

  // Run the streaming handler with session context isolation
  return runWithSessionContext(resolvedId, uuid, async () => {
    // Subscribe to the EventBus BEFORE spawning the subprocess so we don't
    // miss early events (session_created, message_start).
    const bus = getEventBus(resolvedId, getLastPersistedSeqNum(resolvedId));
    const encoder = new TextEncoder();
    const earlyEvents: Array<{ type: string; payload: unknown }> = [];
    let sseController: ReadableStreamDefaultController<Uint8Array> | null = null;

    // Collect events that arrive before the SSE controller is ready
    const unsub = bus.subscribe((event) => {
      if (event.direction === "inbound") return;
      const data = JSON.stringify({ type: event.type, data: event.payload });
      const chunk = encoder.encode(`event: message\ndata: ${data}\n\n`);

      if (sseController) {
        try { sseController.enqueue(chunk); } catch { /* closed */ }
        if (event.type === "message_end" || event.type === "session_ended") {
          try { sseController.close(); } catch { /* already closed */ }
          unsub();
        }
      } else {
        earlyEvents.push({ type: event.type, payload: event.payload });
      }
    });

    // Publish user message to EventBus (for message history)
    publishSessionEvent(resolvedId, "user", { content: message ?? "", quote }, "inbound");

    // Spawn subprocess (no-op if already running), then enqueue the user message
    try {
      await subprocessManager.getOrSpawn(resolvedId, effectiveCwd);
      subprocessManager.enqueueMessage(
        resolvedId,
        JSON.stringify({ type: "user", message: { role: "user", content: message ?? "" } }),
      );
    } catch (err) {
      unsub();
      logError("Failed to spawn Claude subprocess", String(err));
      return c.json({ error: `Failed to start Claude: ${String(err)}` }, 500);
    }

    // Return live SSE stream from the outbound EventBus
    const stream = new ReadableStream({
      start(controller) {
        sseController = controller;

        // Flush any events that arrived before the controller was ready
        for (const early of earlyEvents) {
          const data = JSON.stringify({ type: early.type, data: early.payload });
          controller.enqueue(encoder.encode(`event: message\ndata: ${data}\n\n`));
        }
        earlyEvents.length = 0;

        c.req.raw.signal.addEventListener("abort", () => {
          unsub();
          try { controller.close(); } catch { /* already closed */ }
        });
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
    // Forward control response to subprocess stdin
    const controlPayload = JSON.stringify({
      type: "control_response",
      request_id: body.request_id,
      approved: body.approved,
      updated_input: body.updatedInput,
      message: body.message,
    });
    subprocessManager.sendControl(resolvedId, controlPayload);
    storeClearSessionRequiresAction(resolvedId);

    // Remove from pending_permissions table
    if (body.request_id) {
      storeRemovePendingPermission(resolvedId, body.request_id);
    }

    publishSessionEvent(resolvedId, "permission_response", {
      request_id: body.request_id,
      approved: body.approved,
      updated_input: body.updatedInput,
      message: body.message,
    }, "inbound");

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
  return c.json({ messages: buildSessionMessagesFromEvents(collectSessionEvents(sessionId)) });
}));

// ── Session stream (SSE with normalized { type, data } shape) ────────────────

app.get("/sessions/:id/stream", uuidAuth, withSessionContext("id", (c, sessionId) => {
  hydrateEventBusFromPersistence(sessionId);
  const bus = getEventBus(sessionId, getLastPersistedSeqNum(sessionId));
  const encoder = new TextEncoder();
  const fromSeqNum = Number(c.req.query("from") || "0");

  const stream = new ReadableStream({
    start(controller) {
      const persisted = loadPersistedEvents(sessionId, fromSeqNum).filter((event) => event.direction !== "inbound");
      const replayedSeqNums = new Set<number>();

      for (const event of persisted) {
        replayedSeqNums.add(event.seqNum);
        const data = JSON.stringify({ type: event.type, data: event.payload });
        controller.enqueue(encoder.encode(`id: ${event.seqNum}\nevent: message\ndata: ${data}\n\n`));
      }

      const missed = bus
        .getEventsSince(fromSeqNum)
        .filter((event) => event.direction !== "inbound" && !replayedSeqNums.has(event.seqNum));

      for (const event of missed) {
        const data = JSON.stringify({ type: event.type, data: event.payload });
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
          const data = JSON.stringify({ type: replayEvent.type, data: replayEvent.payload });
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
        const data = JSON.stringify({ type: replayEvent.type, data: replayEvent.payload });
        controller.enqueue(
          encoder.encode(
            `id: ${replayEvent.seqNum}\nevent: message\ndata: ${data}\n\n`,
          ),
        );
      }

      const unsub = bus.subscribe((event) => {
        if (event.direction === "inbound") return;
        const data = JSON.stringify({ type: event.type, data: event.payload });
        controller.enqueue(encoder.encode(`id: ${event.seqNum}\nevent: message\ndata: ${data}\n\n`));
      });

      c.req.raw.signal.addEventListener("abort", () => {
        unsub();
        controller.close();
      });
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
  const q = c.req.query("q") || "";
  const cwd = c.req.query("cwd") || process.cwd();
  const suggestions = await suggestFiles(q, cwd);
  return c.json({ suggestions });
});

app.get("/suggest/commands", uuidAuth, async (c) => {
  const q = c.req.query("q") || "";
  const cwd = c.req.query("cwd") || process.cwd();
  const suggestions = await suggestCommands(q, cwd);
  return c.json({ suggestions });
});

// ── Command execute ──────────────────────────────────────────────────────────

import {
  getCommand,
  getCommandPolicy,
  isCommandAvailable,
  isExecutableAsWebNative,
  WEB_NATIVE_COMMANDS,
} from "../../services/command/catalog";
import type { CommandDefinition } from "../../services/command/catalog";

app.post("/command/execute", uuidAuth, async (c) => {
  const body = await c.req.json();
  const command = body.command as string;
  const sessionId = body.sessionId as string | undefined;

  if (!command) {
    return c.json({ error: "command is required" }, 400);
  }

  // Extract command name (strip leading slash and args)
  const commandName = command.replace(/^\//, "").split(/\s+/)[0].toLowerCase();

  // Check if command exists in catalog
  const cmd = getCommand(commandName);
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

  // Check workspace requirement
  if (policy.requiresWorkspace && !sessionId) {
    return c.json(
      { error: `Command /${commandName} requires an active session` },
      400,
    );
  }

  // Handle web-native commands (can execute without subprocess)
  if (isExecutableAsWebNative(commandName) && sessionId) {
    const uuid = c.get("uuid")!;
    const resolvedId = resolveOwnedWebSessionId(sessionId, uuid);
    if (resolvedId) {
      return runWithSessionContext(resolvedId, uuid, () => {
        publishSessionEvent(resolvedId, "user", { content: command }, "inbound");
        return c.json({
          success: true,
          delegated: true,
          executionMode: policy.executionMode,
          webNative: true,
        });
      });
    }
  }

  // For prompt-type commands or when no session, delegate to subprocess
  if (sessionId) {
    const uuid = c.get("uuid")!;
    const resolvedId = resolveOwnedWebSessionId(sessionId, uuid);
    if (resolvedId) {
      return runWithSessionContext(resolvedId, uuid, () => {
        publishSessionEvent(resolvedId, "user", { content: command }, "inbound");
        return c.json({
          success: true,
          delegated: true,
          executionMode: policy.executionMode,
        });
      });
    }
  }

  return c.json({ success: false, error: "No active session" }, 400);
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

// ── Rewind ───────────────────────────────────────────────────────────────────

app.post("/sessions/:id/rewind", uuidAuth, withSessionContext("id", (c, sessionId) => {
  publishSessionEvent(sessionId, "user", { content: "/rewind" }, "inbound");
  return c.json({ success: true });
}));

// ── Workspace search (ripgrep) ──────────────────────────────────────────────

app.get("/search", uuidAuth, async (c) => {
  const query = c.req.query("q") || "";
  const limit = Math.min(Number(c.req.query("limit") || "50"), 100);
  if (!query.trim()) return c.json({ results: [] });

  const cwd = c.req.query("cwd") || process.cwd();

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
  // Return list of configured MCP servers from settings
  // Accept cwd as query param so the web client can pass the project root,
  // but fall back to process.cwd() for standalone use
  const cwd = c.req.query("cwd") || process.cwd();
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
  const body = await c.req.json();
  const { name, command, args, env, cwd: rawCwd } = body as {
    name?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
  };

  if (!name || !command) {
    return c.json({ error: "name and command are required" }, 400);
  }

  const cwd = rawCwd || process.cwd();
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
  const name = c.req.param("name");
  // Accept cwd as query param so the web client can pass the project root,
  // but fall back to process.cwd() for standalone use
  const cwd = c.req.query("cwd") || process.cwd();
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
    const cwd = c.req.query("cwd") || process.cwd();

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
  const body = await c.req.json();
  const { path: relativePath, content, cwd: rawCwd } = body as {
    path?: string;
    content?: string;
    cwd?: string;
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
    const cwd = rawCwd || process.cwd();
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
