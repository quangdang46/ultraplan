import { describe, test, expect, beforeEach } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STATIC_COMMAND_CATALOG,
  getCommand,
  getCommandForWorkspace,
  getCommandPolicy,
  isCommandAvailable,
  isExecutableAsWebNative,
  commandToCatalogEntry,
  getVisibleCommands,
  getVisibleCommandsForWorkspace,
  WEB_NATIVE_COMMANDS,
} from "../services/command/catalog";

describe("Command Catalog", () => {
  describe("STATIC_COMMAND_CATALOG", () => {
    test("contains exactly 65 commands", () => {
      expect(STATIC_COMMAND_CATALOG.length).toBe(67);
    });

    test("all commands have required fields", () => {
      for (const cmd of STATIC_COMMAND_CATALOG) {
        expect(cmd.name).toBeDefined();
        expect(cmd.type).toBeDefined();
        expect(cmd.source).toBeDefined();
        expect(cmd.description).toBeDefined();
      }
    });

    test("all command names are lowercase", () => {
      for (const cmd of STATIC_COMMAND_CATALOG) {
        expect(cmd.name).toBe(cmd.name.toLowerCase());
      }
    });
  });

  describe("getCommand", () => {
    test("returns command for valid name", () => {
      const cmd = getCommand("clear");
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe("clear");
    });

    test("resolves command aliases to their canonical command", () => {
      const cmd = getCommand("api");
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe("provider");
      expect(cmd?.aliases).toContain("api");
    });

    test("returns undefined for unknown command", () => {
      const cmd = getCommand("nonexistent");
      expect(cmd).toBeUndefined();
    });

    test("resolves workspace workflow commands by name", async () => {
      const root = await mkdtemp(join(tmpdir(), "rcs-command-catalog-workflow-"));

      try {
        await mkdir(join(root, ".claude", "workflows"), { recursive: true });
        await writeFile(join(root, ".claude", "workflows", "release.md"), "# Release workflow\n");

        const cmd = await getCommandForWorkspace("release", root);
        expect(cmd).toEqual({
          type: "prompt",
          source: "workspace",
          name: "release",
          description: "Run workflow: release",
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    test("resolves CLI-backed builtin prompt commands that are not in the static RCS catalog", async () => {
      const root = await mkdtemp(join(tmpdir(), "rcs-command-catalog-cli-builtin-"));

      try {
        const cmd = await getCommandForWorkspace("statusline", root);
        expect(cmd).toMatchObject({
          type: "prompt",
          source: "builtin",
          name: "statusline",
          description: expect.stringContaining("status"),
          scope: "global",
          requiresWorkspace: false,
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    test("resolves legacy project commands by name and namespace", async () => {
      const root = await mkdtemp(join(tmpdir(), "rcs-command-catalog-legacy-command-"));

      try {
        await mkdir(join(root, ".claude", "commands", "ops"), { recursive: true });
        await mkdir(join(root, ".claude", "commands", "audit"), { recursive: true });
        await writeFile(
          join(root, ".claude", "commands", "ops", "deploy.md"),
          "---\ndescription: Deploy the service\n---\n# Deploy\n",
        );
        await writeFile(
          join(root, ".claude", "commands", "audit", "SKILL.md"),
          "# Audit release\n",
        );

        expect(await getCommandForWorkspace("ops:deploy", root)).toMatchObject({
          type: "prompt",
          source: "project",
          loadedFrom: "commands_DEPRECATED",
          name: "ops:deploy",
          description: "Deploy the service",
        });

        expect(await getCommandForWorkspace("audit", root)).toMatchObject({
          type: "prompt",
          source: "project",
          loadedFrom: "commands_DEPRECATED",
          name: "audit",
          description: "Audit release",
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("getCommandPolicy", () => {
    test("returns policy for clear command", () => {
      const cmd = getCommand("clear")!;
      const policy = getCommandPolicy(cmd);
      expect(policy.allowed).toBe(true);
      expect(policy.blocked).toBe(false);
      expect(policy.executionMode).toBe("web-native");
    });

    test("returns policy for skill command", () => {
      const cmd = getCommand("skill")!;
      const policy = getCommandPolicy(cmd);
      expect(policy.allowed).toBe(true);
      expect(policy.executionMode).toBe("prompt");
    });
  });

  describe("isExecutableAsWebNative", () => {
    test("returns true for web-native commands", () => {
      expect(isExecutableAsWebNative("clear")).toBe(true);
      expect(isExecutableAsWebNative("compact")).toBe(true);
      expect(isExecutableAsWebNative("cost")).toBe(true);
      expect(isExecutableAsWebNative("summary")).toBe(true);
    });

    test("returns true for prompt commands", () => {
      expect(isExecutableAsWebNative("skill")).toBe(true);
      expect(isExecutableAsWebNative("help")).toBe(true);
      expect(isExecutableAsWebNative("model")).toBe(true);
    });

    test("returns false for local-only commands", () => {
      expect(isExecutableAsWebNative("skills")).toBe(false);
    });
  });

  describe("WEB_NATIVE_COMMANDS", () => {
    test("contains expected commands", () => {
      expect(WEB_NATIVE_COMMANDS.has("clear")).toBe(true);
      expect(WEB_NATIVE_COMMANDS.has("compact")).toBe(true);
      expect(WEB_NATIVE_COMMANDS.has("skill")).toBe(true);
      expect(WEB_NATIVE_COMMANDS.has("provider")).toBe(true);
    });
  });

  describe("commandToCatalogEntry", () => {
    test("converts command to catalog entry", () => {
      const cmd = getCommand("clear")!;
      const entry = commandToCatalogEntry(cmd);
      expect(entry.id).toBe("clear");
      expect(entry.name).toBe("clear");
      expect(entry.origin).toBe("builtin");
      expect(entry.scope).toBe("global");
      expect(entry.requiresWorkspace).toBe(false);
    });

    test("infers project scope for mcp commands", () => {
      const cmd = { name: "test", type: "prompt" as const, source: "mcp" as const, description: "test", isMcp: true };
      const entry = commandToCatalogEntry(cmd);
      expect(entry.scope).toBe("project");
    });
  });

  describe("getVisibleCommands", () => {
    test("returns visible commands sorted by name", () => {
      const commands = getVisibleCommands();
      expect(commands.length).toBeGreaterThan(0);
      const names = commands.map((c) => c.name);
      expect(names).toEqual(names.slice().sort());
    });

    test("respects userInvocable filter", () => {
      const commands = getVisibleCommands(false);
      const skillsCmd = commands.find((c) => c.name === "skills");
      expect(skillsCmd).toBeUndefined();
    });

    test("includeAll returns all commands", () => {
      const commands = getVisibleCommands(true);
      const skillsCmd = commands.find((c) => c.name === "skills");
      expect(skillsCmd).toBeDefined();
    });

    test("includes workspace workflow commands in the visible list", async () => {
      const root = await mkdtemp(join(tmpdir(), "rcs-visible-workflows-"));

      try {
        await mkdir(join(root, ".claude", "workflows"), { recursive: true });
        await writeFile(join(root, ".claude", "workflows", "deploy.yaml"), "name: deploy\n");

        const commands = await getVisibleCommandsForWorkspace(root);
        expect(commands.find((c) => c.name === "deploy")).toMatchObject({
          name: "deploy",
          scope: "workspace",
          executionHint: "prompt",
          requiresWorkspace: true,
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    test("includes CLI-backed builtin prompt commands in the workspace-visible list", async () => {
      const root = await mkdtemp(join(tmpdir(), "rcs-visible-cli-builtin-"));

      try {
        const commands = await getVisibleCommandsForWorkspace(root);
        expect(commands.find((c) => c.name === "statusline")).toMatchObject({
          name: "statusline",
          scope: "global",
          executionHint: "prompt",
          requiresWorkspace: false,
        });
        expect(commands.find((c) => c.name === "provider")).toMatchObject({
          name: "provider",
          aliases: ["api"],
          argumentHint:
            "[anthropic|openai|gemini|grok|bedrock|vertex|foundry|unset]",
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    test("includes visible legacy project commands in the workspace list", async () => {
      const root = await mkdtemp(join(tmpdir(), "rcs-visible-legacy-commands-"));

      try {
        await mkdir(join(root, ".claude", "commands"), { recursive: true });
        await writeFile(
          join(root, ".claude", "commands", "deploy.md"),
          "---\ndescription: Deploy from markdown command\n---\n# ignored title\n",
        );
        await writeFile(
          join(root, ".claude", "commands", "hidden.md"),
          "---\nuser-invocable: false\n---\n# Hidden command\n",
        );

        const commands = await getVisibleCommandsForWorkspace(root);
        expect(commands.find((c) => c.name === "deploy")).toMatchObject({
          name: "deploy",
          scope: "project",
          executionHint: "prompt",
          requiresWorkspace: true,
          description: "Deploy from markdown command",
        });
        expect(commands.find((c) => c.name === "hidden")).toBeUndefined();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("isCommandAvailable", () => {
    test("returns true for commands without feature flag", () => {
      const cmd = getCommand("clear")!;
      expect(isCommandAvailable(cmd)).toBe(true);
    });
  });
});

describe("Command Policy Enforcement", () => {
  test("commands without feature flag are always available", () => {
    const cmd = getCommand("clear")!;
    expect(isCommandAvailable(cmd)).toBe(true);
  });

  test("prompt commands are executable as web-native", () => {
    for (const cmd of STATIC_COMMAND_CATALOG) {
      if (cmd.type === "prompt") {
        expect(isExecutableAsWebNative(cmd.name)).toBe(true);
      }
    }
  });

  test("bridgeSafe commands are web-native", () => {
    for (const cmd of STATIC_COMMAND_CATALOG) {
      if (cmd.bridgeSafe === true) {
        expect(isExecutableAsWebNative(cmd.name)).toBe(true);
      }
    }
  });
});
