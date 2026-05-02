// Shared command catalog - single source of truth for all slash commands
// This module is used by both the catalog and policy routes, as well as
// the suggestion service to provide autocomplete for all available commands.

import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, parse, sep as pathSep } from "node:path";

import { feature } from "bun:bundle";
import {
  getCommands as getCliCommands,
  getCommandName as getCliCommandName,
  isBridgeSafeCommand,
} from "../../../../../src/commands.js";
import {
  parseSkillFrontmatterFields,
  transformSkillFiles,
} from "../../../../../src/skills/loadSkillsDir.js";
import type { Command as CliCommand } from "../../../../../src/types/command.js";
import { enableConfigs } from "../../../../../src/utils/config.js";
import {
  getProjectDirsUpToHome,
  type MarkdownFile,
} from "../../../../../src/utils/markdownConfigLoader.js";
import { parseFrontmatter } from "../../../../../src/utils/frontmatterParser.js";

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
  argumentHint?: string;
  isHidden?: boolean;
  userInvocable?: boolean;
  isMcp?: boolean;
  bridgeSafe?: boolean;
  scope?: CommandScope;
  requiresWorkspace?: boolean;
  /** Feature flag to check before showing/executing this command (e.g., "VOICE_MODE") */
  featureFlag?: string;
}

export interface CommandCatalogEntry {
  id: string;
  name: string;
  description: string;
  argumentHint?: string;
  origin: string;
  scope: CommandScope;
  executionHint: CommandExecutionHint;
  aliases?: string[];
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

const WORKFLOW_DIR_NAME = ".claude/workflows";
const WORKFLOW_FILE_EXTENSIONS = new Set([".yml", ".yaml", ".md"]);

/**
 * All 65 commands in the static catalog.
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
  {
    type: "local",
    source: "builtin",
    name: "provider",
    aliases: ["api"],
    description: "Switch API provider (anthropic/openai/gemini/grok/bedrock/vertex/foundry)",
    argumentHint:
      "[anthropic|openai|gemini|grok|bedrock|vertex|foundry|unset]",
    bridgeSafe: true,
  },

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
  // Additional builtin prompt commands (missing from initial catalog)
  { type: "prompt", source: "builtin", name: "effort", description: "Adjust thinking effort" },
  { type: "prompt", source: "builtin", name: "privacy-settings", description: "Privacy settings" },
  { type: "prompt", source: "builtin", name: "hooks", description: "Manage hooks" },
  { type: "prompt", source: "builtin", name: "export", description: "Export conversation" },
  { type: "prompt", source: "builtin", name: "usage-report", description: "Usage report" },
  { type: "prompt", source: "builtin", name: "upgrade", description: "Check for upgrades" },
  { type: "prompt", source: "builtin", name: "ultra-review", description: "Comprehensive code review" },
  // Local commands that can run as web-native
  { type: "local", source: "builtin", name: "context", description: "Show context info", bridgeSafe: true },
  { type: "local", source: "builtin", name: "copy", description: "Copy to clipboard", bridgeSafe: true },
  { type: "local", source: "builtin", name: "ide", description: "IDE integration", bridgeSafe: true },
  { type: "local", source: "builtin", name: "rename", description: "Rename session", bridgeSafe: true },
  { type: "local", source: "builtin", name: "passes", description: "Show pass metrics", bridgeSafe: true },
];

// Command count validation
const COMMAND_COUNT = STATIC_COMMAND_CATALOG.length;
if (COMMAND_COUNT !== 67) {
  console.warn(`[command-catalog] Expected 65 commands, got ${COMMAND_COUNT}`);
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
  if (cmd.scope) return cmd.scope;
  if (cmd.isMcp) return "project";
  if (cmd.source === "workspace") return "workspace";
  if (cmd.source === "project") return "project";
  if (cmd.loadedFrom === "skills") return "project";
  if (cmd.loadedFrom === "managed") return "workspace";
  return "global";
}

/**
 * Check if a command requires workspace access
 */
export function requiresWorkspace(cmd: CommandDefinition): boolean {
  if (typeof cmd.requiresWorkspace === "boolean") {
    return cmd.requiresWorkspace;
  }
  return (
    cmd.loadedFrom === "skills" ||
    cmd.loadedFrom === "managed" ||
    (cmd.loadedFrom === "commands_DEPRECATED" && cmd.source !== "personal") ||
    cmd.source === "project" ||
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
    argumentHint: cmd.argumentHint,
    origin: mapSourceToOrigin(cmd.source),
    scope: inferScope(cmd),
    executionHint: mapCommandTypeToExecutionHint(cmd),
    aliases: cmd.aliases,
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
export const commandAliasMap = new Map<string, CommandDefinition>(
  STATIC_COMMAND_CATALOG.flatMap((cmd) =>
    (cmd.aliases ?? []).map((alias) => [alias, cmd] as const),
  ),
);

function commandMatchesName(
  cmd: CommandDefinition,
  name: string,
): boolean {
  return cmd.name === name || cmd.aliases?.includes(name) === true;
}

function mapCliCommandSource(cmd: CliCommand): CommandSource {
  switch (cmd.source) {
    case "builtin":
    case "bundled":
    case "plugin":
    case "mcp":
      return cmd.source;
    case "userSettings":
    case "flagSettings":
      return "personal";
    case "projectSettings":
    case "localSettings":
      return "project";
    case "policySettings":
      return "workspace";
  }
}

function mapCliCommandScope(cmd: CliCommand): CommandScope {
  switch (cmd.source) {
    case "projectSettings":
    case "localSettings":
      return "project";
    default:
      if (cmd.kind === "workflow") return "workspace";
      if (cmd.isMcp || cmd.source === "mcp") return "project";
      return "global";
  }
}

function cliCommandRequiresWorkspace(cmd: CliCommand): boolean {
  if (cmd.kind === "workflow") return true;
  if (cmd.isMcp || cmd.source === "mcp") return true;
  return cmd.source === "projectSettings" || cmd.source === "localSettings";
}

function deriveCliArgumentHint(cmd: CliCommand): string | undefined {
  if (typeof cmd.argumentHint === "string") {
    return cmd.argumentHint;
  }

  if (cmd.type === "prompt" && Array.isArray(cmd.argNames) && cmd.argNames.length > 0) {
    return cmd.argNames.map((arg) => `<${arg}>`).join(" ");
  }

  return undefined;
}

function mapCliLoadedFrom(cmd: CliCommand): CommandLoadedFrom | undefined {
  if (cmd.loadedFrom === "commands_DEPRECATED") return "commands_DEPRECATED";
  if (cmd.loadedFrom === "skills") return "skills";
  if (cmd.loadedFrom === "plugin") return "plugin";
  if (cmd.loadedFrom === "managed") return "managed";
  if (cmd.loadedFrom === "bundled") return "bundled";
  if (cmd.loadedFrom === "mcp") return "mcp";
  if (cmd.source === "policySettings") return "managed";
  return undefined;
}

function toCliCommandDefinition(cmd: CliCommand): CommandDefinition | null {
  const name = getCliCommandName(cmd).trim().toLowerCase();
  if (!name) {
    return null;
  }

  const aliases = [...new Set((cmd.aliases ?? []).map((alias) => alias.toLowerCase()))]
    .filter((alias) => alias !== name);

  return {
    type: cmd.type,
    source: mapCliCommandSource(cmd),
    loadedFrom: mapCliLoadedFrom(cmd),
    name,
    aliases: aliases.length > 0 ? aliases : undefined,
    description: cmd.description,
    argumentHint: deriveCliArgumentHint(cmd),
    isHidden: cmd.isHidden,
    userInvocable: cmd.userInvocable,
    isMcp: cmd.isMcp,
    bridgeSafe: cmd.bridgeSafe,
    scope: mapCliCommandScope(cmd),
    requiresWorkspace: cliCommandRequiresWorkspace(cmd),
  };
}

function dedupeCommands(commands: CommandDefinition[]): CommandDefinition[] {
  const byName = new Map<string, CommandDefinition>();
  for (const cmd of commands) {
    const existing = byName.get(cmd.name);
    if (!existing) {
      byName.set(cmd.name, cmd);
      continue;
    }

    const aliases = [...new Set([...(existing.aliases ?? []), ...(cmd.aliases ?? [])])];

    byName.set(cmd.name, {
      ...existing,
      description: existing.description || cmd.description,
      argumentHint: existing.argumentHint ?? cmd.argumentHint,
      aliases: aliases.length > 0 ? aliases : undefined,
      loadedFrom: existing.loadedFrom ?? cmd.loadedFrom,
      isHidden: existing.isHidden ?? cmd.isHidden,
      userInvocable: existing.userInvocable ?? cmd.userInvocable,
      isMcp: existing.isMcp ?? cmd.isMcp,
      bridgeSafe: existing.bridgeSafe ?? cmd.bridgeSafe,
      scope: existing.scope ?? cmd.scope,
      requiresWorkspace: existing.requiresWorkspace ?? cmd.requiresWorkspace,
      featureFlag: existing.featureFlag ?? cmd.featureFlag,
    });
  }
  return [...byName.values()];
}

async function withCatalogAuthBootstrap<T>(
  loader: () => Promise<T>,
): Promise<T> {
  const hadApiKey = typeof process.env.ANTHROPIC_API_KEY === "string";
  const hadOauthToken =
    typeof process.env.CLAUDE_CODE_OAUTH_TOKEN === "string";

  if (!hadApiKey && !hadOauthToken) {
    process.env.ANTHROPIC_API_KEY = "rcs-command-catalog-bootstrap";
  }

  try {
    return await loader();
  } finally {
    if (!hadApiKey && !hadOauthToken) {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }
}

async function getCliCommandDefinitions(cwd?: string): Promise<CommandDefinition[]> {
  try {
    enableConfigs();
    return await withCatalogAuthBootstrap(async () => {
      const commands = await getCliCommands(cwd ?? process.cwd());

      return dedupeCommands(
        commands
          .filter((cmd) => isBridgeSafeCommand(cmd))
          .map(toCliCommandDefinition)
          .filter((cmd): cmd is CommandDefinition => cmd !== null),
      ).sort((a, b) => a.name.localeCompare(b.name));
    });
  } catch (error) {
    return [];
  }
}

function toWorkflowCommandDefinition(name: string): CommandDefinition {
  return {
    type: "prompt",
    source: "workspace",
    name,
    description: `Run workflow: ${name}`,
  };
}

function isSkillFile(filePath: string): boolean {
  return /^skill\.md$/i.test(basename(filePath));
}

function buildNamespace(targetDir: string, baseDir: string): string {
  const normalizedBaseDir = baseDir.endsWith(pathSep)
    ? baseDir.slice(0, -1)
    : baseDir;

  if (targetDir === normalizedBaseDir) {
    return "";
  }

  const relativePath = targetDir.slice(normalizedBaseDir.length + 1);
  return relativePath ? relativePath.split(pathSep).join(":") : "";
}

function getSkillCommandName(filePath: string, baseDir: string): string {
  const skillDirectory = dirname(filePath);
  const parentOfSkillDir = dirname(skillDirectory);
  const commandBaseName = basename(skillDirectory);

  const namespace = buildNamespace(parentOfSkillDir, baseDir);
  return namespace ? `${namespace}:${commandBaseName}` : commandBaseName;
}

function getRegularCommandName(filePath: string, baseDir: string): string {
  const fileName = basename(filePath);
  const fileDirectory = dirname(filePath);
  const commandBaseName = fileName.replace(/\.md$/i, "");

  const namespace = buildNamespace(fileDirectory, baseDir);
  return namespace ? `${namespace}:${commandBaseName}` : commandBaseName;
}

function getLegacyCommandName(file: MarkdownFile): string {
  return isSkillFile(file.filePath)
    ? getSkillCommandName(file.filePath, file.baseDir)
    : getRegularCommandName(file.filePath, file.baseDir);
}

async function findProjectCommandMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findProjectCommandMarkdownFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function getProjectCommandMarkdownFiles(cwd: string): Promise<MarkdownFile[]> {
  const commandDirs = getProjectDirsUpToHome("commands", cwd);
  const filesByBaseDir = await Promise.all(
    commandDirs.map(async (baseDir) => {
      const files = await findProjectCommandMarkdownFiles(baseDir);
      return Promise.all(
        files.map(async (filePath) => {
          const raw = await readFile(filePath, "utf8");
          const parsed = parseFrontmatter(raw, filePath);
          return {
            filePath,
            baseDir,
            source: "projectSettings" as const,
            frontmatter: parsed.frontmatter,
            content: parsed.content,
          } satisfies MarkdownFile;
        }),
      );
    }),
  );

  return filesByBaseDir.flat();
}

async function getLegacyCommandDefinitions(cwd: string): Promise<CommandDefinition[]> {
  try {
    const markdownFiles = await getProjectCommandMarkdownFiles(cwd);
    const processedFiles = transformSkillFiles(markdownFiles);

    return processedFiles
      .map((file) => {
        const name = getLegacyCommandName(file);
        if (!name || commandMap.has(name)) {
          return null;
        }

        const parsed = parseSkillFrontmatterFields(
          file.frontmatter,
          file.content,
          name,
          "Custom command",
        );

        return {
          type: "prompt" as const,
          source: "project" as const,
          loadedFrom: "commands_DEPRECATED" as const,
          name,
          description: parsed.description,
          isHidden: !parsed.userInvocable,
          userInvocable: parsed.userInvocable,
        } satisfies CommandDefinition;
      })
      .filter((cmd): cmd is CommandDefinition => cmd !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function getWorkflowCommandDefinitions(cwd: string): Promise<CommandDefinition[]> {
  try {
    const files = await readdir(join(cwd, WORKFLOW_DIR_NAME));
    return files
      .filter((file) => WORKFLOW_FILE_EXTENSIONS.has(parse(file).ext.toLowerCase()))
      .map((file) => parse(file).name)
      .filter((name, index, names) => names.indexOf(name) === index)
      .map(toWorkflowCommandDefinition)
      .filter((cmd) => !commandMap.has(cmd.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function getWorkspaceCommandDefinitions(cwd?: string): Promise<CommandDefinition[]> {
  if (!cwd) {
    return [];
  }

  const [workflowCommands, legacyCommands] = await Promise.all([
    getWorkflowCommandDefinitions(cwd),
    getLegacyCommandDefinitions(cwd),
  ]);

  return [...workflowCommands, ...legacyCommands];
}

/**
 * Get command by name
 */
export function getCommand(name: string): CommandDefinition | undefined {
  return commandMap.get(name) ?? commandAliasMap.get(name);
}

export async function getCommandForWorkspace(
  name: string,
  cwd?: string,
): Promise<CommandDefinition | undefined> {
  const staticCommand = getCommand(name);
  if (staticCommand) {
    return staticCommand;
  }

  const cliCommands = await getCliCommandDefinitions(cwd);
  const cliCommand = cliCommands.find((cmd) => commandMatchesName(cmd, name));
  if (cliCommand) {
    return cliCommand;
  }

  const workspaceCommands = await getWorkspaceCommandDefinitions(cwd);
  return workspaceCommands.find((cmd) => commandMatchesName(cmd, name));
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

export async function getVisibleCommandsForWorkspace(
  cwd?: string,
  includeAll = false,
): Promise<CommandCatalogEntry[]> {
  const [cliCommands, workspaceCommands] = await Promise.all([
    getCliCommandDefinitions(cwd),
    getWorkspaceCommandDefinitions(cwd),
  ]);

  return dedupeCommands([
    ...STATIC_COMMAND_CATALOG,
    ...cliCommands,
    ...workspaceCommands,
  ])
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
