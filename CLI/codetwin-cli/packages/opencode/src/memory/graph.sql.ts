import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import { SessionTable, MessageTable, PartTable } from "../session/session.sql"
import type { ProjectID } from "../project/schema"
import type { SessionID, MessageID, PartID } from "../session/schema"
import { Timestamps } from "../storage/schema.sql"

export type MemoryNodeType = "decision" | "constraint" | "failure" | "task" | "file" | "context"
export type MemoryEdgeType = "dependency" | "causality" | "contradiction" | "refinement"
export type CausalType = "executed" | "failed" | "modified" | "triggered"

export const MemoryNodeTable = sqliteTable(
  "memory_node",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    message_id: text()
      .$type<MessageID>()
      .references(() => MessageTable.id, { onDelete: "set null" }),
    part_id: text()
      .$type<PartID>()
      .references(() => PartTable.id, { onDelete: "set null" }),
    entity_type: text().$type<MemoryNodeType>().notNull(),
    label: text().notNull(),
    content: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    reasoning: text(),
    time_invalidated: integer(),
    ...Timestamps,
  },
  (table) => [
    index("memory_node_project_idx").on(table.project_id),
    index("memory_node_session_idx").on(table.session_id),
    index("memory_node_entity_type_idx").on(table.entity_type),
    index("memory_node_message_idx").on(table.message_id),
  ],
)

export const MemoryEdgeTable = sqliteTable(
  "memory_edge",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    source_node_id: text()
      .notNull()
      .references(() => MemoryNodeTable.id, { onDelete: "cascade" }),
    target_node_id: text()
      .notNull()
      .references(() => MemoryNodeTable.id, { onDelete: "cascade" }),
    edge_type: text().$type<MemoryEdgeType>().notNull(),
    strength: integer(),
    reason: text(),
    ...Timestamps,
  },
  (table) => [
    index("memory_edge_project_idx").on(table.project_id),
    index("memory_edge_session_idx").on(table.session_id),
    index("memory_edge_source_node_idx").on(table.source_node_id),
    index("memory_edge_target_node_idx").on(table.target_node_id),
    index("memory_edge_edge_type_idx").on(table.edge_type),
  ],
)

export const CausalEdgeTable = sqliteTable(
  "causal_edge",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    source_message_id: text()
      .$type<MessageID>()
      .references(() => MessageTable.id, { onDelete: "set null" }),
    source_part_id: text()
      .$type<PartID>()
      .references(() => PartTable.id, { onDelete: "set null" }),
    target_node_id: text()
      .notNull()
      .references(() => MemoryNodeTable.id, { onDelete: "cascade" }),
    causal_type: text().$type<CausalType>().notNull(),
    impact: text({ mode: "json" }).$type<Record<string, unknown>>(),
    reversal_possible: integer({ mode: "boolean" }).notNull().$default(() => false),
    ...Timestamps,
  },
  (table) => [
    index("causal_edge_project_idx").on(table.project_id),
    index("causal_edge_session_idx").on(table.session_id),
    index("causal_edge_message_idx").on(table.source_message_id),
    index("causal_edge_target_node_idx").on(table.target_node_id),
    index("causal_edge_causal_type_idx").on(table.causal_type),
  ],
)

export const SessionMemoryMetaTable = sqliteTable("session_memory_meta", {
  session_id: text()
    .$type<SessionID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  memory_node_count: integer().notNull().$default(() => 0),
  decision_count: integer().notNull().$default(() => 0),
  failure_count: integer().notNull().$default(() => 0),
  default_dependence_level: integer().notNull().$default(() => 3),
  requires_approval_after_failure_count: integer().notNull().$default(() => 2),
  last_memory_update: integer(),
  ...Timestamps,
})

export const ProjectMemoryMetaTable = sqliteTable("project_memory_meta", {
  project_id: text()
    .$type<ProjectID>()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  default_dependence_level: integer().notNull().$default(() => 3),
  failure_threshold: integer().notNull().$default(() => 3),
  ...Timestamps,
})
