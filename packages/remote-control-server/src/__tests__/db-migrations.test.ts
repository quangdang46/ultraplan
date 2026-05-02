import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { db, initDb, runMigrations } from "../db";
import { storeCreateSession, storeGetWorkspaceBySession, storeReset } from "../store";

type TableInfoRow = {
  name: string;
};

function getColumnNames(tableName: string): string[] {
  return (db
    .query(`PRAGMA table_info("${tableName}")`)
    .all() as TableInfoRow[]).map((row) => row.name);
}

describe("db migrations", () => {
  beforeAll(async () => {
    initDb();
    await runMigrations();
  });

  beforeEach(() => {
    storeReset();
  });

  test("are safe to run repeatedly", async () => {
    await runMigrations();
    await runMigrations();

    expect(getColumnNames("events")).toContain("after_seq");
    expect(getColumnNames("sessions")).toContain("workspace_id");
    expect(getColumnNames("workspaces")).toEqual(
      expect.arrayContaining([
        "lifecycle_policy",
        "materialization_strategy",
        "parent_workspace_id",
      ]),
    );
  });

  test("preserve current session schema after repeated runs", async () => {
    await runMigrations();
    await runMigrations();

    const session = storeCreateSession({
      title: "schema smoke test",
      cwd: "/tmp/schema-smoke-test",
    });
    const workspace = storeGetWorkspaceBySession(session.id);

    expect(workspace?.sessionId).toBe(session.id);
    expect(workspace?.workspacePath).toBe("/tmp/schema-smoke-test");
  });
});
