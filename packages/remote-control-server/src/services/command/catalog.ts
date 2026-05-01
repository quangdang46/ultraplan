// Shared command catalog - single source of truth for all slash commands
// This module is used by both the catalog and policy routes, as well as
// the suggestion service to provide autocomplete for all available commands.

import { feature } from "bun:bundle";

export type CommandSource =
  | "builtin"
  | "bundled"
  | "plugin"
  | "mcp"
  | "personal"
  | "project"
  | "workspace";

export type CommandType = "prompt" | "local" | "local-jsx";

export type CommandLoadedFrom =
  | "commands_DEPRECATED"
  | "skills"
  | "plugin"
  | "managed"
  | "bundled"
  | "mcp";

export type CommandExecutionHint = "prompt" | "local" | "local-jsx" | "web-native";

export type CommandScope = "global" | "workspace" | "project";

export interface CommandDefinition {
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
  /** Feature flag to check before showing/executing this command (e.g., "VOICE_MODE") */
  featureFlag?: string;
}

export interface CommandCatalogEntry {
  id: string;
  name: string;
  description: string;
  origin: string;
  scope: CommandScope;
  executionHint: CommandExecutionHint;
  subcommands?: CommandCatalogEntry[];
  /** Whether this command requires workspace-level access */
  requiresWorkspace: boolean;
  /** Feature flag that gates this command, if any */
  featureFlag?: string;
}

export interface CommandPolicy {
  allowed: boolean;
  blocked: boolean;
  mappedToWebNative: boolean;
  requiresWorkspace: boolean;
  executionMode: CommandExecutionHint;
  origin: string;
  /** Feature flag that must be enabled for this command */
  featureFlag?: string;
}

/**
 * All 54 commands in the static catalog.
 * This is the single source of truth - do not duplicate in catalog.ts or policy.ts.
 */
export const STATIC_COMMAND_CATALOG: CommandDefinition[] = [
  // Bundled prompt commands
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

  // Builtin local-jsx commands (not user invocable, used internally)
  {
    type: "local-jsx",
    source: "builtin",
    name: "skills",
    description: "List available skills",
    userInvocable: false,
  },

  // Builtin local commands (bridgeSafe = web-native)
  { type: "local", source: "builtin", name: "compact", description: "Summarize conversation", bridgeSafe: true },
  { type: "local", source: "builtin", name: "clear", description: "Clear conversation", bridgeSafe: true },
  { type: "local", source: "builtin", name: "cost", description: "Show token usage", bridgeSafe: true },
  { type: "local", source: "builtin", name: "summary", description: "Summarize conversation", bridgeSafe: true },
  { type: "local", source: "builtin", name: "release-notes", description: "Show changelog", bridgeSafe: true },
  { type: "local", source: "builtin", name: "files", description: "List tracked files", bridgeSafe: true },

  // Builtin prompt commands
  { type: "prompt", source: "builtin", name: "skill", description: "Manage and run skills" },
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

// Command count validation
const COMMAND_COUNT = STATIC_COMMAND_CATALOG.length;
if (COMMAND_COUNT !== 54) {
  console.warn(`[command-catalog] Expected 54 commands, got ${COMMAND_COUNT}`);
}

/**
 * Map command type to execution hint
 */
export function mapCommandTypeToExecutionHint(cmd: CommandDefinition): CommandExecutionHint {
  if (cmd.type === "prompt") return "prompt";
  if (cmd.type === "local-jsx") return "local-jsx";
  if (cmd.type === "local") {
    if (cmd.bridgeSafe === true) return "web-native";
    return "local";
  }
  return "local";
}

/**
 * Map source to origin string
 */
export function mapSourceToOrigin(source: CommandSource): string {
  if (source === "builtin") return "builtin";
  if (source === "bundled") return "bundled";
  if (source === "plugin" || source === "mcp") return "plugin";
  return source;
}

/**
 * Infer scope from command properties
 */
export function inferScope(cmd: CommandDefinition): CommandScope {
  if (cmd.isMcp) return "project";
  if (cmd.loadedFrom === "skills") return "project";
  if (cmd.loadedFrom === "managed") return "workspace";
  return "global";
}

/**
 * Check if a command requires workspace access
 */
export function requiresWorkspace(cmd: CommandDefinition): boolean {
  return (
    cmd.loadedFrom === "skills" ||
    cmd.loadedFrom === "managed" ||
    cmd.source === "workspace" ||
    cmd.source === "mcp"
  );
}

/**
 * Check if a command is available (feature flag gated)
 */
export function isCommandAvailable(cmd: CommandDefinition): boolean {
  if (!cmd.featureFlag) return true;
  if (cmd.featureFlag === "VOICE_MODE" && feature("VOICE_MODE")) return true;
  if (cmd.featureFlag === "BUDDY" && feature("BUDDY")) return true;
  if (cmd.featureFlag === "AGENT_TRIGGERS" && feature("AGENT_TRIGGERS")) return true;
  if (cmd.featureFlag === "DAEMON" && feature("DAEMON")) return true;
  if (cmd.featureFlag === "BRIDGE_MODE" && feature("BRIDGE_MODE")) return true;
  if (cmd.featureFlag === "ULTRATHINK" && feature("ULTRATHINK")) return true;
  if (cmd.featureFlag === "AGENT_TRIGGERS_REMOTE" && feature("AGENT_TRIGGERS_REMOTE")) return true;
  if (cmd.featureFlag === "VERIFICATION_AGENT" && feature("VERIFICATION_AGENT")) return true;
  if (cmd.featureFlag === "EXTRACT_MEMORIES" && feature("EXTRACT_MEMORIES")) return true;
  if (cmd.featureFlag === "ULTRAPLAN" && feature("ULTRAPLAN")) return true;
  return false;
}

/**
 * Convert a CommandDefinition to a CommandCatalogEntry
 */
export function commandToCatalogEntry(cmd: CommandDefinition): CommandCatalogEntry {
  return {
    id: cmd.name,
    name: cmd.name,
    description: cmd.description,
    origin: mapSourceToOrigin(cmd.source),
    scope: inferScope(cmd),
    executionHint: mapCommandTypeToExecutionHint(cmd),
    requiresWorkspace: requiresWorkspace(cmd),
    featureFlag: cmd.featureFlag,
  };
}

/**
 * Get policy for a command
 */
export function getCommandPolicy(cmd: CommandDefinition): CommandPolicy {
  const executionMode: CommandExecutionHint = mapCommandTypeToExecutionHint(cmd);
  const mappedToWebNative = cmd.type === "prompt" || cmd.bridgeSafe === true;
  const policyCmdRequiresWorkspace = requiresWorkspace(cmd);

  return {
    allowed: true,
    blocked: false,
    mappedToWebNative,
    requiresWorkspace: policyCmdRequiresWorkspace,
    executionMode,
    origin: cmd.source,
    featureFlag: cmd.featureFlag,
  };
}

/**
 * Create a map of command name -> command for fast lookup
 */
export const commandMap = new Map<string, CommandDefinition>(
  STATIC_COMMAND_CATALOG.map((cmd) => [cmd.name, cmd]),
);

/**
 * Get command by name
 */
export function getCommand(name: string): CommandDefinition | undefined {
  return commandMap.get(name);
}

/**
 * Filter catalog for visible commands (respects feature flags and userInvocable)
 */
export function getVisibleCommands(includeAll = false): CommandCatalogEntry[] {
  return STATIC_COMMAND_CATALOG
    .filter((cmd) => !cmd.isHidden)
    .filter((cmd) => includeAll || cmd.userInvocable !== false || (cmd.aliases && cmd.aliases.length > 0))
    .filter((cmd) => isCommandAvailable(cmd))
    .map(commandToCatalogEntry)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check if a command should be executed as web-native
 */
export function isWebNativeCommand(cmd: CommandDefinition): boolean {
  return cmd.type === "prompt" || cmd.bridgeSafe === true;
}

/**
 * Commands that can be executed natively in the web context without subprocess
 */
export const WEB_NATIVE_COMMANDS = new Set(
  STATIC_COMMAND_CATALOG.filter((cmd) => isWebNativeCommand(cmd)).map((cmd) => cmd.name),
);

/**
 * Check if a command name represents a web-native executable command
 */
export function isExecutableAsWebNative(commandName: string): boolean {
  return WEB_NATIVE_COMMANDS.has(commandName);
}