// @ts-ignore better-sqlite3 typings use `export =`; runtime uses ESM-compatible default import here.
import Database from "better-sqlite3"
import { and, desc, eq, like, or } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { TWIN_DB_FILE } from "../shared/constants"
import type { Constraint, Decision, TwinProfile } from "../shared/types"
import {
  applyTwinMigrations,
  causalEdgesTable,
  constraintsTable,
  decisionsTable,
  failurePatternsTable,
  projectsTable,
} from "./schema"

type TwinDb = ReturnType<typeof drizzle>

let sqlite: Database.Database | null = null
let db: TwinDb | null = null

function parseStringArray(input: string | null | undefined): string[] {
  if (!input) return []
  try {
    const parsed = JSON.parse(input) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === "string")
  } catch {
    return []
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function truncateByApproxTokens(input: string, maxTokens: number): string {
  const words = input.split(/\s+/).filter((word) => word.length > 0)
  if (words.length <= maxTokens) return input
  return `${words.slice(0, maxTokens).join(" ")} ...`
}

async function getDb(): Promise<TwinDb> {
  if (db) return db

  const dbPath = path.resolve(process.cwd(), TWIN_DB_FILE)
  const dbDir = path.dirname(dbPath)
  await mkdir(dbDir, { recursive: true })

  sqlite = new Database(dbPath)
  applyTwinMigrations(sqlite)
  db = drizzle({ client: sqlite })
  return db
}

function mapConstraintRow(row: typeof constraintsTable.$inferSelect): Constraint {
  return {
    id: row.id,
    projectId: row.projectId,
    description: row.description,
    category: row.category as Constraint["category"],
    expiresAt: row.expiresAt ?? undefined,
    createdAt: row.createdAt,
  }
}

function mapDecisionRow(row: typeof decisionsTable.$inferSelect): Decision {
  return {
    id: row.id,
    sessionId: row.sessionId,
    projectId: row.projectId,
    timestamp: row.timestamp,
    description: row.description,
    choice: row.choice,
    rejectedAlternatives: parseStringArray(row.rejectedAlternativesJson),
    reasoning: row.reasoning,
    causedBy: row.causedBy ?? undefined,
    causes: parseStringArray(row.causesJson),
  }
}

function isActiveConstraint(constraint: Constraint, now: number): boolean {
  if (!constraint.expiresAt) return true
  const expires = Date.parse(constraint.expiresAt)
  if (Number.isNaN(expires)) return true
  return expires > now
}

function maybeViolationReason(constraint: Constraint, actionLower: string): string | undefined {
  const full = constraint.description.toLowerCase()
  if (full.length > 0 && actionLower.includes(full)) {
    return `Action matches constraint description: '${constraint.description}'`
  }

  const noRule = full.match(/\bno\s+([a-z0-9._-]+)/i)
  const blockedToken = noRule?.[1]
  if (blockedToken && actionLower.includes(blockedToken)) {
    return `Action references blocked token '${blockedToken}' from constraint '${constraint.description}'`
  }

  const notRule = full.match(/\bnot\s+([a-z0-9._-]+)/i)
  const forbiddenToken = notRule?.[1]
  if (forbiddenToken && actionLower.includes(forbiddenToken)) {
    return `Action references forbidden token '${forbiddenToken}' from constraint '${constraint.description}'`
  }

  return undefined
}

type CausalRelation = "seed" | "ancestor" | "descendant" | "mixed"

interface RankedCausalDecision {
  decision: Decision
  score: number
  similarity: number
  distance: number
  relation: CausalRelation
}

const RANKING_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "then",
  "when",
  "where",
  "what",
  "why",
  "how",
  "are",
  "was",
  "were",
  "will",
  "would",
  "should",
  "could",
  "can",
  "about",
  "after",
  "before",
  "through",
  "using",
  "use",
  "fix",
  "add",
  "update",
  "create",
  "implement",
  "agent",
  "task",
])

function tokenizeForRanking(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9._-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !RANKING_STOPWORDS.has(token))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function mergeRelation(current: CausalRelation, next: CausalRelation): CausalRelation {
  if (current === next) return current
  if (current === "seed" || next === "seed") return "seed"
  return "mixed"
}

function decisionSearchText(decision: Decision): string {
  return [
    decision.description,
    decision.choice,
    decision.reasoning,
    decision.rejectedAlternatives.join(" "),
  ].join(" ")
}

function computeDecisionSimilarity(decision: Decision, taskTokens: string[]): number {
  if (taskTokens.length === 0) return 0

  const tokens = new Set(tokenizeForRanking(decisionSearchText(decision)))
  if (tokens.size === 0) return 0

  let matches = 0
  for (const token of taskTokens) {
    if (tokens.has(token)) matches += 1
  }

  return matches / taskTokens.length
}

function buildAdjacency(edges: Array<typeof causalEdgesTable.$inferSelect>): {
  incoming: Map<string, string[]>
  outgoing: Map<string, string[]>
} {
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()

  for (const edge of edges) {
    const fromList = outgoing.get(edge.fromDecisionId)
    if (fromList) {
      fromList.push(edge.toDecisionId)
    } else {
      outgoing.set(edge.fromDecisionId, [edge.toDecisionId])
    }

    const toList = incoming.get(edge.toDecisionId)
    if (toList) {
      toList.push(edge.fromDecisionId)
    } else {
      incoming.set(edge.toDecisionId, [edge.fromDecisionId])
    }
  }

  return { incoming, outgoing }
}

function updateNodeMeta(
  nodeMeta: Map<string, { distance: number; relation: CausalRelation }>,
  id: string,
  distance: number,
  relation: CausalRelation,
): void {
  const existing = nodeMeta.get(id)
  if (!existing) {
    nodeMeta.set(id, { distance, relation })
    return
  }

  if (distance < existing.distance) {
    existing.distance = distance
  }

  existing.relation = mergeRelation(existing.relation, relation)
}

function traverseNearest(
  seedId: string,
  adjacency: Map<string, string[]>,
  relation: CausalRelation,
  maxDepth: number,
  nodeMeta: Map<string, { distance: number; relation: CausalRelation }>,
): void {
  const queue: Array<{ id: string; depth: number }> = [{ id: seedId, depth: 0 }]
  const visited = new Set<string>([seedId])

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    if (current.depth >= maxDepth) continue

    const neighbors = adjacency.get(current.id) ?? []
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue
      visited.add(neighbor)

      const nextDepth = current.depth + 1
      updateNodeMeta(nodeMeta, neighbor, nextDepth, relation)
      queue.push({ id: neighbor, depth: nextDepth })
    }
  }
}

function toOneLine(input: string, maxChars: number): string {
  const normalized = input.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars).trim()}...`
}

export const twin = {
  async getProfile(projectId: string): Promise<TwinProfile> {
    const database = await getDb()

    const project = database.select().from(projectsTable).where(eq(projectsTable.projectId, projectId)).get()
    const decisions = database
      .select()
      .from(decisionsTable)
      .where(eq(decisionsTable.projectId, projectId))
      .orderBy(desc(decisionsTable.timestamp))
      .all()
      .map(mapDecisionRow)

    const constraints = await this.getConstraints(projectId)

    const failurePatterns = database
      .select()
      .from(failurePatternsTable)
      .where(eq(failurePatternsTable.projectId, projectId))
      .orderBy(desc(failurePatternsTable.timestamp))
      .all()
      .map((row) => ({
        id: row.id,
        projectId: row.projectId,
        timestamp: row.timestamp,
        context: row.context,
        errorMessage: row.errorMessage,
        toolName: row.toolName,
      }))

    return {
      projectId,
      stack: parseStringArray(project?.stackJson),
      decisions,
      constraints,
      failurePatterns,
    }
  },

  async recordDecision(decision: Omit<Decision, "id">): Promise<Decision> {
    const database = await getDb()
    const id = crypto.randomUUID()

    database.insert(decisionsTable).values({
      id,
      sessionId: decision.sessionId,
      projectId: decision.projectId,
      timestamp: decision.timestamp,
      description: decision.description,
      choice: decision.choice,
      rejectedAlternativesJson: JSON.stringify(decision.rejectedAlternatives),
      reasoning: decision.reasoning,
      causedBy: decision.causedBy ?? null,
      causesJson: decision.causes ? JSON.stringify(decision.causes) : null,
    }).run()

    if (decision.causedBy) {
      database.insert(causalEdgesTable).values({
        fromDecisionId: decision.causedBy,
        toDecisionId: id,
        projectId: decision.projectId,
      }).onConflictDoNothing().run()
    }

    if (decision.causes && decision.causes.length > 0) {
      for (const toDecisionId of decision.causes) {
        database.insert(causalEdgesTable).values({
          fromDecisionId: id,
          toDecisionId,
          projectId: decision.projectId,
        }).onConflictDoNothing().run()
      }
    }

    return {
      ...decision,
      id,
    }
  },

  async addConstraint(constraint: Omit<Constraint, "id">): Promise<Constraint> {
    const database = await getDb()
    const id = crypto.randomUUID()

    database.insert(constraintsTable).values({
      id,
      projectId: constraint.projectId,
      description: constraint.description,
      category: constraint.category,
      expiresAt: constraint.expiresAt ?? null,
      createdAt: constraint.createdAt,
    }).run()

    return {
      ...constraint,
      id,
    }
  },

  async getConstraints(projectId: string): Promise<Constraint[]> {
    const database = await getDb()
    const rows = database.select().from(constraintsTable).where(eq(constraintsTable.projectId, projectId)).all()
    const now = Date.now()

    return rows
      .map(mapConstraintRow)
      .filter((constraint) => isActiveConstraint(constraint, now))
  },

  async removeConstraint(id: string): Promise<void> {
    const database = await getDb()
    database.delete(constraintsTable).where(eq(constraintsTable.id, id)).run()
  },

  async checkConstraintViolation(
    projectId: string,
    proposedAction: string,
  ): Promise<{ violated: boolean; constraint?: Constraint; reasoning?: string }> {
    const constraints = await this.getConstraints(projectId)
    const actionLower = proposedAction.toLowerCase()

    for (const constraint of constraints) {
      const reason = maybeViolationReason(constraint, actionLower)
      if (reason) {
        return {
          violated: true,
          constraint,
          reasoning: reason,
        }
      }
    }

    return { violated: false }
  },

  async buildContextSummary(projectId: string): Promise<string> {
    const database = await getDb()
    const now = Date.now()

    const project = database.select().from(projectsTable).where(eq(projectsTable.projectId, projectId)).get()

    const decisions = database
      .select()
      .from(decisionsTable)
      .where(eq(decisionsTable.projectId, projectId))
      .orderBy(desc(decisionsTable.timestamp))
      .limit(10)
      .all()

    const constraints = database
      .select()
      .from(constraintsTable)
      .where(eq(constraintsTable.projectId, projectId))
      .all()
      .map(mapConstraintRow)
      .filter((constraint) => isActiveConstraint(constraint, now))

    const failures = database
      .select()
      .from(failurePatternsTable)
      .where(eq(failurePatternsTable.projectId, projectId))
      .orderBy(desc(failurePatternsTable.timestamp))
      .limit(2)
      .all()

    const stackText = parseStringArray(project?.stackJson).join(", ") || "Unknown"

    const decisionText =
      decisions.length === 0
        ? "None"
        : decisions
            .map((item) => {
              const date = item.timestamp.split("T")[0] ?? item.timestamp
              return `[${date}] chose ${item.choice} (${item.reasoning})`
            })
            .join("; ")

    const constraintText =
      constraints.length === 0 ? "None" : constraints.map((item) => item.description).join("; ")

    const failureText =
      failures.length === 0
        ? "None"
        : failures.map((item) => `${item.errorMessage} on ${item.toolName}`).join("; ")

    const summary = [
      `Stack: ${stackText}`,
      `Past decisions (last 10): ${decisionText}`,
      `Active constraints (${constraints.length}): ${constraintText}`,
      `Recent failures (${failures.length}): ${failureText}`,
    ].join("\n")

    return truncateByApproxTokens(summary, 500)
  },

  async buildRelevantCausalContext(
    projectId: string,
    task: string,
    options?: {
      maxSeeds?: number
      maxDepth?: number
      maxNodes?: number
      maxEdges?: number
    },
  ): Promise<string> {
    const database = await getDb()

    const decisionRows = database
      .select()
      .from(decisionsTable)
      .where(eq(decisionsTable.projectId, projectId))
      .orderBy(desc(decisionsTable.timestamp))
      .limit(250)
      .all()

    if (decisionRows.length === 0) {
      return "Relevant causal graph nodes: None"
    }

    const decisions = decisionRows.map(mapDecisionRow)
    const decisionById = new Map(decisions.map((decision) => [decision.id, decision]))

    const edgeRows = database
      .select()
      .from(causalEdgesTable)
      .where(eq(causalEdgesTable.projectId, projectId))
      .all()
      .filter((edge) => decisionById.has(edge.fromDecisionId) && decisionById.has(edge.toDecisionId))

    const { incoming, outgoing } = buildAdjacency(edgeRows)
    const taskTokens = tokenizeForRanking(task)
    const similarityById = new Map<string, number>()

    for (const decision of decisions) {
      similarityById.set(decision.id, computeDecisionSimilarity(decision, taskTokens))
    }

    const sortedBySimilarity = [...decisions].sort((left, right) => {
      const leftScore = similarityById.get(left.id) ?? 0
      const rightScore = similarityById.get(right.id) ?? 0
      if (rightScore !== leftScore) return rightScore - leftScore
      return right.timestamp.localeCompare(left.timestamp)
    })

    const maxSeeds = options?.maxSeeds ?? 4
    const seedCandidates = sortedBySimilarity.filter((decision) => (similarityById.get(decision.id) ?? 0) > 0)
    const seeds = (seedCandidates.length > 0 ? seedCandidates : decisions.slice(0, 2)).slice(0, maxSeeds)

    const maxDepth = options?.maxDepth ?? 2
    const nodeMeta = new Map<string, { distance: number; relation: CausalRelation }>()

    for (const seed of seeds) {
      updateNodeMeta(nodeMeta, seed.id, 0, "seed")
      traverseNearest(seed.id, incoming, "ancestor", maxDepth, nodeMeta)
      traverseNearest(seed.id, outgoing, "descendant", maxDepth, nodeMeta)
    }

    const ranked: RankedCausalDecision[] = []
    for (const [id, meta] of nodeMeta.entries()) {
      const decision = decisionById.get(id)
      if (!decision) continue

      const similarity = similarityById.get(id) ?? 0
      const ts = Date.parse(decision.timestamp)
      const ageDays = Number.isNaN(ts) ? 365 : (Date.now() - ts) / (1000 * 60 * 60 * 24)
      const recencyBoost = clamp(1 - ageDays / 180, 0, 1)
      const distanceBoost = meta.distance === 0 ? 1.6 : meta.distance === 1 ? 1.0 : 0.6
      const relationBoost =
        meta.relation === "seed" ? 0.6 : meta.relation === "mixed" ? 0.45 : 0.3

      ranked.push({
        decision,
        similarity,
        distance: meta.distance,
        relation: meta.relation,
        score: similarity * 4 + recencyBoost * 0.4 + distanceBoost + relationBoost,
      })
    }

    const maxNodes = options?.maxNodes ?? 8
    const topNodes = ranked
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        return right.decision.timestamp.localeCompare(left.decision.timestamp)
      })
      .slice(0, maxNodes)

    const selectedIds = new Set(topNodes.map((item) => item.decision.id))
    const maxEdges = options?.maxEdges ?? 12
    const selectedEdges = edgeRows
      .filter((edge) => selectedIds.has(edge.fromDecisionId) && selectedIds.has(edge.toDecisionId))
      .slice(0, maxEdges)

    const lines: string[] = []
    lines.push(`Relevant causal graph nodes (${topNodes.length}):`)
    for (const item of topNodes) {
      const date = item.decision.timestamp.split("T")[0] ?? item.decision.timestamp
      const id = item.decision.id.slice(0, 8)
      const description = toOneLine(item.decision.description, 90)
      const reasoning = toOneLine(item.decision.reasoning, 120)
      lines.push(
        `- [${id}] ${date} (${item.relation}, depth=${item.distance}, score=${item.similarity.toFixed(2)}): ${item.decision.choice} -> ${description} | why: ${reasoning}`,
      )
    }

    if (selectedEdges.length > 0) {
      lines.push("Relevant causal links:")
      for (const edge of selectedEdges) {
        lines.push(`- ${edge.fromDecisionId.slice(0, 8)} -> ${edge.toDecisionId.slice(0, 8)}`)
      }
    }

    return truncateByApproxTokens(lines.join("\n"), 260)
  },

  async logFailurePattern(projectId: string, context: string, errorMessage: string, toolName: string): Promise<void> {
    const database = await getDb()

    database.insert(failurePatternsTable).values({
      id: crypto.randomUUID(),
      projectId,
      timestamp: nowIso(),
      context,
      errorMessage,
      toolName,
    }).run()
  },

  async upsertProject(input: {
    projectId: string
    name: string
    rootDir: string
    stack: string[]
    createdAt?: string
  }): Promise<void> {
    const database = await getDb()

    database
      .insert(projectsTable)
      .values({
        projectId: input.projectId,
        name: input.name,
        rootDir: input.rootDir,
        stackJson: JSON.stringify(input.stack),
        createdAt: input.createdAt ?? nowIso(),
      })
      .onConflictDoUpdate({
        target: projectsTable.projectId,
        set: {
          name: input.name,
          rootDir: input.rootDir,
          stackJson: JSON.stringify(input.stack),
        },
      })
      .run()
  },

  async searchDecisions(projectId: string, query: string): Promise<Decision[]> {
    const database = await getDb()
    const queryLike = `%${query}%`

    const rows = database
      .select()
      .from(decisionsTable)
      .where(
        and(
          eq(decisionsTable.projectId, projectId),
          or(
            // Using raw SQL LIKE here keeps behavior consistent across sqlite adapters.
            // drizzle currently does not expose a typed helper for case-insensitive LIKE on all dialects.
            like(decisionsTable.description, queryLike),
            like(decisionsTable.choice, queryLike),
            like(decisionsTable.reasoning, queryLike),
          ),
        ),
      )
      .orderBy(desc(decisionsTable.timestamp))
      .all()

    return rows.map(mapDecisionRow)
  },
}
