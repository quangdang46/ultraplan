/**
 * SubprocessManager — spawns and manages Claude CLI subprocesses for RCS.
 *
 * This is the bridge between the web UI's /api/chat/stream endpoint and the
 * Claude CLI binary. It mirrors the CLI's own sessionManager.ts / processStarter.ts
 * but publishes normalized events directly into the RCS EventBus rather than
 * an EventEmitter.
 *
 * Flow:
 *   POST /api/chat/stream
 *     → getOrSpawn(sessionId, cwd)    — forks Claude CLI subprocess
 *     → enqueueMessage(sessionId, …)  — writes JSON line to subprocess stdin
 *     → watchStdout()                 — reads NDJSON from stdout, normalizes, publishes to EventBus
 *     → SSE /api/sessions/:id/stream  — browser subscribes to outbound EventBus events
 */

import { type ChildProcess, spawn } from "child_process";
import { createInterface } from "readline";
import { publishSessionEvent } from "./transport";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

interface PermissionState {
  mode: string;
  approvedTools: string[];
}

interface SubprocessHandle {
  sessionId: string;
  cwd: string;
  startedAt: number;
  done: Promise<"completed" | "interrupted" | "failed">;
  tokenUsage: TokenUsage;
  permissionState: PermissionState;
  enqueueMessage(payload: string): Promise<void>;
  interrupt(): void;
  writeStdin(data: string): void;
  kill(): void;
  destroy(): void;
}

type TurnCompletionReason = "result" | "idle" | "error";

type PendingTurnCompletion = {
  started: boolean;
  resolve: (reason: TurnCompletionReason) => void;
};

// ---------------------------------------------------------------------------
// Helpers — adapted from src/server/routes/chat.ts
// ---------------------------------------------------------------------------

function extractToolResultText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!raw) return "";
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item && typeof (item as Record<string, unknown>).text === "string") {
          return (item as Record<string, unknown>).text as string;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if ("content" in record) return extractToolResultText(record.content);
  }
  return String(raw);
}

function mapUsage(parsed: Record<string, unknown>) {
  const usage =
    parsed.usage && typeof parsed.usage === "object"
      ? (parsed.usage as Record<string, unknown>)
      : null;
  const inputTokens = Number(parsed.inputTokens ?? usage?.input_tokens ?? 0) || 0;
  const outputTokens = Number(parsed.outputTokens ?? usage?.output_tokens ?? 0) || 0;
  return { inputTokens, outputTokens };
}

function formatFailureMessage(
  stderrLines: string[],
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  const stderr = stderrLines.join("\n").trim();
  if (stderr) return stderr;
  if (signal) return `Claude CLI subprocess exited with signal ${signal}`;
  return `Claude CLI subprocess exited with code ${code ?? "unknown"}`;
}

function isSessionStateEvent(
  parsed: Record<string, unknown>,
  state: "idle" | "running" | "requires_action",
): boolean {
  return (
    parsed.type === "system" &&
    parsed.subtype === "session_state_changed" &&
    parsed.state === state
  );
}

function marksTurnStarted(parsed: Record<string, unknown>): boolean {
  if (isSessionStateEvent(parsed, "running") || isSessionStateEvent(parsed, "requires_action")) {
    return true;
  }
  switch (parsed.type) {
    case "assistant":
    case "partial_assistant":
    case "stream_event":
    case "control_request":
    case "tool_use":
    case "tool_result":
    case "error":
      return true;
    case "system":
      return (
        parsed.subtype === "task_started" ||
        parsed.subtype === "task_progress" ||
        parsed.subtype === "task_notification"
      );
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Event normalization — adapted from src/server/routes/chat.ts
// mapSubprocessEventToServerEvents → publishSessionEvent calls
// ---------------------------------------------------------------------------

interface NormalizedEvent {
  type: string;
  data: Record<string, unknown>;
}

function mapStreamEvent(parsed: Record<string, unknown>): NormalizedEvent[] {
  const rawEvent =
    parsed.event && typeof parsed.event === "object"
      ? (parsed.event as Record<string, unknown>)
      : null;
  if (!rawEvent || typeof rawEvent.type !== "string") return [];

  switch (rawEvent.type) {
    case "content_block_start": {
      const block =
        rawEvent.content_block && typeof rawEvent.content_block === "object"
          ? (rawEvent.content_block as Record<string, unknown>)
          : null;
      if (!block || typeof block.type !== "string") return [];
      if (
        block.type === "tool_use" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        return [
          {
            type: "tool_start",
            data: {
              id: block.id,
              name: block.name,
              input:
                block.input && typeof block.input === "object"
                  ? (block.input as Record<string, unknown>)
                  : {},
            },
          },
        ];
      }
      return [];
    }
    case "content_block_delta": {
      const delta =
        rawEvent.delta && typeof rawEvent.delta === "object"
          ? (rawEvent.delta as Record<string, unknown>)
          : null;
      if (!delta || typeof delta.type !== "string") return [];
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        return [
          {
            type: "content_delta",
            data: { delta: { type: "text_delta", text: delta.text } },
          },
        ];
      }
      if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        return [
          {
            type: "thinking_delta",
            data: { delta: { type: "thinking_delta", thinking: delta.thinking } },
          },
        ];
      }
      return [];
    }
    default:
      return [];
  }
}

function mapSubprocessEventToNormalized(
  parsed: Record<string, unknown>,
): NormalizedEvent[] {
  const type = parsed.type as string;

  if (type === "stream_event") {
    return mapStreamEvent(parsed);
  }

  if (type === "assistant" || type === "partial_assistant") {
    const message =
      parsed.message && typeof parsed.message === "object"
        ? (parsed.message as Record<string, unknown>)
        : null;
    const content = Array.isArray(message?.content)
      ? (message!.content as Array<Record<string, unknown>>)
      : [];
    const events: NormalizedEvent[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object" || typeof block.type !== "string") continue;
      if (block.type === "text" && typeof block.text === "string") {
        events.push({
          type: "content_delta",
          data: { delta: { type: "text_delta", text: block.text } },
        });
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        events.push({
          type: "thinking_delta",
          data: { delta: { type: "thinking_delta", thinking: block.thinking } },
        });
      } else if (
        block.type === "tool_use" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        events.push({
          type: "tool_start",
          data: {
            id: block.id,
            name: block.name,
            input:
              block.input && typeof block.input === "object"
                ? (block.input as Record<string, unknown>)
                : {},
          },
        });
      } else if (block.type === "tool_result") {
        const toolCallId =
          typeof block.tool_use_id === "string"
            ? block.tool_use_id
            : typeof block.id === "string"
              ? block.id
              : "";
        events.push({
          type: "tool_result",
          data: {
            toolCallId,
            id: toolCallId,
            result: extractToolResultText(
              (block as { content?: unknown; text?: unknown }).content ?? block.text,
            ),
            exitCode: 0,
            timeDisplay: "",
          },
        });
      }
    }
    return events;
  }

  switch (type) {
    case "control_request":
      return [
        {
          type: "permission_request",
          data: {
            request_id: String(parsed.request_id ?? ""),
            request: parsed.request,
          },
        },
      ];
    case "control_response":
      return [
        {
          type: "control_response",
          data: {
            request_id: String(parsed.request_id ?? ""),
            approved: Boolean(parsed.approved),
          },
        },
      ];
    case "tool_use":
      return [
        {
          type: "tool_start",
          data: {
            id: String(parsed.id ?? ""),
            name: String(parsed.name ?? "unknown_tool"),
            input:
              parsed.input && typeof parsed.input === "object"
                ? (parsed.input as Record<string, unknown>)
                : {},
          },
        },
      ];
    case "tool_result": {
      const toolCallId = String(parsed.toolCallId ?? parsed.tool_use_id ?? parsed.id ?? "");
      return [
        {
          type: "tool_result",
          data: {
            toolCallId,
            id: toolCallId,
            result: extractToolResultText(parsed.result ?? parsed.content),
            exitCode: Boolean(parsed.isError ?? parsed.is_error) ? 1 : 0,
            timeDisplay: "",
          },
        },
      ];
    }
    case "result": {
      const events: NormalizedEvent[] = [];
      if (Boolean(parsed.is_error)) {
        const errors = Array.isArray(parsed.errors)
          ? parsed.errors.filter((x): x is string => typeof x === "string")
          : [];
        events.push({
          type: "error",
          data: {
            code: String(parsed.subtype ?? "SUBPROCESS_ERROR"),
            message:
              errors.join("\n").trim() ||
              (typeof parsed.result === "string" ? parsed.result : "Claude CLI error"),
          },
        });
      }
      events.push({
        type: "message_end",
        data: {
          id: String(parsed.uuid ?? parsed.id ?? `msg_${Date.now()}`),
          usage: mapUsage(parsed),
        },
      });
      return events;
    }
    case "error":
      return [
        {
          type: "error",
          data: {
            code: String(parsed.code ?? "SUBPROCESS_ERROR"),
            message: String(parsed.message ?? "Claude CLI subprocess error"),
          },
        },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// SubprocessHandle implementation
// ---------------------------------------------------------------------------

const READY_TIMEOUT_MS = 250;
const STDERR_LINE_LIMIT = 50;

class SubprocessHandleImpl implements SubprocessHandle {
  sessionId: string;
  cwd: string;
  startedAt: number;
  done: Promise<"completed" | "interrupted" | "failed">;
  tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  permissionState: PermissionState = { mode: "default", approvedTools: [] };

  private child: ChildProcess;
  private messageChain: Promise<void> = Promise.resolve();
  private stderrLines: string[] = [];
  private pendingTurnCompletion: PendingTurnCompletion | null = null;
  private sawTextPartial = false;
  private sawThinkingPartial = false;
  private streamedToolIds = new Set<string>();

  constructor(sessionId: string, child: ChildProcess, cwd: string) {
    this.sessionId = sessionId;
    this.child = child;
    this.cwd = cwd;
    this.startedAt = Date.now();

    this.done = new Promise((resolve) => {
      child.on("close", (code, signal) => {
        const status =
          signal === "SIGTERM" || signal === "SIGINT"
            ? "interrupted"
            : code === 0
              ? "completed"
              : "failed";

        if (status !== "completed") {
          publishSessionEvent(
            sessionId,
            "error",
            {
              code: "SUBPROCESS_EXIT",
              message: formatFailureMessage(this.stderrLines, code, signal),
            },
            "outbound",
          );
        }

        publishSessionEvent(
          sessionId,
          "session_ended",
          { sessionId, reason: status === "completed" ? "completed" : "error" },
          "outbound",
        );

        resolve(status);
      });

      child.on("error", (error) => {
        this.captureStderr((error as Error).message);
        publishSessionEvent(
          sessionId,
          "error",
          { code: "SUBPROCESS_SPAWN_ERROR", message: (error as Error).message },
          "outbound",
        );
        resolve("failed");
      });
    });

    this.watchStdout();
    this.watchStderr();
  }

  private watchStdout(): void {
    if (!this.child.stdout) return;
    const rl = createInterface({ input: this.child.stdout });

    rl.on("line", (line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== "object") return;
        const record = parsed as Record<string, unknown>;
        this.onSubprocessEvent(record);
        this.observeTurnCompletion(record);
      } catch {
        // skip non-JSON lines
      }
    });
  }

  private watchStderr(): void {
    if (!this.child.stderr) return;
    const rl = createInterface({ input: this.child.stderr });
    rl.on("line", (line) => this.captureStderr(line));
  }

  private captureStderr(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.stderrLines.push(trimmed);
    if (this.stderrLines.length > STDERR_LINE_LIMIT) this.stderrLines.shift();
  }

  /**
   * Translate a raw subprocess NDJSON event into normalized events and publish
   * to the EventBus as outbound. Applies deduplication so that final `assistant`
   * messages don't repeat content already streamed as `content_delta`.
   */
  private onSubprocessEvent(parsed: Record<string, unknown>): void {
    const type = parsed.type as string;

    // Track token usage from result events
    if (type === "result") {
      const usage = mapUsage(parsed);
      this.tokenUsage = {
        inputTokens: this.tokenUsage.inputTokens + usage.inputTokens,
        outputTokens: this.tokenUsage.outputTokens + usage.outputTokens,
      };
    }

    if (type === "stream_event") {
      const events = mapSubprocessEventToNormalized(parsed);
      for (const event of events) {
        if (event.type === "content_delta") this.sawTextPartial = true;
        if (event.type === "thinking_delta") this.sawThinkingPartial = true;
        if (event.type === "tool_start") this.streamedToolIds.add(event.data.id as string);
        publishSessionEvent(this.sessionId, event.type, event.data, "outbound");
      }
      return;
    }

    if (type === "assistant" || type === "partial_assistant") {
      const events = mapSubprocessEventToNormalized(parsed).filter((event) => {
        if (this.sawThinkingPartial && event.type === "thinking_delta") return false;
        if (this.sawTextPartial && event.type === "content_delta") return false;
        if (
          (event.type === "tool_start" || event.type === "tool_result") &&
          this.streamedToolIds.has(
            event.type === "tool_start"
              ? (event.data.id as string)
              : ((event.data.toolCallId ?? event.data.id) as string) ?? "",
          )
        ) {
          return false;
        }
        return true;
      });
      // Reset dedup state after final assistant message
      this.sawTextPartial = false;
      this.sawThinkingPartial = false;
      this.streamedToolIds.clear();
      for (const event of events) {
        publishSessionEvent(this.sessionId, event.type, event.data, "outbound");
      }
      return;
    }

    if (type === "result" || type === "error") {
      this.sawTextPartial = false;
      this.sawThinkingPartial = false;
      this.streamedToolIds.clear();
    }

    const events = mapSubprocessEventToNormalized(parsed);
    for (const event of events) {
      publishSessionEvent(this.sessionId, event.type, event.data, "outbound");
    }
  }

  private observeTurnCompletion(parsed: Record<string, unknown>): void {
    if (parsed.type === "result") {
      this.resolvePendingTurn("result");
      return;
    }
    if (parsed.type === "error") {
      this.resolvePendingTurn("error");
      return;
    }
    const pending = this.pendingTurnCompletion;
    if (!pending) return;
    if (marksTurnStarted(parsed)) pending.started = true;
    if (pending.started && isSessionStateEvent(parsed, "idle")) {
      this.resolvePendingTurn("idle");
    }
  }

  private resolvePendingTurn(reason: TurnCompletionReason): void {
    const pending = this.pendingTurnCompletion;
    if (!pending) return;
    this.pendingTurnCompletion = null;
    pending.resolve(reason);
  }

  private waitForTurnCompletion(): Promise<TurnCompletionReason> {
    if (this.pendingTurnCompletion) {
      throw new Error("Cannot wait for multiple turn completions concurrently");
    }
    return new Promise((resolve) => {
      this.pendingTurnCompletion = { started: false, resolve };
    });
  }

  async waitForReady(timeoutMs = READY_TIMEOUT_MS): Promise<void> {
    await Promise.race([
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      this.done.then((status) => {
        throw new Error(
          formatFailureMessage(
            this.stderrLines,
            this.child.exitCode,
            null,
          ),
        );
      }),
    ]);
  }

  async enqueueMessage(data: string): Promise<void> {
    const previous = this.messageChain;
    const run = previous.then(async () => {
      if (this.child.killed || this.child.exitCode !== null) {
        throw new Error(
          formatFailureMessage(this.stderrLines, this.child.exitCode, null),
        );
      }
      const waitForTurn = this.waitForTurnCompletion();
      this.writeStdin(data);
      const outcome = await Promise.race([waitForTurn, this.done]);
      if (outcome !== "result" && outcome !== "idle" && outcome !== "error") {
        throw new Error(
          formatFailureMessage(
            this.stderrLines,
            this.child.exitCode,
            this.child.signalCode as NodeJS.Signals | null,
          ),
        );
      }
    });
    this.messageChain = run.catch(() => undefined);
    await run;
  }

  writeStdin(data: string): void {
    if (this.child.stdin && !this.child.stdin.destroyed) {
      this.child.stdin.write(data + "\n");
    }
  }

  interrupt(): void {
    this.writeStdin(
      JSON.stringify({
        type: "control_request",
        request_id: crypto.randomUUID(),
        request: { subtype: "interrupt" },
      }),
    );
  }

  kill(): void {
    if (!this.child.killed) this.child.kill("SIGTERM");
  }

  destroy(): void {
    this.pendingTurnCompletion = null;
  }
}

// ---------------------------------------------------------------------------
// Subprocess spawn — adapted from src/server/processStarter.ts
// Uses process.execPath (bun) and process.argv[1] (this script) so the child
// inherits the same runtime. Falls back to the CLI entrypoint path.
// ---------------------------------------------------------------------------

function spawnSubprocess(sessionId: string, cwd: string, resume: boolean): ChildProcess {
  // Re-exec the same bun binary with the CLI entrypoint
  const execPath = process.execPath; // e.g. /usr/local/bin/bun
  const cliEntry = process.argv[1]!; // the RCS entrypoint — we need the CLI path

  // The CLI entrypoint relative to project root
  // Walk up from __dirname (packages/remote-control-server/src/services/) to root
  const { resolve, dirname } = require("path") as typeof import("path");
  const { fileURLToPath } = require("url") as typeof import("url");
  // __dirname in ESM context
  const serviceDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(serviceDir, "../../../../..");
  const cliPath = resolve(projectRoot, "src/entrypoints/cli.tsx");

  const args = [
    "run",
    "--smol",
    cliPath,
    "--print",
    "--verbose",
    "--include-partial-messages",
    ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId]),
    "--input-format", "stream-json",
    "--output-format", "stream-json",
  ];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CODE_SESSION_KIND: "server",
    CLAUDE_CODE_ENVIRONMENT_KIND: "server",
    CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
  };

  return spawn(execPath, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// ---------------------------------------------------------------------------
// SubprocessManager singleton
// ---------------------------------------------------------------------------

class SubprocessManager {
  private handles = new Map<string, SubprocessHandleImpl>();
  private capacity = 16;

  async getOrSpawn(sessionId: string, cwd: string, resume = false): Promise<SubprocessHandle> {
    const existing = this.handles.get(sessionId);
    if (existing) return existing;

    if (this.handles.size >= this.capacity) {
      throw new Error(`Subprocess capacity reached (${this.capacity} concurrent sessions)`);
    }

    const child = spawnSubprocess(sessionId, cwd, resume);
    const handle = new SubprocessHandleImpl(sessionId, child, cwd);
    this.handles.set(sessionId, handle);

    try {
      await handle.waitForReady();
    } catch (error) {
      this.handles.delete(sessionId);
      handle.kill();
      handle.destroy();
      throw error;
    }

    // Publish initial events
    publishSessionEvent(
      sessionId,
      "session_created",
      { sessionId, cwd, createdAt: new Date().toISOString() },
      "outbound",
    );
    publishSessionEvent(
      sessionId,
      "message_start",
      { id: `msg_${Date.now()}` },
      "outbound",
    );

    // Cleanup on subprocess exit
    void handle.done.then(() => {
      this.handles.delete(sessionId);
      handle.destroy();
    });

    return handle;
  }

  enqueueMessage(sessionId: string, payload: string): void {
    const handle = this.handles.get(sessionId);
    if (handle) {
      void handle.enqueueMessage(payload);
    }
  }

  interrupt(sessionId: string): void {
    this.handles.get(sessionId)?.interrupt();
  }

  sendControl(sessionId: string, controlPayload: string): void {
    this.handles.get(sessionId)?.writeStdin(controlPayload);
  }

  isRunning(sessionId: string): boolean {
    return this.handles.has(sessionId);
  }

  get(sessionId: string): SubprocessHandleImpl | undefined {
    return this.handles.get(sessionId);
  }

  async destroyAll(): Promise<void> {
    const handles = Array.from(this.handles.values());
    for (const h of handles) h.kill();
    await Promise.all(handles.map((h) => h.done.catch(() => "failed")));
  }
}

export const subprocessManager = new SubprocessManager();
export type { SubprocessHandle, TokenUsage, PermissionState };
