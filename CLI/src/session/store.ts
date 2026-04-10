// @ts-ignore better-sqlite3 typings use `export =`; runtime uses ESM-compatible default import here.
import Database from "better-sqlite3"
import { mkdir, rename } from "node:fs/promises"
import path from "node:path"
import { SESSIONS_DB_FILE } from "../shared/constants"

export interface SessionRecord {
  id: string
  projectId: string
  directory: string
  title: string
  parentId?: string
  dependenceLevel: 1 | 2 | 3 | 4 | 5
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface SessionRecordListInput {
  projectId?: string
  directory?: string
  includeArchived?: boolean
  limit?: number
}

export interface SessionRecordUpsertInput {
  id: string
  projectId: string
  directory: string
  title: string
  parentId?: string
  dependenceLevel: 1 | 2 | 3 | 4 | 5
  createdAt?: string
  updatedAt?: string
  archivedAt?: string
}

export interface SessionRecordPatch {
  projectId?: string
  title?: string
  dependenceLevel?: 1 | 2 | 3 | 4 | 5
  updatedAt?: string
  archivedAt?: string
}

interface SessionRecordRow {
  id: string
  project_id: string
  directory: string
  title: string
  parent_id: string | null
  dependence_level: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

let sqlite: Database.Database | null = null

function nowIso(): string {
  return new Date().toISOString()
}

function mapRow(row: SessionRecordRow): SessionRecord {
  const dependence = row.dependence_level
  const dependenceLevel: SessionRecord["dependenceLevel"] =
    dependence === 1 || dependence === 2 || dependence === 3 || dependence === 4 || dependence === 5
      ? dependence
      : 3

  return {
    id: row.id,
    projectId: row.project_id,
    directory: row.directory,
    title: row.title,
    parentId: row.parent_id ?? undefined,
    dependenceLevel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined,
  }
}

async function getDb(): Promise<Database.Database> {
  if (sqlite) return sqlite

  const dbPath = path.resolve(process.cwd(), SESSIONS_DB_FILE)
  await mkdir(path.dirname(dbPath), { recursive: true })

  const init = (): Database.Database => {
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_messages (
        session_id TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        message_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, message_index)
      );
      CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages (session_id, message_index);

      CREATE TABLE IF NOT EXISTS session_records (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        directory TEXT NOT NULL,
        title TEXT NOT NULL,
        parent_id TEXT,
        dependence_level INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_session_records_project_updated ON session_records (project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_session_records_directory_updated ON session_records (directory, updated_at DESC);
    `)
    return db
  }

  try {
    sqlite = init()
  } catch {
    const backup = `${dbPath}.corrupt.${Date.now()}.bak`
    try {
      await rename(dbPath, backup)
      console.warn(`CodeTwin sessions DB looked corrupted; moved it to '${backup}' and reinitialized.`)
    } catch {
      console.warn("CodeTwin sessions DB looked corrupted; backup move failed, attempting fresh initialization.")
    }
    sqlite = init()
  }

  return sqlite
}

export async function upsertSessionRecord(input: SessionRecordUpsertInput): Promise<SessionRecord> {
  const db = await getDb()
  const createdAt = input.createdAt ?? nowIso()
  const updatedAt = input.updatedAt ?? createdAt

  db.prepare(
    `
      INSERT INTO session_records (
        id, project_id, directory, title, parent_id, dependence_level, created_at, updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        directory = excluded.directory,
        title = excluded.title,
        parent_id = excluded.parent_id,
        dependence_level = excluded.dependence_level,
        updated_at = excluded.updated_at,
        archived_at = excluded.archived_at
    `,
  ).run(
    input.id,
    input.projectId,
    input.directory,
    input.title,
    input.parentId ?? null,
    input.dependenceLevel,
    createdAt,
    updatedAt,
    input.archivedAt ?? null,
  )

  const row = db
    .prepare("SELECT * FROM session_records WHERE id = ?")
    .get(input.id) as SessionRecordRow | undefined

  if (!row) {
    throw new Error(`Failed to upsert session record '${input.id}'`)
  }

  return mapRow(row)
}

export async function getSessionRecord(id: string): Promise<SessionRecord | undefined> {
  const db = await getDb()
  const row = db.prepare("SELECT * FROM session_records WHERE id = ?").get(id) as SessionRecordRow | undefined
  return row ? mapRow(row) : undefined
}

export async function listSessionRecords(input?: SessionRecordListInput): Promise<SessionRecord[]> {
  const db = await getDb()

  const clauses: string[] = []
  const args: Array<string | number> = []

  if (input?.projectId) {
    clauses.push("project_id = ?")
    args.push(input.projectId)
  }

  if (input?.directory) {
    clauses.push("directory = ?")
    args.push(input.directory)
  }

  if (!input?.includeArchived) {
    clauses.push("archived_at IS NULL")
  }

  let query = "SELECT * FROM session_records"
  if (clauses.length > 0) {
    query += ` WHERE ${clauses.join(" AND ")}`
  }
  query += " ORDER BY updated_at DESC"

  if (typeof input?.limit === "number" && Number.isFinite(input.limit) && input.limit > 0) {
    query += " LIMIT ?"
    args.push(Math.floor(input.limit))
  }

  const rows = db.prepare(query).all(...args) as SessionRecordRow[]
  return rows.map(mapRow)
}

export async function findLatestSessionRecord(input?: {
  projectId?: string
  directory?: string
}): Promise<SessionRecord | undefined> {
  const list = await listSessionRecords({
    projectId: input?.projectId,
    directory: input?.directory,
    includeArchived: false,
    limit: 1,
  })
  return list[0]
}

export async function touchSessionRecord(id: string, patch?: SessionRecordPatch): Promise<SessionRecord | undefined> {
  const db = await getDb()
  const current = await getSessionRecord(id)
  if (!current) return undefined

  const next: SessionRecordUpsertInput = {
    id: current.id,
    projectId: patch?.projectId ?? current.projectId,
    directory: current.directory,
    title: patch?.title ?? current.title,
    parentId: current.parentId,
    dependenceLevel: patch?.dependenceLevel ?? current.dependenceLevel,
    createdAt: current.createdAt,
    updatedAt: patch?.updatedAt ?? nowIso(),
    archivedAt: patch?.archivedAt ?? current.archivedAt,
  }

  return upsertSessionRecord(next)
}

export async function removeSessionRecord(id: string): Promise<void> {
  const db = await getDb()
  db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(id)
  db.prepare("DELETE FROM session_records WHERE id = ?").run(id)
}
