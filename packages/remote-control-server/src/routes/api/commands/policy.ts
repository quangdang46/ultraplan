import { Hono } from "hono";
import { uuidAuth } from "../../../auth/middleware";

export type CommandPolicy = {
  allowed: boolean;
  blocked: boolean;
  mappedToWebNative: boolean;
  requiresWorkspace: boolean;
  executionMode: "prompt" | "local" | "local-jsx" | "web-native";
  origin: string;
};

type CommandSource = "builtin" | "bundled" | "plugin" | "mcp" | "personal" | "project" | "workspace" | string;
type CommandType = "prompt" | "local" | "local-jsx";
type CommandLoadedFrom = "commands_DEPRECATED" | "skills" | "plugin" | "managed" | "bundled" | "mcp";

interface MinimalCommand {
  type: CommandType;
  source: CommandSource;
  loadedFrom?: CommandLoadedFrom;
  name: string;
  aliases?: string[];
  description: string;
  isHidden?: boolean;
  userInvocable?: boolean;
  isMcp?: boolean;
  bridgeSafe?: boolean;
}

const STATIC_COMMAND_CATALOG: MinimalCommand[] = [
  { type: "prompt", source: "builtin", name: "skill", description: "Manage and run skills" },
  { type: "prompt", source: "bundled", name: "dream", description: "Organize session memories" },
  { type: "prompt", source: "bundled", name: "verify", description: "Verify task completion" },
  { type: "prompt", source: "bundled", name: "simplify", description: "Simplify code" },
  { type: "prompt", source: "bundled", name: "batch", description: "Run tasks in batch" },
  { type: "prompt", source: "bundled", name: "stuck", description: "Handle stuck processes" },
  { type: "prompt", source: "bundled", name: "loop", description: "Loop control for agents" },
  { type: "prompt", source: "bundled", name: "remember", description: "Remember information" },
  { type: "prompt", source: "bundled", name: "debug", description: "Debug helper" },
  { type: "prompt", source: "bundled", name: "cron-list", description: "List scheduled tasks" },
  { type: "prompt", source: "bundled", name: "cron-delete", description: "Delete scheduled task" },
  { type: "prompt", source: "bundled", name: "lorem-ipsum", description: "Generate placeholder text" },
  { type: "prompt", source: "bundled", name: "keybindings", description: "Keybinding help" },
  { type: "prompt", source: "bundled", name: "update-config", description: "Update configuration" },
  { type: "prompt", source: "bundled", name: "skillify", description: "Create skill from session" },
  { type: "local-jsx", source: "builtin", name: "skills", description: "List available skills", userInvocable: false },
  { type: "local", source: "builtin", name: "compact", description: "Summarize conversation", bridgeSafe: true },
  { type: "local", source: "builtin", name: "clear", description: "Clear conversation", bridgeSafe: true },
  { type: "local", source: "builtin", name: "cost", description: "Show token usage", bridgeSafe: true },
  { type: "local", source: "builtin", name: "summary", description: "Summarize conversation", bridgeSafe: true },
  { type: "local", source: "builtin", name: "release-notes", description: "Show changelog", bridgeSafe: true },
  { type: "local", source: "builtin", name: "files", description: "List tracked files", bridgeSafe: true },
  { type: "prompt", source: "builtin", name: "session", description: "Session management" },
  { type: "prompt", source: "builtin", name: "help", description: "Show help" },
  { type: "prompt", source: "builtin", name: "plan", description: "Enter plan mode" },
  { type: "prompt", source: "builtin", name: "btw", description: "Quick note" },
  { type: "prompt", source: "builtin", name: "feedback", description: "Send feedback" },
  { type: "prompt", source: "builtin", name: "theme", description: "Change terminal theme" },
  { type: "prompt", source: "builtin", name: "color", description: "Change agent color" },
  { type: "prompt", source: "builtin", name: "vim", description: "Toggle vim mode" },
  { type: "prompt", source: "builtin", name: "usage", description: "Show usage info" },
  { type: "prompt", source: "builtin", name: "config", description: "View or update configuration" },
  { type: "prompt", source: "builtin", name: "mcp", description: "Manage MCP servers" },
  { type: "prompt", source: "builtin", name: "doctor", description: "Run diagnostics" },
  { type: "prompt", source: "builtin", name: "review", description: "Review code changes" },
  { type: "prompt", source: "builtin", name: "init", description: "Initialize project" },
  { type: "prompt", source: "builtin", name: "rewind", description: "Undo last turn" },
  { type: "prompt", source: "builtin", name: "permissions", description: "Manage tool permissions" },
  { type: "prompt", source: "builtin", name: "memory", description: "Manage memory files" },
  { type: "prompt", source: "builtin", name: "model", description: "Switch model" },
  { type: "prompt", source: "builtin", name: "attach", description: "Attach to a session" },
  { type: "prompt", source: "builtin", name: "detach", description: "Detach from session" },
  { type: "prompt", source: "builtin", name: "send", description: "Send message to session" },
  { type: "prompt", source: "builtin", name: "pipes", description: "Manage pipes" },
  { type: "prompt", source: "builtin", name: "tasks", description: "Task management" },
  { type: "prompt", source: "builtin", name: "agents", description: "Agent management" },
  { type: "prompt", source: "builtin", name: "plugin", description: "Plugin management" },
  { type: "prompt", source: "builtin", name: "resume", description: "Resume session" },
  { type: "prompt", source: "builtin", name: "status", description: "Show status" },
  { type: "prompt", source: "builtin", name: "diff", description: "Show changes" },
  { type: "prompt", source: "builtin", name: "branch", description: "Branch operations" },
  { type: "prompt", source: "builtin", name: "commit", description: "Commit changes" },
  { type: "prompt", source: "builtin", name: "login", description: "Login to service" },
  { type: "prompt", source: "builtin", name: "logout", description: "Logout from service" },
];

const commandMap = new Map<string, MinimalCommand>(
  STATIC_COMMAND_CATALOG.map((cmd) => [cmd.name, cmd]),
);

const app = new Hono();

app.get("/:id/policy", uuidAuth, async (c) => {
  const commandId = c.req.param("id");

  if (!commandId) {
    return c.json({ error: "command id is required" }, 400);
  }

  const cmd = commandMap.get(commandId);

  if (!cmd) {
    return c.json({ error: "Command not found" }, 404);
  }

  let executionMode: CommandPolicy["executionMode"] = "local";
  if (cmd.type === "prompt") executionMode = "prompt";
  else if (cmd.type === "local-jsx") executionMode = "local-jsx";
  else if (cmd.type === "local") {
    if (cmd.bridgeSafe === true) executionMode = "web-native";
    else executionMode = "local";
  }

  const mappedToWebNative =
    cmd.type === "prompt" || cmd.bridgeSafe === true;

  const requiresWorkspace =
    cmd.loadedFrom === "skills" ||
    cmd.loadedFrom === "managed" ||
    cmd.source === "workspace";

  const policy: CommandPolicy = {
    allowed: true,
    blocked: false,
    mappedToWebNative,
    requiresWorkspace,
    executionMode,
    origin: cmd.source,
  };

  return c.json({ policy });
});

export default app;