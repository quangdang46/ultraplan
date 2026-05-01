import { describe, test, expect, beforeEach } from "bun:test";
import {
  STATIC_COMMAND_CATALOG,
  getCommand,
  getCommandPolicy,
  isCommandAvailable,
  isExecutableAsWebNative,
  commandToCatalogEntry,
  getVisibleCommands,
  WEB_NATIVE_COMMANDS,
} from "../services/command/catalog";

describe("Command Catalog", () => {
  describe("STATIC_COMMAND_CATALOG", () => {
    test("contains exactly 54 commands", () => {
      expect(STATIC_COMMAND_CATALOG.length).toBe(54);
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

    test("returns undefined for unknown command", () => {
      const cmd = getCommand("nonexistent");
      expect(cmd).toBeUndefined();
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