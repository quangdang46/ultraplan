import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import apiRoutes from "../routes/api/index";
import {
  storeBindSession,
  storeCreateSession,
  storeReset,
  storeUpsertWorkspace,
} from "../store";
import { getAllEventBuses, removeEventBus } from "../transport/event-bus";

function createApp() {
  const app = new Hono();
  app.route("/api", apiRoutes);
  return app;
}

describe("api command routes", () => {
  beforeEach(() => {
    storeReset();
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key);
    }
  });

  afterEach(() => {
    for (const [key] of getAllEventBuses()) {
      removeEventBus(key);
    }
  });

  test("GET /api/commands/catalog includes workspace workflow and project markdown commands", async () => {
    const ownerUuid = "user-command-catalog";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-catalog-"));
    await mkdir(join(root, ".claude", "workflows"), { recursive: true });
    await mkdir(join(root, ".claude", "commands", "ops"), { recursive: true });
    await writeFile(join(root, ".claude", "workflows", "release.md"), "# Release workflow\n");
    await writeFile(
      join(root, ".claude", "commands", "ops", "deploy.md"),
      "---\ndescription: Deploy from legacy command\n---\n# Deploy\n",
    );

    try {
      const response = await createApp().request(
        `/api/commands/catalog?cwd=${encodeURIComponent(root)}`,
        {
          headers: {
            "X-UUID": ownerUuid,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json() as {
        commands: Array<{ id: string; scope: string; requiresWorkspace: boolean }>;
      };

      expect(body.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "release",
            scope: "workspace",
            requiresWorkspace: true,
          }),
          expect.objectContaining({
            id: "ops:deploy",
            scope: "project",
            requiresWorkspace: true,
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("GET /api/suggest/commands returns alias suggestions with argument hints", async () => {
    const ownerUuid = "user-command-suggest-alias";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-suggest-alias-"));

    try {
      const response = await createApp().request(
        `/api/suggest/commands?q=api&cwd=${encodeURIComponent(root)}`,
        {
          headers: {
            "X-UUID": ownerUuid,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json() as {
        suggestions: Array<{ name: string; description: string; argumentHint?: string }>;
      };

      expect(body.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "api",
            description: expect.stringContaining("Alias for /provider"),
            argumentHint: "[anthropic|openai|gemini|grok|bedrock|vertex|foundry|unset]",
          }),
          expect.objectContaining({
            name: "provider",
            argumentHint: "[anthropic|openai|gemini|grok|bedrock|vertex|foundry|unset]",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("GET /api/suggest/commands includes CLI-backed builtin commands outside the static RCS catalog", async () => {
    const ownerUuid = "user-command-suggest-cli-builtin";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-suggest-cli-builtin-"));

    try {
      const response = await createApp().request(
        `/api/suggest/commands?q=statusline&cwd=${encodeURIComponent(root)}`,
        {
          headers: {
            "X-UUID": ownerUuid,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json() as {
        suggestions: Array<{ name: string; description: string; argumentHint?: string }>;
      };

      expect(body.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "statusline",
            description: expect.stringContaining("status"),
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("GET /api/commands/:id/policy resolves project markdown commands by cwd", async () => {
    const ownerUuid = "user-command-policy-cwd";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-policy-cwd-"));
    await mkdir(join(root, ".claude", "commands", "ops"), { recursive: true });
    await writeFile(
      join(root, ".claude", "commands", "ops", "deploy.md"),
      "---\ndescription: Deploy from legacy command\n---\n# Deploy\n",
    );

    try {
      const response = await createApp().request(
        `/api/commands/${encodeURIComponent("ops:deploy")}/policy?cwd=${encodeURIComponent(root)}`,
        {
          headers: {
            "X-UUID": ownerUuid,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json() as { policy: Record<string, unknown> };

      expect(body.policy).toMatchObject({
        allowed: true,
        blocked: false,
        mappedToWebNative: true,
        requiresWorkspace: true,
        executionMode: "prompt",
        origin: "project",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("GET /api/commands/:id/policy resolves workspace commands by sessionId", async () => {
    const ownerUuid = "user-command-policy-session";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-policy-session-"));
    await mkdir(join(root, ".claude", "workflows"), { recursive: true });
    await writeFile(join(root, ".claude", "workflows", "release.md"), "# Release workflow\n");

    const session = storeCreateSession({
      title: "Command Policy Session",
      source: "web",
      cwd: root,
    });
    storeBindSession(session.id, ownerUuid);
    storeUpsertWorkspace(session.id, {
      sourceRoot: root,
      strategy: "copy",
      workspacePath: root,
    });

    try {
      const response = await createApp().request(
        `/api/commands/release/policy?sessionId=${encodeURIComponent(session.id)}`,
        {
          headers: {
            "X-UUID": ownerUuid,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json() as { policy: Record<string, unknown> };

      expect(body.policy).toMatchObject({
        allowed: true,
        blocked: false,
        mappedToWebNative: true,
        requiresWorkspace: true,
        executionMode: "prompt",
        origin: "workspace",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("GET /api/commands/:id/policy resolves CLI-backed builtin commands outside the static RCS catalog", async () => {
    const ownerUuid = "user-command-policy-cli-builtin";
    const root = await mkdtemp(join(tmpdir(), "rcs-api-command-policy-cli-builtin-"));

    try {
      const response = await createApp().request(
        `/api/commands/statusline/policy?cwd=${encodeURIComponent(root)}`,
        {
          headers: {
            "X-UUID": ownerUuid,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json() as { policy: Record<string, unknown> };

      expect(body.policy).toMatchObject({
        allowed: true,
        blocked: false,
        mappedToWebNative: true,
        requiresWorkspace: false,
        executionMode: "prompt",
        origin: "builtin",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
