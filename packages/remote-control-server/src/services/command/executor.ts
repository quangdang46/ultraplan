import { spawnSync } from "node:child_process";
import { relative } from "node:path";

import providerCommand from "../../../../../src/commands/provider.js";
import { call as callReleaseNotesCommand } from "../../../../../src/commands/release-notes/release-notes.js";
import { enableConfigs } from "../../../../../src/utils/config.js";
import { getCommand } from "./catalog.js";
import { getEventBus } from "../../transport/event-bus.js";
import { storeGetWorkspaceBySession } from "../../store.js";
import {
  getLastPersistedSeqNum,
  loadPersistedEvents,
  publishSessionEvent,
} from "../transport.js";
import type { CommandDefinition } from "./catalog.js";

export interface WebNativeResult {
  success: boolean;
  output?: string;
  clearConversation?: boolean;
  error?: string;
}

export interface WebNativeHandler {
  (cmd: CommandDefinition, args: string[], sessionId: string): WebNativeResult | Promise<WebNativeResult>;
}

type SessionEventSnapshot = {
  type: string;
  payload: unknown;
  seqNum: number;
  createdAt: number;
};

function collectSessionEvents(sessionId: string): SessionEventSnapshot[] {
  const persisted = loadPersistedEvents(sessionId, 0).map((event) => ({
    type: event.type,
    payload: event.payload,
    seqNum: event.seqNum,
    createdAt: event.createdAt,
  }));
  const live = getEventBus(sessionId, getLastPersistedSeqNum(sessionId))
    .getEventsSince(0)
    .map((event) => ({
      type: event.type,
      payload: event.payload,
      seqNum: event.seqNum,
      createdAt: event.createdAt,
    }));

  const bySeq = new Map<number, SessionEventSnapshot>();
  for (const event of [...persisted, ...live]) {
    if (!bySeq.has(event.seqNum)) {
      bySeq.set(event.seqNum, event);
    }
  }

  return [...bySeq.values()].sort((a, b) => a.seqNum - b.seqNum);
}

function getSessionUsageSummary(sessionId: string) {
  const events = collectSessionEvents(sessionId);
  let totalInput = 0;
  let totalOutput = 0;

  for (const event of events) {
    if (event.type !== "message_end") continue;
    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as Record<string, unknown>)
        : null;
    const usage =
      payload?.usage && typeof payload.usage === "object"
        ? (payload.usage as Record<string, unknown>)
        : null;
    totalInput += Number(usage?.inputTokens ?? usage?.input_tokens ?? 0);
    totalOutput += Number(usage?.outputTokens ?? usage?.output_tokens ?? 0);
  }

  const startedAt = events[0]?.createdAt ?? Date.now();
  const endedAt = events[events.length - 1]?.createdAt ?? startedAt;
  const wallDurationSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));

  return {
    totalInput,
    totalOutput,
    wallDurationSeconds,
  };
}

function getWorkspaceDiffStats(sessionId: string) {
  const workspace = storeGetWorkspaceBySession(sessionId);
  const cwd = workspace?.workspacePath || workspace?.sourceRoot;
  if (!cwd) {
    return { linesAdded: 0, linesRemoved: 0 };
  }

  const result = spawnSync("git", ["diff", "--numstat", "--", "."], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0 || !result.stdout) {
    return { linesAdded: 0, linesRemoved: 0 };
  }

  let linesAdded = 0;
  let linesRemoved = 0;

  for (const line of result.stdout.split("\n")) {
    const [added, removed] = line.trim().split("\t");
    if (!added || !removed) continue;
    if (/^\d+$/.test(added)) linesAdded += Number(added);
    if (/^\d+$/.test(removed)) linesRemoved += Number(removed);
  }

  return { linesAdded, linesRemoved };
}

function formatCostSummary(sessionId: string): string {
  const { totalInput, totalOutput, wallDurationSeconds } =
    getSessionUsageSummary(sessionId);
  const { linesAdded, linesRemoved } = getWorkspaceDiffStats(sessionId);

  const inputCost = (totalInput / 1_000_000) * 3;
  const outputCost = (totalOutput / 1_000_000) * 15;
  const totalCost = inputCost + outputCost;

  return [
    `Total cost:            $${totalCost.toFixed(4)}`,
    "Total duration (API):  0s",
    `Total duration (wall): ${wallDurationSeconds}s`,
    `Total code changes:    ${linesAdded} lines added, ${linesRemoved} lines removed`,
    `Usage:                 ${totalInput} input, ${totalOutput} output, 0 cache read, 0 cache write`,
  ].join("\n");
}

const FILE_CONTEXT_TOOL_NAMES = new Set([
  "Read",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "FileRead",
  "FileEdit",
  "FileWrite",
]);

const FILE_CONTEXT_KEYS = new Set(["file_path", "notebook_path"]);

function collectFilePaths(value: unknown, key?: string): string[] {
  if (typeof value === "string") {
    if (key && FILE_CONTEXT_KEYS.has(key) && value.trim().length > 0) {
      return [value.trim()];
    }
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectFilePaths(item, key));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([nestedKey, nestedValue]) =>
    collectFilePaths(nestedValue, nestedKey),
  );
}

function formatFilesInContext(sessionId: string): string {
  const workspace = storeGetWorkspaceBySession(sessionId);
  const cwd = workspace?.workspacePath || workspace?.sourceRoot || process.cwd();
  const files: string[] = [];
  const seen = new Set<string>();

  for (const event of collectSessionEvents(sessionId)) {
    if (event.type !== "tool_start") continue;
    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as Record<string, unknown>)
        : null;
    const toolName =
      typeof payload?.name === "string"
        ? payload.name
        : typeof payload?.tool_name === "string"
          ? payload.tool_name
          : "";
    if (!FILE_CONTEXT_TOOL_NAMES.has(toolName)) {
      continue;
    }

    const input =
      payload?.input && typeof payload.input === "object"
        ? payload.input
        : payload?.tool_input && typeof payload.tool_input === "object"
          ? payload.tool_input
          : null;
    if (!input) continue;

    for (const filePath of collectFilePaths(input)) {
      const display =
        filePath.startsWith("/") ? relative(cwd, filePath) || "." : filePath;
      if (!display || seen.has(display)) continue;
      seen.add(display);
      files.push(display);
    }
  }

  if (files.length === 0) {
    return "No files in context";
  }

  return `Files in context:\n${files.join("\n")}`;
}

function publishAssistantTextResponse(sessionId: string, text: string): void {
  const messageId = `msg_native_${Date.now()}`;
  publishSessionEvent(sessionId, "message_start", { id: messageId }, "outbound");
  publishSessionEvent(
    sessionId,
    "content_delta",
    { delta: { type: "text_delta", text } },
    "outbound",
  );
  publishSessionEvent(
    sessionId,
    "message_end",
    {
      id: messageId,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
    },
    "outbound",
  );
}

const webNativeHandlers: Record<string, WebNativeHandler> = {
  clear: async (_cmd, _args, sessionId) => {
    publishSessionEvent(sessionId, "system", { type: "clear" }, "inbound");
    return { success: true, output: "Conversation cleared", clearConversation: true };
  },
  compact: async (_cmd, _args, sessionId) => {
    publishSessionEvent(sessionId, "user", { content: "/compact" }, "inbound");
    return { success: true, output: "Compacting conversation..." };
  },
  summary: async (_cmd, _args, sessionId) => {
    publishSessionEvent(sessionId, "user", { content: "/summary" }, "inbound");
    return { success: true, output: "Generating summary..." };
  },
  cost: async (_cmd, _args, sessionId) => {
    const output = formatCostSummary(sessionId);
    publishAssistantTextResponse(sessionId, output);
    return { success: true, output };
  },
  files: async (_cmd, _args, sessionId) => {
    const output = formatFilesInContext(sessionId);
    publishAssistantTextResponse(sessionId, output);
    return { success: true, output };
  },
  "release-notes": async (_cmd, _args, sessionId) => {
    const result = await callReleaseNotesCommand();
    if (result.type !== "text") {
      return {
        success: false,
        error: "Unsupported /release-notes result type for web-native execution",
      };
    }

    publishAssistantTextResponse(sessionId, result.value);
    return { success: true, output: result.value };
  },
  provider: async (_cmd, args, sessionId) => {
    enableConfigs();

    const providerModule = await providerCommand.load();
    const result = await providerModule.call(
      args.join(" "),
      {} as unknown as Parameters<typeof providerModule.call>[1],
    );
    if (result.type !== "text") {
      return {
        success: false,
        error: "Unsupported /provider result type for web-native execution",
      };
    }

    publishAssistantTextResponse(sessionId, result.value);
    return { success: true, output: result.value };
  },
};

export async function executeWebNativeCommand(
  commandName: string,
  args: string[],
  sessionId: string,
): Promise<WebNativeResult> {
  const cmd = getCommand(commandName);

  if (!cmd) {
    return { success: false, error: `Unknown command: /${commandName}` };
  }

  if (cmd.type !== "local" || cmd.bridgeSafe !== true) {
    return { success: false, error: `Command /${commandName} is not executable as web-native` };
  }

  const handler = webNativeHandlers[commandName];
  if (handler) {
    return handler(cmd, args, sessionId);
  }

  publishSessionEvent(sessionId, "user", { content: `/${commandName} ${args.join(" ")}`.trim() }, "inbound");
  return { success: true, output: `Delegated /${commandName} to agent` };
}

export function registerWebNativeHandler(commandName: string, handler: WebNativeHandler): void {
  webNativeHandlers[commandName] = handler;
}

export function unregisterWebNativeHandler(commandName: string): void {
  delete webNativeHandlers[commandName];
}
