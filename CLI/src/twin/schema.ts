import type Database from "better-sqlite3"
import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const projectsTable = sqliteTable("projects", {
  projectId: text("project_id").primaryKey(),
  name: text("name").notNull(),
  rootDir: text("root_dir").notNull(),
  stackJson: text("stack_json").notNull(),
  createdAt: text("created_at").notNull(),
})

export const decisionsTable = sqliteTable("decisions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  projectId: text("project_id").notNull(),
  timestamp: text("timestamp").notNull(),
  description: text("description").notNull(),
  choice: text("choice").notNull(),
  rejectedAlternativesJson: text("rejected_alternatives_json").notNull(),
  reasoning: text("reasoning").notNull(),
  causedBy: text("caused_by"),
  causesJson: text("causes_json"),
})

export const constraintsTable = sqliteTable("constraints", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull(),
})

export const causalEdgesTable = sqliteTable(
  "causal_edges",
  {
    fromDecisionId: text("from_decision_id").notNull(),
    toDecisionId: text("to_decision_id").notNull(),
    projectId: text("project_id").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.fromDecisionId, table.toDecisionId, table.projectId],
    }),
  }),
)

export const failurePatternsTable = sqliteTable("failure_patterns", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  timestamp: text("timestamp").notNull(),
  context: text("context").notNull(),
  errorMessage: text("error_message").notNull(),
  toolName: text("tool_name").notNull(),
})

export function applyTwinMigrations(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_dir TEXT NOT NULL,
      stack_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      description TEXT NOT NULL,
      choice TEXT NOT NULL,
      rejected_alternatives_json TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      caused_by TEXT,
      causes_json TEXT
    );

    CREATE TABLE IF NOT EXISTS constraints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS causal_edges (
      from_decision_id TEXT NOT NULL,
      to_decision_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      PRIMARY KEY (from_decision_id, to_decision_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS failure_patterns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      context TEXT NOT NULL,
      error_message TEXT NOT NULL,
      tool_name TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_decisions_project_time ON decisions (project_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_constraints_project ON constraints (project_id);
    CREATE INDEX IF NOT EXISTS idx_causal_edges_project_from ON causal_edges (project_id, from_decision_id);
    CREATE INDEX IF NOT EXISTS idx_causal_edges_project_to ON causal_edges (project_id, to_decision_id);
    CREATE INDEX IF NOT EXISTS idx_failures_project_time ON failure_patterns (project_id, timestamp DESC);
  `)
}
