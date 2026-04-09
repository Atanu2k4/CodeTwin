import { createHash, randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { z } from "zod"
import {
  ConfigInvalidError,
  ConfigNotFoundError,
  loadConfig,
  saveConfig,
} from "../config"
import { ProjectConfigSchema } from "../config/schema"
import { runAgentLoop } from "./agent-loop"
import { PreflightManager, type PreflightDecision, decisionToApproval } from "./preflight"
import type {
  AgentLogPayload,
  AgentMessage,
  AwaitingApprovalPayload,
  Decision,
  DependenceLevel,
  LevelChangePayload,
  MessageType,
  PreflightMap,
  PreflightMapPayload,
  SessionStatusPayload,
  TaskCompletePayload,
  TaskFailedPayload,
} from "../shared/types"
import {
  DependenceLevelSchema,
  LevelChangeSchema,
  TaskSubmitSchema,
  UserAnswerSchema,
} from "../shared/messages"
import {
  DECISION_PENDING_TIMEOUT_MS,
  DECISION_RESOLVED_TTL_MS,
  TASK_MAX_RUNTIME_MS,
} from "../shared/constants"
import { twin } from "../twin"

const SessionNewSchema = z
  .object({
    projectId: z.string().optional(),
    dependenceLevel: DependenceLevelSchema.optional(),
  })
  .optional()

const ConstraintCreateSchema = z.object({
  description: z.string().min(1),
  category: z.enum(["library", "api", "pattern", "technology", "client-requirement"]),
  expiresAt: z.string().optional(),
})

const DecisionCreateSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  timestamp: z.string(),
  description: z.string(),
  choice: z.string(),
  rejectedAlternatives: z.array(z.string()),
  reasoning: z.string(),
  causedBy: z.string().optional(),
  causes: z.array(z.string()).optional(),
})

const ConfigInitSchema = ProjectConfigSchema

const ConfigUpdateSchema = z.object({
  dependenceLevel: DependenceLevelSchema.optional(),
  llmProvider: ProjectConfigSchema.shape.llmProvider.optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  stack: z.array(z.string()).optional(),
  connectors: z.array(ProjectConfigSchema.shape.connectors.element).optional(),
  name: z.string().optional(),
  rootDir: z.string().optional(),
  projectId: z.string().optional(),
})

interface SessionRuntime {
  id: string
  projectId: string
  status: SessionStatusPayload["status"]
  dependenceLevel: DependenceLevel
  currentTask?: string
  remoteConnected: boolean
  createdAt: string
}

type SessionSubscriber = (message: AgentMessage) => Promise<void>
type BridgeSender = (message: AgentMessage) => void

interface PendingDecision {
  id: string
  sessionId: string
  projectId: string
  createdAt: string
  defaultAnswer: string
  timeout: NodeJS.Timeout
  resolved: boolean
  resolve: (answer: string) => void
}

interface ActiveTaskRuntime {
  controller: AbortController
  timeout: NodeJS.Timeout
  startedAt: string
}

const sessions = new Map<string, SessionRuntime>()
const sessionSubscribers = new Map<string, Set<SessionSubscriber>>()
const preflightManager = new PreflightManager()
const pendingDecisions = new Map<string, PendingDecision>()
const preflightOwners = new Map<string, { sessionId: string; projectId: string }>()
const resolvedDecisionOwners = new Map<string, { sessionId: string; projectId: string; resolvedAt: number }>()
const activeTasks = new Map<string, ActiveTaskRuntime>()
const lastSessionStatusFingerprint = new Map<string, string>()

let daemonDeviceId = "daemon-local"
let bridgeSender: BridgeSender | null = null

function nowIso(): string {
  return new Date().toISOString()
}

function makeDeviceId(projectId: string): string {
  const source = `${os.hostname()}:${projectId}:${process.cwd()}`
  return createHash("sha256").update(source).digest("hex").slice(0, 12)
}

function withErrorField(issuePath: readonly PropertyKey[]): { field?: string } {
  if (issuePath.length === 0) return {}

  const normalized = issuePath
    .map((segment) => {
      if (typeof segment === "string" || typeof segment === "number") return String(segment)
      return undefined
    })
    .filter((segment): segment is string => Boolean(segment))

  if (normalized.length === 0) return {}
  return { field: normalized.join(".") }
}

function parseBody<T>(json: unknown, schema: z.ZodSchema<T>):
  | { ok: true; data: T }
  | { ok: false; error: { error: string; field?: string } } {
  const parsed = schema.safeParse(json)
  if (parsed.success) {
    return { ok: true, data: parsed.data }
  }

  const first = parsed.error.issues[0]
  return {
    ok: false,
    error: {
      error: first?.message ?? "Invalid request body",
      ...withErrorField(first?.path ?? []),
    },
  }
}

function maskConfigSecrets(config: unknown): unknown {
  if (Array.isArray(config)) return config.map(maskConfigSecrets)
  if (config && typeof config === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(config)) {
      if (key.toLowerCase().includes("apikey")) {
        result[key] = "****"
      } else {
        result[key] = maskConfigSecrets(value)
      }
    }
    return result
  }
  return config
}

function createMessage(input: {
  type: MessageType
  sessionId: string
  projectId: string
  payload: unknown
}): AgentMessage {
  return {
    type: input.type,
    sessionId: input.sessionId,
    projectId: input.projectId,
    deviceId: daemonDeviceId,
    timestamp: nowIso(),
    payload: input.payload,
  }
}

async function broadcastSessionMessage(
  message: AgentMessage,
  options?: { skipBridge?: boolean },
): Promise<void> {
  if (!options?.skipBridge && bridgeSender) {
    try {
      bridgeSender(message)
    } catch {
      // Bridge forwarding is best-effort.
    }
  }

  const subscribers = sessionSubscribers.get(message.sessionId)
  if (!subscribers || subscribers.size === 0) return

  const staleSubscribers: SessionSubscriber[] = []

  await Promise.all(
    Array.from(subscribers).map(async (send) => {
      try {
        await send(message)
      } catch {
        staleSubscribers.push(send)
      }
    }),
  )

  if (staleSubscribers.length === 0) return

  for (const stale of staleSubscribers) {
    subscribers.delete(stale)
  }

  if (subscribers.size === 0) {
    sessionSubscribers.delete(message.sessionId)
  }
}

function buildSessionStatusPayload(session: SessionRuntime): SessionStatusPayload {
  return {
    status: session.status,
    currentTask: session.currentTask,
    dependenceLevel: session.dependenceLevel,
    remoteConnected: session.remoteConnected,
  }
}

async function emitAgentLog(input: {
  sessionId: string
  projectId: string
  level: AgentLogPayload["level"]
  message: string
  skipBridge?: boolean
}): Promise<void> {
  const payload: AgentLogPayload = {
    level: input.level,
    message: input.message,
  }

  await broadcastSessionMessage(
    createMessage({
      type: "AGENT_LOG",
      sessionId: input.sessionId,
      projectId: input.projectId,
      payload,
    }),
    { skipBridge: input.skipBridge },
  )
}

async function broadcastStatus(session: SessionRuntime): Promise<void> {
  const payload = buildSessionStatusPayload(session)
  const fingerprint = JSON.stringify(payload)
  const previous = lastSessionStatusFingerprint.get(session.id)
  if (previous === fingerprint) {
    return
  }
  lastSessionStatusFingerprint.set(session.id, fingerprint)

  await broadcastSessionMessage(
    createMessage({
      type: "SESSION_STATUS",
      sessionId: session.id,
      projectId: session.projectId,
      payload,
    }),
  )
}

function updateSessionStatus(
  session: SessionRuntime,
  next: Partial<Pick<SessionRuntime, "status" | "currentTask" | "dependenceLevel" | "remoteConnected">>,
): SessionRuntime {
  const current = sessions.get(session.id)
  if (!current) {
    return {
      ...session,
      ...next,
    }
  }

  const updated: SessionRuntime = {
    ...current,
    ...next,
  }
  sessions.set(session.id, updated)
  return updated
}

function clearActiveTask(sessionId: string): void {
  const active = activeTasks.get(sessionId)
  if (!active) return
  clearTimeout(active.timeout)
  activeTasks.delete(sessionId)
}

function cancelSessionTask(sessionId: string, reason: string): boolean {
  const active = activeTasks.get(sessionId)
  if (!active) return false

  active.controller.abort(new Error(reason))
  clearTimeout(active.timeout)
  activeTasks.delete(sessionId)
  return true
}

function resolveDefaultDecisionAnswer(options: string[]): string {
  const normalized = options.map((option) => option.toLowerCase())
  const abortIndex = normalized.findIndex((option) => option.includes("abort"))
  if (abortIndex >= 0) {
    return options[abortIndex] ?? "abort task"
  }

  if (options.length > 0) {
    return options[0] ?? "continue"
  }

  return "abort task"
}

function cleanupResolvedDecisionOwners(now = Date.now()): void {
  for (const [id, owner] of resolvedDecisionOwners.entries()) {
    if (now - owner.resolvedAt > DECISION_RESOLVED_TTL_MS) {
      resolvedDecisionOwners.delete(id)
    }
  }
}

function markResolvedDecisionOwner(awaitingResponseId: string, sessionId: string, projectId: string): void {
  resolvedDecisionOwners.set(awaitingResponseId, {
    sessionId,
    projectId,
    resolvedAt: Date.now(),
  })
  cleanupResolvedDecisionOwners()
}

function createPendingDecision(input: {
  sessionId: string
  projectId: string
  question: string
  options: string[]
}): { awaitingResponseId: string; waitForAnswer: Promise<string> } {
  cleanupResolvedDecisionOwners()

  const awaitingResponseId = randomUUID()
  const defaultAnswer = resolveDefaultDecisionAnswer(input.options)
  const createdAt = nowIso()

  const waitForAnswer = new Promise<string>((resolve) => {
    const timeout = setTimeout(() => {
      const pending = pendingDecisions.get(awaitingResponseId)
      if (!pending || pending.resolved) return

      pending.resolved = true
      pending.resolve(pending.defaultAnswer)
      pendingDecisions.delete(awaitingResponseId)
      markResolvedDecisionOwner(awaitingResponseId, pending.sessionId, pending.projectId)

      void emitAgentLog({
        sessionId: pending.sessionId,
        projectId: pending.projectId,
        level: "warn",
        message: `Decision prompt '${awaitingResponseId}' timed out after ${DECISION_PENDING_TIMEOUT_MS}ms; defaulted to '${pending.defaultAnswer}'.`,
      })
    }, DECISION_PENDING_TIMEOUT_MS)

    pendingDecisions.set(awaitingResponseId, {
      id: awaitingResponseId,
      sessionId: input.sessionId,
      projectId: input.projectId,
      createdAt,
      defaultAnswer,
      timeout,
      resolved: false,
      resolve,
    })
  })

  const payload: AwaitingApprovalPayload = {
    question: input.question,
    options: input.options,
    awaitingResponseId,
    timeoutMs: DECISION_PENDING_TIMEOUT_MS,
  }

  void broadcastSessionMessage(
    createMessage({
      type: "AWAITING_APPROVAL",
      sessionId: input.sessionId,
      projectId: input.projectId,
      payload,
    }),
  )

  return { awaitingResponseId, waitForAnswer }
}

async function startTask(input: {
  session: SessionRuntime
  task: string
  dependenceLevel?: DependenceLevel
}): Promise<void> {
  clearActiveTask(input.session.id)

  const session = updateSessionStatus(input.session, {
    status: "running",
    currentTask: input.task,
    dependenceLevel: input.dependenceLevel ?? input.session.dependenceLevel,
  })
  await broadcastStatus(session)

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    cancelSessionTask(session.id, `Task timed out after ${TASK_MAX_RUNTIME_MS}ms`)
  }, TASK_MAX_RUNTIME_MS)

  activeTasks.set(session.id, {
    controller,
    timeout,
    startedAt: nowIso(),
  })

  void runAgentLoop({
    sessionId: session.id,
    task: input.task,
    projectId: session.projectId,
    dependenceLevel: session.dependenceLevel,
    getDependenceLevel: () => sessions.get(session.id)?.dependenceLevel ?? session.dependenceLevel,
    abortSignal: controller.signal,
    onLog: (level, msg) => {
      void emitAgentLog({
        sessionId: session.id,
        projectId: session.projectId,
        level,
        message: msg,
      })
    },
    onPreflightRequired: async (map: PreflightMap) => {
      const awaiting = updateSessionStatus(session, {
        status: "awaiting_approval",
      })
      await broadcastStatus(awaiting)

      const preflight = preflightManager.request(map)
      preflightOwners.set(preflight.awaitingResponseId, {
        sessionId: session.id,
        projectId: session.projectId,
      })

      const payload: PreflightMapPayload = {
        map: preflight.payload.map,
        awaitingResponseId: preflight.awaitingResponseId,
      }

      await broadcastSessionMessage(
        createMessage({
          type: "PREFLIGHT_MAP",
          sessionId: session.id,
          projectId: session.projectId,
          payload,
        }),
      )

      const decision = await preflight.waitForDecision
      const resumed = updateSessionStatus(session, {
        status: "running",
      })
      await broadcastStatus(resumed)

      if (decision === "modify") {
        await createPendingDecision({
          sessionId: session.id,
          projectId: session.projectId,
          question: "User wants to modify the approach. What should change?",
          options: [],
        }).waitForAnswer
        return false
      }

      return decisionToApproval(decision)
    },
    onDecisionRequired: async (question, options) => {
      const awaiting = updateSessionStatus(session, {
        status: "awaiting_approval",
      })
      await broadcastStatus(awaiting)

      const pending = createPendingDecision({
        sessionId: session.id,
        projectId: session.projectId,
        question,
        options,
      })
      const answer = await pending.waitForAnswer

      const resumed = updateSessionStatus(session, {
        status: "running",
      })
      await broadcastStatus(resumed)

      return answer
    },
    onDecisionQueued: (queued) => {
      void broadcastSessionMessage(
        createMessage({
          type: "DECISION_QUEUED",
          sessionId: session.id,
          projectId: session.projectId,
          payload: queued,
        }),
      )
    },
    onComplete: (summary: TaskCompletePayload) => {
      clearActiveTask(session.id)
      if (!sessions.has(session.id)) return

      const updated = updateSessionStatus(session, {
        status: "idle",
        currentTask: undefined,
      })
      void broadcastSessionMessage(
        createMessage({
          type: "TASK_COMPLETE",
          sessionId: session.id,
          projectId: session.projectId,
          payload: summary,
        }),
      )
      void broadcastStatus(updated)
    },
    onFailed: (error: TaskFailedPayload) => {
      const aborted = controller.signal.aborted
      const abortReason = controller.signal.reason
      clearActiveTask(session.id)

      if (!sessions.has(session.id)) return

      const cancelMessage =
        abortReason instanceof Error
          ? abortReason.message
          : typeof abortReason === "string"
            ? abortReason
            : "Task cancelled"

      const payload: TaskFailedPayload = aborted
        ? {
            ...error,
            error: cancelMessage,
            partialCompletionSummary: "Task cancelled before completion.",
          }
        : error

      const updated = updateSessionStatus(session, {
        status: aborted ? "paused" : "failed",
        currentTask: undefined,
      })

      if (aborted) {
        void emitAgentLog({
          sessionId: session.id,
          projectId: session.projectId,
          level: "warn",
          message: cancelMessage,
        })
      }

      void broadcastSessionMessage(
        createMessage({
          type: "TASK_FAILED",
          sessionId: session.id,
          projectId: session.projectId,
          payload,
        }),
      )
      void broadcastStatus(updated)
    },
  })
}

export function resolvePreflightResponse(awaitingResponseId: string, decision: PreflightDecision): boolean {
  return preflightManager.resolve(awaitingResponseId, decision, {
    onDuplicate: (id) => {
      const owner = preflightOwners.get(id)
      if (!owner) return
      void emitAgentLog({
        sessionId: owner.sessionId,
        projectId: owner.projectId,
        level: "warn",
        message: `Duplicate preflight response ignored for awaitingResponseId '${id}'.`,
      })
    },
  })
}

export function resolveDecisionResponse(awaitingResponseId: string, answer: string): boolean {
  const pending = pendingDecisions.get(awaitingResponseId)
  if (!pending) {
    const owner = resolvedDecisionOwners.get(awaitingResponseId)
    if (owner) {
      void emitAgentLog({
        sessionId: owner.sessionId,
        projectId: owner.projectId,
        level: "warn",
        message: `Duplicate decision response ignored for awaitingResponseId '${awaitingResponseId}'.`,
      })
    }
    return false
  }

  if (pending.resolved) {
    void emitAgentLog({
      sessionId: pending.sessionId,
      projectId: pending.projectId,
      level: "warn",
      message: `Duplicate decision response ignored for awaitingResponseId '${awaitingResponseId}'.`,
    })
    return false
  }

  pending.resolved = true
  clearTimeout(pending.timeout)
  pending.resolve(answer)
  pendingDecisions.delete(awaitingResponseId)
  markResolvedDecisionOwner(awaitingResponseId, pending.sessionId, pending.projectId)
  return true
}

export function setBridgeSender(next: BridgeSender | null): void {
  bridgeSender = next
}

export function setRemoteConnected(sessionId: string, connected: boolean): void {
  const session = sessions.get(sessionId)
  if (!session) return
  const updated = updateSessionStatus(session, { remoteConnected: connected })
  void broadcastStatus(updated)
}

export function setAllSessionsRemoteConnected(connected: boolean): void {
  for (const session of sessions.values()) {
    setRemoteConnected(session.id, connected)
  }
}

export function listSessions(): SessionRuntime[] {
  return Array.from(sessions.values())
}

function cleanupSessionState(sessionId: string): void {
  clearActiveTask(sessionId)
  lastSessionStatusFingerprint.delete(sessionId)

  for (const [id, owner] of preflightOwners.entries()) {
    if (owner.sessionId === sessionId) {
      preflightOwners.delete(id)
    }
  }

  for (const [id, pending] of pendingDecisions.entries()) {
    if (pending.sessionId === sessionId) {
      clearTimeout(pending.timeout)
      pendingDecisions.delete(id)
    }
  }

  for (const [id, owner] of resolvedDecisionOwners.entries()) {
    if (owner.sessionId === sessionId) {
      resolvedDecisionOwners.delete(id)
    }
  }
}

function ensureSessionForRemoteMessage(message: AgentMessage): SessionRuntime {
  const existing = sessions.get(message.sessionId)
  if (existing) return existing

  const created: SessionRuntime = {
    id: message.sessionId || randomUUID(),
    projectId: message.projectId || "default-project",
    status: "idle",
    dependenceLevel: 3,
    remoteConnected: true,
    createdAt: nowIso(),
  }
  sessions.set(created.id, created)
  return created
}

export async function handleBridgeMessage(message: AgentMessage): Promise<AgentMessage | null> {
  if (message.type === "PING") {
    return createMessage({
      type: "PONG",
      sessionId: message.sessionId,
      projectId: message.projectId,
      payload: { nonce: (message.payload as { nonce?: string } | undefined)?.nonce },
    })
  }

  if (message.type === "TASK_SUBMIT") {
    const parsed = parseBody(message.payload, TaskSubmitSchema)
    if (!parsed.ok) return null

    const session = ensureSessionForRemoteMessage(message)
    if (session.status === "running" || session.status === "awaiting_approval") {
      void emitAgentLog({
        sessionId: session.id,
        projectId: session.projectId,
        level: "warn",
        message: "Remote TASK_SUBMIT ignored because the session already has an active task.",
      })
      return null
    }

    await startTask({
      session,
      task: parsed.data.task,
      dependenceLevel: parsed.data.dependenceLevel,
    })
    return null
  }

  if (message.type === "TASK_CANCEL") {
    const session = sessions.get(message.sessionId)
    if (!session) return null

    const reason = "Task cancelled by remote client"
    cancelSessionTask(session.id, reason)

    const updated = updateSessionStatus(session, {
      status: "paused",
      currentTask: undefined,
    })
    await emitAgentLog({
      sessionId: session.id,
      projectId: session.projectId,
      level: "warn",
      message: reason,
    })
    await broadcastStatus(updated)
    return null
  }

  if (message.type === "USER_APPROVE" || message.type === "USER_REJECT") {
    const parsed = parseBody(message.payload, z.object({ awaitingResponseId: z.string() }))
    if (!parsed.ok) return null
    const decision: PreflightDecision = message.type === "USER_APPROVE" ? "approve" : "reject"
    resolvePreflightResponse(parsed.data.awaitingResponseId, decision)
    return null
  }

  if (message.type === "USER_ANSWER") {
    const parsed = parseBody(message.payload, UserAnswerSchema)
    if (!parsed.ok) return null
    resolveDecisionResponse(parsed.data.awaitingResponseId, parsed.data.answer)
    return null
  }

  if (message.type === "LEVEL_CHANGE") {
    const parsed = parseBody(message.payload, LevelChangeSchema)
    if (!parsed.ok) return null
    const session = sessions.get(message.sessionId)
    if (!session) return null

    const updated = updateSessionStatus(session, {
      dependenceLevel: parsed.data.newLevel,
    })

    const payload: LevelChangePayload = {
      newLevel: parsed.data.newLevel,
    }

    await broadcastSessionMessage(
      createMessage({
        type: "LEVEL_CHANGE",
        sessionId: updated.id,
        projectId: updated.projectId,
        payload,
      }),
    )
    await broadcastStatus(updated)
  }

  return null
}

export function createDaemonServer(): Hono {
  const app = new Hono()

  app.post("/session/new", async (c) => {
    let body: unknown = undefined
    try {
      body = await c.req.json()
    } catch {
      body = undefined
    }

    const parsed = parseBody(body, SessionNewSchema)
    if (!parsed.ok) return c.json(parsed.error, 400)

    let projectId = parsed.data?.projectId
    let dependenceLevel = parsed.data?.dependenceLevel ?? 3

    if (!projectId) {
      try {
        const config = await loadConfig()
        projectId = config.projectId
        dependenceLevel = config.dependenceLevel
      } catch {
        projectId = "default-project"
      }
    }

    const session: SessionRuntime = {
      id: randomUUID(),
      projectId,
      status: "idle",
      dependenceLevel,
      remoteConnected: false,
      createdAt: nowIso(),
    }
    sessions.set(session.id, session)

    return c.json({
      sessionId: session.id,
      projectId: session.projectId,
      dependenceLevel: session.dependenceLevel,
    })
  })

  app.post("/session/:id/task", async (c) => {
    const session = sessions.get(c.req.param("id"))
    if (!session) return c.json({ error: "Session not found" }, 404)
    if (session.status === "running" || session.status === "awaiting_approval" || activeTasks.has(session.id)) {
      return c.json({ error: "Session already has a running task" }, 409)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    const parsed = parseBody(body, TaskSubmitSchema)
    if (!parsed.ok) return c.json(parsed.error, 400)

    await startTask({
      session,
      task: parsed.data.task,
      dependenceLevel: parsed.data.dependenceLevel,
    })

    return c.json({
      accepted: true,
      sessionId: session.id,
      status: "running",
    })
  })

  app.post("/session/:id/cancel", async (c) => {
    const session = sessions.get(c.req.param("id"))
    if (!session) return c.json({ error: "Session not found" }, 404)

    if (!activeTasks.has(session.id) && session.status !== "running" && session.status !== "awaiting_approval") {
      return c.json({ error: "Session has no running task" }, 409)
    }

    let reason = "Task cancelled by user"
    try {
      const parsed = parseBody(await c.req.json(), z.object({ reason: z.string().min(1).optional() }))
      if (parsed.ok && parsed.data.reason) {
        reason = parsed.data.reason
      }
    } catch {
      // Reason is optional; ignore malformed JSON for cancellation convenience.
    }

    const cancelled = cancelSessionTask(session.id, reason)
    const updated = updateSessionStatus(session, {
      status: "paused",
      currentTask: undefined,
    })

    await emitAgentLog({
      sessionId: session.id,
      projectId: session.projectId,
      level: "warn",
      message: reason,
    })
    await broadcastStatus(updated)

    return c.json({ cancelled, sessionId: session.id, status: updated.status })
  })

  app.get("/session/:id/stream", async (c) => {
    const sessionId = c.req.param("id")
    const session = sessions.get(sessionId)
    if (!session) return c.json({ error: "Session not found" }, 404)

    return streamSSE(c, async (stream) => {
      let closed = false
      const teardown = () => {
        if (closed) return
        closed = true
        const set = sessionSubscribers.get(sessionId)
        set?.delete(send)
      }

      const send: SessionSubscriber = async (message) => {
        if (closed) return
        try {
          await stream.writeSSE({
            event: message.type,
            data: JSON.stringify(message),
          })
        } catch {
          teardown()
          throw new Error("SSE stream write failed")
        }
      }

      const subscribers = sessionSubscribers.get(sessionId) ?? new Set<SessionSubscriber>()
      subscribers.add(send)
      sessionSubscribers.set(sessionId, subscribers)

      await send(
        createMessage({
          type: "SESSION_STATUS",
          sessionId,
          projectId: session.projectId,
          payload: buildSessionStatusPayload(session),
        }),
      )

      const keepAlive = setInterval(() => {
        if (closed) return

        void send(
          createMessage({
            type: "PING",
            sessionId,
            projectId: session.projectId,
            payload: { keepAlive: true },
          }),
        ).catch(() => {
          clearInterval(keepAlive)
        })
      }, 25_000)

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(keepAlive)
          teardown()
          resolve()
        })
      })
    })
  })

  app.get("/session/:id/status", async (c) => {
    const session = sessions.get(c.req.param("id"))
    if (!session) return c.json({ error: "Session not found" }, 404)

    const payload = buildSessionStatusPayload(session)

    return c.json(payload)
  })

  app.delete("/session/:id", async (c) => {
    const sessionId = c.req.param("id")
    const session = sessions.get(sessionId)
    if (!session) return c.json({ error: "Session not found" }, 404)

    cancelSessionTask(sessionId, "Task cancelled because session was deleted")

    sessions.delete(sessionId)
    sessionSubscribers.delete(sessionId)
    cleanupSessionState(sessionId)
    return c.json({ deleted: true, sessionId })
  })

  app.get("/sessions", async (c) => {
    return c.json({ sessions: listSessions() })
  })

  app.get("/twin/:projectId", async (c) => {
    const profile = await twin.getProfile(c.req.param("projectId"))
    return c.json(profile)
  })

  app.post("/twin/:projectId/constraint", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    const parsed = parseBody(body, ConstraintCreateSchema)
    if (!parsed.ok) return c.json(parsed.error, 400)

    const constraint = await twin.addConstraint({
      projectId: c.req.param("projectId"),
      description: parsed.data.description,
      category: parsed.data.category,
      expiresAt: parsed.data.expiresAt,
      createdAt: nowIso(),
    })

    return c.json(constraint)
  })

  app.delete("/twin/:projectId/constraint/:id", async (c) => {
    await twin.removeConstraint(c.req.param("id"))
    return c.json({ removed: true, id: c.req.param("id") })
  })

  app.post("/twin/:projectId/decision", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    const parsed = parseBody(body, DecisionCreateSchema)
    if (!parsed.ok) return c.json(parsed.error, 400)

    const decision = await twin.recordDecision(parsed.data as Omit<Decision, "id">)
    return c.json(decision)
  })

  app.get("/config", async (c) => {
    try {
      const config = await loadConfig()
      return c.json(maskConfigSecrets(config))
    } catch (error) {
      if (error instanceof ConfigNotFoundError) {
        return c.json({ error: error.message }, 404)
      }
      if (error instanceof ConfigInvalidError) {
        return c.json({ error: error.message }, 400)
      }
      return c.json({ error: "Failed to load config" }, 500)
    }
  })

  app.put("/config", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    const parsed = parseBody(body, ConfigUpdateSchema)
    if (!parsed.ok) return c.json(parsed.error, 400)

    try {
      const config = await loadConfig()
      const merged = {
        ...config,
        ...parsed.data,
      }
      const validated = parseBody(merged, ConfigInitSchema)
      if (!validated.ok) return c.json(validated.error, 400)

      await saveConfig(validated.data)
      return c.json(maskConfigSecrets(validated.data))
    } catch (error) {
      if (error instanceof ConfigNotFoundError) {
        return c.json({ error: error.message }, 404)
      }
      if (error instanceof ConfigInvalidError) {
        return c.json({ error: error.message }, 400)
      }
      return c.json({ error: "Failed to update config" }, 500)
    }
  })

  app.post("/config/init", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    const parsed = parseBody(body, ConfigInitSchema)
    if (!parsed.ok) return c.json(parsed.error, 400)

    await saveConfig(parsed.data)
    await twin.upsertProject({
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      rootDir: parsed.data.rootDir,
      stack: parsed.data.stack,
      createdAt: parsed.data.createdAt,
    })

    daemonDeviceId = makeDeviceId(parsed.data.projectId)

    return c.json({ initialized: true, projectId: parsed.data.projectId })
  })

  app.get("/health", async (c) => {
    let provider: string | undefined
    try {
      const config = await loadConfig()
      provider = `${config.llmProvider}:${config.model}`
    } catch {
      provider = undefined
    }

    return c.json({
      status: "ok",
      version: "0.1.0",
      provider,
      sessions: sessions.size,
    })
  })

  app.get("/connect", async (c) => {
    const firstSession = sessions.values().next().value as SessionRuntime | undefined
    const projectId = firstSession?.projectId ?? "default-project"
    const deviceId = makeDeviceId(projectId)

    return c.json({
      deviceId,
      qrData: JSON.stringify({
        deviceId,
        daemonUrl: "http://localhost",
        projectId,
      }),
    })
  })

  app.post("/session/:id/response/preflight", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    const parsed = parseBody(
      body,
      z.object({
        awaitingResponseId: z.string(),
        decision: z.enum(["approve", "reject", "modify"]),
      }),
    )
    if (!parsed.ok) return c.json(parsed.error, 400)

    const accepted = resolvePreflightResponse(parsed.data.awaitingResponseId, parsed.data.decision)
    return c.json({ accepted })
  })

  app.post("/session/:id/response/decision", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    const parsed = parseBody(body, UserAnswerSchema)
    if (!parsed.ok) return c.json(parsed.error, 400)

    const accepted = resolveDecisionResponse(parsed.data.awaitingResponseId, parsed.data.answer)
    return c.json({ accepted })
  })

  app.post("/session/:id/level", async (c) => {
    const session = sessions.get(c.req.param("id"))
    if (!session) return c.json({ error: "Session not found" }, 404)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    const parsed = parseBody(body, LevelChangeSchema)
    if (!parsed.ok) return c.json(parsed.error, 400)

    const updated = updateSessionStatus(session, {
      dependenceLevel: parsed.data.newLevel,
    })

    const payload: LevelChangePayload = {
      newLevel: parsed.data.newLevel,
    }

    await broadcastSessionMessage(
      createMessage({
        type: "LEVEL_CHANGE",
        sessionId: updated.id,
        projectId: updated.projectId,
        payload,
      }),
    )
    await broadcastStatus(updated)

    return c.json({ updated: true, dependenceLevel: parsed.data.newLevel })
  })

  return app
}
