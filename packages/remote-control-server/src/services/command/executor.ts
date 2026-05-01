import { getCommand, isWebNativeCommand } from "./catalog.js";
import { publishSessionEvent } from "../transport.js";
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
    publishSessionEvent(sessionId, "user", { content: "/cost" }, "inbound");
    return { success: true, output: "Calculating token usage..." };
  },
  files: async (_cmd, _args, sessionId) => {
    publishSessionEvent(sessionId, "user", { content: "/files" }, "inbound");
    return { success: true, output: "Listing tracked files..." };
  },
  releaseNotes: async (_cmd, _args, sessionId) => {
    publishSessionEvent(sessionId, "user", { content: "/release-notes" }, "inbound");
    return { success: true, output: "Loading release notes..." };
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

  if (!isWebNativeCommand(cmd)) {
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