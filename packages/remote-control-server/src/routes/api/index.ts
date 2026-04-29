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
  archiveSession,
} from "../../services/session";
import { storeBindSession, storeListSessionsByOwnerUuid } from "../../store";
import { publishSessionEvent } from "../../services/transport";
import { getEventBus } from "../../transport/event-bus";
import { log, error as logError } from "../../logger";
import { spawn } from "child_process";
import { subprocessManager } from "../../services/subprocess-manager";

const app = new Hono();

// ── Auth ─────────────────────────────────────────────────────────────────────

app.post("/auth/init", async (c) => {
  const uuid = crypto.randomUUID();
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
  });
  storeBindSession(session.id, uuid);
  return c.json({ session: toWebSessionResponse(session) });
});

app.get("/sessions/:id", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const sessionId = resolveOwnedWebSessionId(c.req.param("id")!, uuid);
  if (!sessionId) return c.json({ error: "Session not found" }, 404);
  const session = getSession(sessionId);
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json(toWebSessionResponse(session));
});

app.patch("/sessions/:id", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const sessionId = resolveOwnedWebSessionId(c.req.param("id")!, uuid);
  if (!sessionId) return c.json({ error: "Session not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (body.name || body.title) {
    updateSessionTitle(sessionId, body.name || body.title);
  }
  return c.json({ success: true });
});

app.delete("/sessions/:id", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const sessionId = resolveOwnedWebSessionId(c.req.param("id")!, uuid);
  if (!sessionId) return c.json({ error: "Session not found" }, 404);
  archiveSession(sessionId);
  return c.json({ success: true });
});

// ── State ────────────────────────────────────────────────────────────────────

app.get("/state", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const sessions = listWebSessionsByOwnerUuid(uuid);
  const active = sessions.find((s) => subprocessManager.isRunning(s.id));
  const handle = active ? subprocessManager.get(active.id) : undefined;

  return c.json({
    permissionMode: handle?.permissionState.mode ?? "default",
    approvedTools: handle?.permissionState.approvedTools ?? [],
    pendingTools: [],
    model: "claude-sonnet-4-6",
    tokenUsage: handle?.tokenUsage ?? { inputTokens: 0, outputTokens: 0 },
    cwd: handle?.cwd ?? process.cwd(),
    gitBranch: null,
    connected: Boolean(handle),
  });
});

app.patch("/state", uuidAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  // Acknowledge state updates (model, permissionMode, thinkingEffort)
  // These are stored client-side; the server just confirms receipt
  return c.json({ success: true, ...(body as Record<string, unknown>) });
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
    const session = createSession({ title: "New Session", source: "web" });
    storeBindSession(session.id, uuid);
    resolvedId = session.id;
  }

  const effectiveCwd = rawCwd || process.cwd();

  // Publish user message to EventBus (for message history)
  publishSessionEvent(resolvedId, "user", { content: message ?? "", quote }, "inbound");

  // Spawn subprocess (no-op if already running), then enqueue the user message
  try {
    await subprocessManager.getOrSpawn(resolvedId, effectiveCwd);
    subprocessManager.enqueueMessage(
      resolvedId,
      JSON.stringify({ role: "user", content: message ?? "" }),
    );
  } catch (err) {
    logError("Failed to spawn Claude subprocess", String(err));
    return c.json({ error: `Failed to start Claude: ${String(err)}` }, 500);
  }

  // Return live SSE stream from the outbound EventBus
  const bus = getEventBus(resolvedId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const unsub = bus.subscribe((event) => {
        if (event.direction === "inbound") return;
        const data = JSON.stringify({ type: event.type, data: event.payload });
        controller.enqueue(encoder.encode(`event: message\ndata: ${data}\n\n`));

        if (event.type === "message_end" || event.type === "session_ended") {
          try { controller.close(); } catch { /* already closed */ }
          unsub();
        }
      });

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

  // Forward control response to subprocess stdin
  const controlPayload = JSON.stringify({
    type: "control_response",
    request_id: body.request_id,
    approved: body.approved,
    updated_input: body.updatedInput,
    message: body.message,
  });
  subprocessManager.sendControl(resolvedId, controlPayload);

  publishSessionEvent(resolvedId, "permission_response", {
    request_id: body.request_id,
    approved: body.approved,
    updated_input: body.updatedInput,
    message: body.message,
  }, "inbound");

  return c.json({ success: true });
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

  subprocessManager.interrupt(resolvedId);
  publishSessionEvent(resolvedId, "interrupt", {}, "inbound");

  return c.json({ success: true });
});

// ── Session messages ─────────────────────────────────────────────────────────

app.get("/sessions/:id/messages", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const sessionId = c.req.param("id")!;
  const resolvedId = resolveOwnedWebSessionId(sessionId, uuid);
  if (!resolvedId) {
    return c.json({ error: "Session not found" }, 404);
  }

  const bus = getEventBus(resolvedId);
  const events = bus.getEventsSince(0);

  const messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: string;
  }> = [];

  for (const event of events) {
    const payload = event.payload as Record<string, unknown> | null;
    if (event.type === "user" || event.type === "user_message") {
      messages.push({
        id: event.id,
        role: "user",
        content: String(payload?.content ?? payload?.message ?? ""),
        timestamp: new Date(event.createdAt ?? Date.now()).toISOString(),
      });
    }
  }

  return c.json({ messages });
});

// ── Session stream (SSE with normalized { type, data } shape) ────────────────

app.get("/sessions/:id/stream", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const sessionId = c.req.param("id")!;
  const resolvedId = resolveOwnedWebSessionId(sessionId, uuid);
  if (!resolvedId) {
    return c.json({ error: "Session not found" }, 404);
  }

  const bus = getEventBus(resolvedId);
  const encoder = new TextEncoder();
  const fromSeqNum = Number(c.req.query("from") || "0");

  const stream = new ReadableStream({
    start(controller) {
      if (fromSeqNum > 0) {
        const missed = bus.getEventsSince(fromSeqNum);
        for (const event of missed) {
          const data = JSON.stringify({ type: event.type, data: event.payload });
          controller.enqueue(encoder.encode(`id: ${event.seqNum}\nevent: message\ndata: ${data}\n\n`));
        }
      }

      const unsub = bus.subscribe((event) => {
        if (event.direction === "inbound") return;
        const data = JSON.stringify({ type: event.type, data: event.payload });
        controller.enqueue(encoder.encode(`id: ${event.seqNum}\nevent: message\ndata: ${data}\n\n`));
      });

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

// ── Suggest ──────────────────────────────────────────────────────────────────

app.get("/suggest/files", uuidAuth, async (c) => {
  const q = c.req.query("q") || "";
  const cwd = c.req.query("cwd") || process.cwd();
  const items: Array<{ path: string; name: string; isDirectory: boolean }> = [];

  try {
    const { readdirSync, statSync } = await import("fs");
    const { join, basename } = await import("path");
    const entries = readdirSync(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (!q || entry.name.toLowerCase().includes(q.toLowerCase())) {
        const fullPath = join(cwd, entry.name);
        let isDir = false;
        try { isDir = statSync(fullPath).isDirectory(); } catch { /* ignore */ }
        items.push({ path: fullPath, name: entry.name, isDirectory: isDir });
      }
    }
  } catch {
    // ignore fs errors
  }

  return c.json({ suggestions: { items, isPartial: false } });
});

app.get("/suggest/commands", uuidAuth, async (c) => {
  const query = c.req.query("q") || "";
  const commands = [
    { name: "/compact", description: "Summarize conversation to free context" },
    { name: "/model", description: "Switch model (opus/sonnet/haiku)" },
    { name: "/export", description: "Export conversation" },
    { name: "/help", description: "Show help" },
    { name: "/clear", description: "Clear conversation" },
    { name: "/memory", description: "Manage memory files" },
    { name: "/mcp", description: "Manage MCP servers" },
    { name: "/doctor", description: "Run diagnostics" },
    { name: "/rewind", description: "Undo last turn" },
  ].filter((cmd) => !query || cmd.name.includes(query.toLowerCase()));
  return c.json({ suggestions: commands });
});

// ── Command execute ──────────────────────────────────────────────────────────

app.post("/command/execute", uuidAuth, async (c) => {
  const body = await c.req.json();
  const command = body.command as string;
  const sessionId = body.sessionId as string | undefined;

  if (!command) {
    return c.json({ error: "command is required" }, 400);
  }

  if (sessionId) {
    const uuid = c.get("uuid")!;
    const resolvedId = resolveOwnedWebSessionId(sessionId, uuid);
    if (resolvedId) {
      publishSessionEvent(resolvedId, "user", { content: command }, "inbound");
      return c.json({ success: true, delegated: true });
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

  const bus = getEventBus(resolvedId);
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

app.post("/sessions/:id/rewind", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const sessionId = c.req.param("id")!;
  const resolvedId = resolveOwnedWebSessionId(sessionId, uuid);
  if (!resolvedId) return c.json({ error: "Session not found" }, 404);

  publishSessionEvent(resolvedId, "user", { content: "/rewind" }, "inbound");
  return c.json({ success: true });
});

// ── Workspace search (ripgrep) ──────────────────────────────────────────────

app.get("/search", uuidAuth, async (c) => {
  const query = c.req.query("q") || "";
  const limit = Math.min(Number(c.req.query("limit") || "50"), 100);
  if (!query.trim()) return c.json({ results: [] });

  const cwd = process.cwd();

  const rgArgs = [
    "--json",
    "--max-count", String(limit),
    "--ignore-case",
    "--max-filesize", "1M",
    "--glob", "!node_modules",
    "--glob", "!.git",
    "--glob", "!dist",
    "--glob", "!.next",
    query,
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
    await new Promise<void>((resolve) => {
      const proc = spawn("rg", rgArgs, { cwd, timeout: 5000 });
      let buf = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf-8");
        const lines = buf.split("\n");
        buf = lines.pop() || "";

        for (const line of lines) {
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
      });

      proc.on("close", () => resolve());
      proc.on("error", () => resolve());
    });
  } catch {
    // rg not available or failed
  }

  return c.json({ results });
});

// ── MCP server management ────────────────────────────────────────────────────

app.get("/mcp", uuidAuth, async (c) => {
  // Return list of configured MCP servers from settings
  const cwd = process.cwd();
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
  } catch {
    return c.json({ servers: [] });
  }
});

app.post("/mcp", uuidAuth, async (c) => {
  const body = await c.req.json();
  const { name, command, args, env } = body as {
    name?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
  };

  if (!name || !command) {
    return c.json({ error: "name and command are required" }, 400);
  }

  try {
    const { readFileSync, writeFileSync, mkdirSync, existsSync } = await import("fs");
    const { join } = await import("path");
    const cwd = process.cwd();
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
  } catch {
    return c.json({ error: "Failed to save MCP server config" }, 500);
  }
});

app.delete("/mcp/:name", uuidAuth, async (c) => {
  const name = c.req.param("name");
  try {
    const { readFileSync, writeFileSync, existsSync } = await import("fs");
    const { join } = await import("path");
    const cwd = process.cwd();
    const settingsPath = join(cwd, ".claude", "settings.json");

    if (!existsSync(settingsPath)) return c.json({ error: "Not found" }, 404);
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const mcpName = c.req.param("name");
    if (!mcpName || !(settings.mcpServers as Record<string, unknown>)?.[mcpName]) {
      return c.json({ error: "Not found" }, 404);
    }

    delete (settings.mcpServers as Record<string, unknown>)[mcpName];
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return c.json({ success: true });
  } catch {
    return c.json({ error: "Failed to delete MCP server" }, 500);
  }
});

// ── Memory files (CLAUDE.md) ─────────────────────────────────────────────────

app.get("/memory", uuidAuth, async (c) => {
  try {
    const { readFileSync, existsSync, readdirSync } = await import("fs");
    const { join } = await import("path");
    const cwd = process.cwd();

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
  const { path: relativePath, content } = body as {
    path?: string;
    content?: string;
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
    const cwd = process.cwd();
    const fullPath = join(cwd, relativePath);

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);

    return c.json({ success: true });
  } catch {
    return c.json({ error: "Failed to write memory file" }, 500);
  }
});

export default app;
