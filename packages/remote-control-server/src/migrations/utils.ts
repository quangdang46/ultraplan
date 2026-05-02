import { db } from "../db";

type SqliteMasterRow = {
  name: string;
};

type TableInfoRow = {
  name: string;
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

export function columnExists(tableName: string, columnName: string): boolean {
  const rows = db
    .query(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .all() as TableInfoRow[];
  return rows.some((row) => row.name === columnName);
}

export function ensureColumn(
  tableName: string,
  columnName: string,
  alterStatement: string,
): void {
  if (!columnExists(tableName, columnName)) {
    db.exec(alterStatement);
  }
}

export function indexExists(indexName: string): boolean {
  const row = db
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1",
    )
    .get(indexName) as SqliteMasterRow | null;
  return row !== null;
}

export function ensureIndex(indexName: string, createStatement: string): void {
  if (!indexExists(indexName)) {
    db.exec(createStatement);
  }
}

export function tableExists(tableName: string): boolean {
  const row = db
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(tableName) as SqliteMasterRow | null;
  return row !== null;
}

export function ensureTable(tableName: string, createStatement: string): void {
  if (!tableExists(tableName)) {
    db.exec(createStatement);
  }
}
