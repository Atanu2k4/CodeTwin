// @ts-ignore better-sqlite3 typings use `export =`; runtime uses ESM-compatible default import here.
import Database from "better-sqlite3"
import { generateText, stepCountIs, streamText, tool, type ModelMessage, type ToolSet } from "ai"
import { mkdir, rename } from "node:fs/promises"
import path from "node:path"
import { loadConfig } from "../config"
import { buildProvider } from "../llm/provider"
import {
  AGENT_STREAM_MAX_ATTEMPTS,
  AGENT_STREAM_RETRY_BASE_MS,
  AGENT_STREAM_RETRY_MAX_MS,
  MAX_TOOL_ITERATIONS,
  MAX_TOOL_OUTPUT_BYTES,
  SESSIONS_DB_FILE,
} from "../shared/constants"
import type {
  DelegationBudget,
  DependenceLevel,
  PreflightMap,
  TaskCompletePayload,
  TaskFailedPayload,
} from "../shared/types"
import { listTools } from "../tools/registry"
import { twin } from "../twin"

interface SessionMessageRow {
  message_index: number
  message_json: string
}

let sessionsDb: Database.Database | null = null

interface AgentRetryConfig {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === "AbortError") return true

  const message = error.message.toLowerCase()
  return message.includes("task cancelled") || message.includes("task canceled")
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return

  const reason = signal.reason
  const error = reason instanceof Error ? reason : new Error("Task cancelled")
  error.name = "AbortError"
  throw error
}

function isRetryableAgentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (isAbortError(error)) return false

  const message = error.message.toLowerCase()
  return [
    "timeout",
    "timed out",
    "rate limit",
    "too many requests",
    "econnreset",
    "econnrefused",
    "etimedout",
    "temporarily unavailable",
    "service unavailable",
    "gateway timeout",
    "network",
    "fetch failed",
  ].some((pattern) => message.includes(pattern))
}

function computeRetryDelayMs(attempt: number, config: AgentRetryConfig): number {
  const exponential = config.baseDelayMs * 2 ** Math.max(0, attempt - 1)
  const jitter = Math.floor(Math.random() * 250)
  return Math.min(config.maxDelayMs, exponential) + jitter
}

function withAbortRace<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise

  throwIfAborted(signal)

  let removeListener: (() => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    const onAbort = () => {
      const reason = signal.reason
      const error = reason instanceof Error ? reason : new Error("Task cancelled")
      error.name = "AbortError"
      reject(error)
    }

    signal.addEventListener("abort", onAbort, { once: true })
    removeListener = () => signal.removeEventListener("abort", onAbort)
  })

  return Promise.race([promise, abortPromise]).finally(() => {
    removeListener?.()
  })
}

async function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  await withAbortRace(
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    }),
    signal,
  )
}

function levelInstruction(level: DependenceLevel): string {
  switch (level) {
    case 1:
      return "Ask before EVERY file write, delete, or shell command. No exceptions."
    case 2:
      return "Ask before writes and deletes. Silent on reads and status checks."
    case 3:
      return "Ask when multiple valid approaches exist. Execute clear single-path actions."
    case 4:
      return "Ask only for destructive actions: delete, overwrite, deploy, push."
    case 5:
      return "Execute and report. Interrupt only if budget allows and complexity is critical."
    default:
      return "Ask when unsure."
  }
}

function truncateText(input: string, maxBytes: number): string {
  if (Buffer.byteLength(input, "utf8") <= maxBytes) return input
  return `${Buffer.from(input, "utf8").subarray(0, maxBytes).toString("utf8")}\n\n[truncated]`
}

function estimateContextUtilization(messages: ModelMessage[]): number {
  const chars = messages
    .map((message) => {
      if (typeof message.content === "string") return message.content.length
      return JSON.stringify(message.content).length
    })
    .reduce((sum, value) => sum + value, 0)

  // Rough approximation: 4 chars ~= 1 token and a 16k token default context guardrail.
  const estimatedTokens = chars / 4
  return estimatedTokens / 16_000
}

function buildSystemPrompt(input: {
  task: string
  dependenceLevel: DependenceLevel
  twinContextSummary: string
  causalGraphContext: string
  constraintsList: string
  stack: string[]
}): string {
  return [
    "You are CodeTwin - a coding agent that works WITH the developer.",
    `DEPENDENCE LEVEL: ${input.dependenceLevel} / 5`,
    levelInstruction(input.dependenceLevel),
    "TWIN CONTEXT (your memory of this project):",
    input.twinContextSummary,
    "RELEVANT CAUSAL DECISION GRAPH (nearest ancestors/descendants for this task):",
    input.causalGraphContext,
    "ACTIVE CONSTRAINTS - you MUST NOT violate these:",
    input.constraintsList,
    `PROJECT STACK: ${input.stack.join(", ") || "Unknown"}`,
    "RULES:",
    "Never fill architectural gaps on your own - ask the user",
    "Always show the pre-flight map before any write, delete, or shell action",
    "When multiple valid approaches exist, present them and ask",
    "When the user asks to create/build/fix code, execute concrete workspace actions with tools instead of stopping at a plan-only response",
    "Record every significant decision using record_decision tool",
    "If a proposed action violates a constraint, stop and report it immediately",
    "The user's machine is your working environment - never assume cloud infra",
    "",
    `CURRENT TASK: ${input.task}`,
  ].join("\n")
}

function taskNeedsWorkspaceAction(task: string): boolean {
  const lower = task.toLowerCase().trim()
  if (lower.length === 0) return false

  const actionVerb =
    /\b(create|build|implement|fix|update|edit|write|add|setup|scaffold|generate|refactor|continue|make|develop|ship)\b/.test(
      lower,
    )
  const artifactHint =
    /\b(file|folder|project|component|ui|page|api|server|script|todo|to-do|website|web\s+app|index\.(ts|tsx|js|jsx|md))\b/.test(
      lower,
    )
  const userIntentHint = /\b(i\s+want|please|can\s+you|kindly)\b/.test(lower)

  if (actionVerb) return true
  if (artifactHint && userIntentHint) return true
  return false
}

function countToolCallsInSteps(steps: unknown[]): number {
  return steps.reduce<number>((count, step) => {
    if (!step || typeof step !== "object") return count
    const candidate = (step as { toolCalls?: unknown }).toolCalls
    return count + (Array.isArray(candidate) ? candidate.length : 0)
  }, 0)
}

function getLastFinishReason(steps: unknown[]): string | undefined {
  const last = steps.length > 0 ? steps[steps.length - 1] : undefined
  if (!last || typeof last !== "object") return undefined
  const reason = (last as { finishReason?: unknown }).finishReason
  return typeof reason === "string" ? reason : undefined
}

function isNoProgressCompletion(input: {
  requiresWorkspaceAction: boolean
  attemptToolCalls: number
  finalText: string
  finishReason?: string
}): boolean {
  if (!input.requiresWorkspaceAction) return false
  if (input.attemptToolCalls > 0) return false

  const text = input.finalText.trim()
  if (text.length === 0) return true

  if (input.finishReason === "other") return true

  const planOnlySignal =
    /\b(i\s+will|i\'ll|let\s+me|i\s+can|would\s+you\s+like|next\s+step|proceed|unable|apologize)\b/i.test(text)

  return planOnlySignal
}

function buildPreflightMap(task: string, toolName: string, args: unknown): PreflightMap {
  const argsRecord = args && typeof args === "object" ? (args as Record<string, unknown>) : {}
  const filePath = typeof argsRecord.filePath === "string" ? argsRecord.filePath : undefined
  const command = typeof argsRecord.command === "string" ? argsRecord.command : undefined

  return {
    taskDescription: task,
    filesToRead: toolName === "read" && filePath ? [filePath] : [],
    filesToWrite: ["write", "edit"].includes(toolName) && filePath ? [filePath] : [],
    filesToDelete: [],
    shellCommandsToRun: toolName === "bash" && command ? [command] : [],
    estimatedBlastRadius: "low",
    affectedFunctions: [],
    affectedModules: filePath ? [filePath] : [],
    reasoning: `Tool '${toolName}' requested with args ${JSON.stringify(argsRecord)}`,
  }
}

function shouldRequestPreflight(toolName: string, level: DependenceLevel): boolean {
  if (toolName === "read") return false
  if (toolName === "bash") return level <= 4
  if (["write", "edit", "git"].includes(toolName)) return level <= 4
  return level <= 2
}

function isAbortChoice(answer: string): boolean {
  return answer.toLowerCase().includes("abort")
}

async function getSessionsDb(): Promise<Database.Database> {
  if (sessionsDb) return sessionsDb

  const dbPath = path.resolve(process.cwd(), SESSIONS_DB_FILE)
  await mkdir(path.dirname(dbPath), { recursive: true })

  const init = (): Database.Database => {
    const sqlite = new Database(dbPath)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS session_messages (
        session_id TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        message_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, message_index)
      );
      CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages (session_id, message_index);
    `)
    return sqlite
  }

  try {
    sessionsDb = init()
  } catch {
    const backup = `${dbPath}.corrupt.${Date.now()}.bak`
    try {
      await rename(dbPath, backup)
      console.warn(`CodeTwin sessions DB looked corrupted; moved it to '${backup}' and reinitialized.`)
    } catch {
      // If backup fails we still attempt a fresh DB.
      console.warn("CodeTwin sessions DB looked corrupted; backup move failed, attempting fresh initialization.")
    }
    sessionsDb = init()
  }

  return sessionsDb
}

async function loadSessionMessages(sessionId: string): Promise<ModelMessage[]> {
  const database = await getSessionsDb()
  const rows = database
    .prepare("SELECT message_index, message_json FROM session_messages WHERE session_id = ? ORDER BY message_index ASC")
    .all(sessionId) as SessionMessageRow[]

  const messages: ModelMessage[] = []
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.message_json) as ModelMessage
      messages.push(parsed)
    } catch {
      // Skip malformed row to keep session resilient.
    }
  }

  return messages
}

async function saveSessionMessages(sessionId: string, messages: ModelMessage[]): Promise<void> {
  const database = await getSessionsDb()
  const now = new Date().toISOString()

  const tx = database.transaction(() => {
    database.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId)

    const insert = database.prepare(
      "INSERT INTO session_messages (session_id, message_index, message_json, created_at) VALUES (?, ?, ?, ?)",
    )

    messages.forEach((message, index) => {
      insert.run(sessionId, index, JSON.stringify(message), now)
    })
  })

  tx()
}

async function compactMessagesIfNeeded(input: {
  model: ReturnType<typeof buildProvider>
  systemPrompt: string
  messages: ModelMessage[]
}): Promise<ModelMessage[]> {
  const utilization = estimateContextUtilization(input.messages)
  if (utilization <= 0.8 || input.messages.length <= 12) {
    return input.messages
  }

  const recent = input.messages.slice(-10)
  const older = input.messages.slice(0, -10)

  const summaryPrompt = [
    "Summarize this conversation history concisely, preserving all decisions and important context.",
    JSON.stringify(older),
  ].join("\n\n")

  const summaryResult = await generateText({
    model: input.model,
    system: input.systemPrompt,
    prompt: summaryPrompt,
  })

  const summaryMessage: ModelMessage = {
    role: "system",
    content: `Compacted session summary: ${summaryResult.text}`,
  }

  return [summaryMessage, ...recent]
}

export async function runAgentLoop(input: {
  sessionId: string
  task: string
  projectId: string
  dependenceLevel: DependenceLevel
  getDependenceLevel?: () => DependenceLevel
  abortSignal?: AbortSignal
  retryConfig?: Partial<AgentRetryConfig>
  delegationBudget?: DelegationBudget
  onLog: (level: "info" | "warn" | "error" | "tool", msg: string) => void
  onPreflightRequired: (map: PreflightMap) => Promise<boolean>
  onDecisionRequired: (question: string, options: string[]) => Promise<string>
  onDecisionQueued?: (queued: {
    id: string
    description: string
    options: string[]
    queuedAt: string
  }) => void
  onComplete: (summary: TaskCompletePayload) => void
  onFailed: (error: TaskFailedPayload) => void
}): Promise<void> {
  const startedAt = Date.now()
  let filesChanged: string[] = []
  const requiresWorkspaceAction = taskNeedsWorkspaceAction(input.task)
  let noProgressRecoveryUsed = false
  const retryConfig: AgentRetryConfig = {
    maxAttempts: input.retryConfig?.maxAttempts ?? AGENT_STREAM_MAX_ATTEMPTS,
    baseDelayMs: input.retryConfig?.baseDelayMs ?? AGENT_STREAM_RETRY_BASE_MS,
    maxDelayMs: input.retryConfig?.maxDelayMs ?? AGENT_STREAM_RETRY_MAX_MS,
  }

  try {
    throwIfAborted(input.abortSignal)

    input.onLog("info", "Loading twin context...")
    const [config, twinContextSummary, causalGraphContext, constraints, sessionHistory] = await withAbortRace(
      Promise.all([
        loadConfig(),
        twin.buildContextSummary(input.projectId),
        twin
          .buildRelevantCausalContext(input.projectId, input.task)
          .catch(() => "Relevant causal graph nodes: unavailable"),
        twin.getConstraints(input.projectId),
        loadSessionMessages(input.sessionId),
      ]),
      input.abortSignal,
    )

    const systemPrompt = buildSystemPrompt({
      task: input.task,
      dependenceLevel: input.dependenceLevel,
      twinContextSummary,
      causalGraphContext,
      constraintsList:
        constraints.length === 0 ? "None" : constraints.map((item) => `- ${item.description}`).join("\n"),
      stack: config.stack,
    })

    const model = buildProvider(config)

    const initialMessages: ModelMessage[] = [
      ...sessionHistory,
      {
        role: "user",
        content: input.task,
      },
    ]

    let messages = await withAbortRace(
      compactMessagesIfNeeded({
        model,
        systemPrompt,
        messages: initialMessages,
      }),
      input.abortSignal,
    )

    let loopDetected = false
    let toolCallsSeen = 0
    const recentToolCalls: string[] = []
    let lastEffectiveLevel = input.dependenceLevel

    const requestDecision = async (question: string, options: string[]): Promise<string> => {
      if (
        input.delegationBudget &&
        input.delegationBudget.currentInterruptions >= input.delegationBudget.maxInterruptions
      ) {
        const queuedAt = new Date().toISOString()
        const queued = {
          id: crypto.randomUUID(),
          description: question,
          options,
          complexity: 2 as const,
          queuedAt,
        }
        input.delegationBudget.queuedDecisions.push(queued)
        input.onDecisionQueued?.({
          id: queued.id,
          description: queued.description,
          options: queued.options,
          queuedAt: queued.queuedAt,
        })
        input.onLog("warn", "Delegation interruption budget exceeded; queued decision for later review.")

        return options[0] ?? "continue"
      }

      if (input.delegationBudget) {
        input.delegationBudget.currentInterruptions += 1
      }

      return withAbortRace(input.onDecisionRequired(question, options), input.abortSignal)
    }

    const aiTools: ToolSet = {}
    for (const toolDefinition of listTools()) {
      aiTools[toolDefinition.id] = tool({
        description: toolDefinition.description,
        inputSchema: toolDefinition.parameters,
        async execute(args) {
          throwIfAborted(input.abortSignal)

          const validation = toolDefinition.parameters.safeParse(args)
          if (!validation.success) {
            const message = `Invalid parameters for tool '${toolDefinition.id}': ${validation.error.message}`
            input.onLog("error", message)
            return { error: message }
          }

          const callSignature = `${toolDefinition.id}:${JSON.stringify(validation.data)}`
          recentToolCalls.push(callSignature)
          if (recentToolCalls.length > 3) recentToolCalls.shift()
          if (recentToolCalls.length === 3 && recentToolCalls.every((item) => item === callSignature)) {
            loopDetected = true
            const message = `Infinite loop detected for tool '${toolDefinition.id}' with identical parameters.`
            input.onLog("error", message)
            return { error: message }
          }

          toolCallsSeen += 1

          const activeDependenceLevel = input.getDependenceLevel
            ? input.getDependenceLevel()
            : input.dependenceLevel
          if (activeDependenceLevel !== lastEffectiveLevel) {
            input.onLog(
              "info",
              `Dependence level changed from ${lastEffectiveLevel} to ${activeDependenceLevel}; applying immediately.`,
            )
            lastEffectiveLevel = activeDependenceLevel
          }

          const proposedAction = `${toolDefinition.id} ${JSON.stringify(validation.data)}`
          const violation = await twin.checkConstraintViolation(input.projectId, proposedAction)
          if (violation.violated) {
            const reason = violation.reasoning ?? "Constraint violation detected"
            const message = `Constraint violation: ${reason}`
            input.onLog("error", message)
            await requestDecision(message, ["revise action", "abort task"])
            throw new Error(message)
          }

          if (shouldRequestPreflight(toolDefinition.id, activeDependenceLevel)) {
            const preflightMap = buildPreflightMap(input.task, toolDefinition.id, validation.data)
            const approved = await withAbortRace(input.onPreflightRequired(preflightMap), input.abortSignal)
            if (!approved) {
              const decision = await requestDecision("How would you like to proceed?", [
                "retry with modifications",
                "skip this action",
                "abort task",
              ])
              if (isAbortChoice(decision)) {
                throw new Error("Task aborted after preflight rejection")
              }
              return { error: `Action skipped for tool '${toolDefinition.id}' after preflight rejection` }
            }
          }

          const result = await withAbortRace(
            toolDefinition.execute(validation.data, {
              sessionId: input.sessionId,
              projectId: input.projectId,
              dependenceLevel: activeDependenceLevel,
              delegationBudget: input.delegationBudget,
              abortSignal: input.abortSignal,
              ask: (question, options) => requestDecision(question, options ?? []),
              preflight: (map) => withAbortRace(input.onPreflightRequired(map), input.abortSignal),
              log: input.onLog,
            }),
            input.abortSignal,
          )

          if (typeof validation.data === "object" && validation.data && "filePath" in validation.data) {
            const pathValue = (validation.data as { filePath?: unknown }).filePath
            if (typeof pathValue === "string") {
              filesChanged.push(pathValue)
            }
          }

          input.onLog("tool", `${toolDefinition.id}: ${result.title}`)
          return {
            title: result.title,
            output: truncateText(result.output, MAX_TOOL_OUTPUT_BYTES),
            ...(result.metadata ? { metadata: result.metadata } : {}),
          }
        },
      })
    }

    let finalText = ""
    let responseMessages: ModelMessage[] = []
    let stepsCount = 0

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt += 1) {
      throwIfAborted(input.abortSignal)

      if (attempt === 1) {
        input.onLog("info", "Starting streamed agent execution...")
      } else {
        input.onLog("warn", `Retrying streamed execution (attempt ${attempt}/${retryConfig.maxAttempts})...`)
      }

      const result = streamText({
        model,
        system: systemPrompt,
        messages,
        tools: aiTools,
        stopWhen: stepCountIs(MAX_TOOL_ITERATIONS),
        onStepFinish(step) {
          input.onLog(
            "info",
            `Step ${step.stepNumber + 1} finished (tool calls: ${step.toolCalls.length}, reason: ${step.finishReason})`,
          )
        },
        onError(event) {
          input.onLog(
            "error",
            `Streaming error: ${event.error instanceof Error ? event.error.message : String(event.error)}`,
          )
        },
      })

      try {
        const [text, response, steps] = await withAbortRace(
          Promise.all([result.text, result.response, result.steps]),
          input.abortSignal,
        )

        const attemptToolCalls = countToolCallsInSteps(steps)
        const finishReason = getLastFinishReason(steps)
        const noProgress = isNoProgressCompletion({
          requiresWorkspaceAction,
          attemptToolCalls,
          finalText: text,
          finishReason,
        })

        if (noProgress && !noProgressRecoveryUsed) {
          noProgressRecoveryUsed = true
          input.onLog(
            "warn",
            "Model response had no concrete actions for an implementation task; retrying once with execution-focused guidance.",
          )

          messages = [
            ...messages,
            {
              role: "system",
              content:
                "Previous attempt ended without concrete workspace actions. Execute the next concrete step now using tools and avoid plan-only responses.",
            },
          ]
          continue
        }

        if (noProgress && noProgressRecoveryUsed) {
          throw new Error(
            "No actionable workspace steps were executed for this task. Please provide a more specific implementation target (file/path/output).",
          )
        }

        finalText = text
        responseMessages = response.messages
        stepsCount = steps.length
        break
      } catch (error) {
        if (isAbortError(error)) {
          throw error
        }

        const retryable = isRetryableAgentError(error)
        if (!retryable || attempt === retryConfig.maxAttempts) {
          throw error
        }

        const waitMs = computeRetryDelayMs(attempt, retryConfig)
        input.onLog(
          "warn",
          `Transient agent error on attempt ${attempt}: ${normalizeErrorMessage(error)}. Retrying in ${waitMs}ms`,
        )
        await delayWithAbort(waitMs, input.abortSignal)
      }
    }

    if (stepsCount >= MAX_TOOL_ITERATIONS) {
      await requestDecision(
        `Reached max tool iteration limit (${MAX_TOOL_ITERATIONS}). Continue with a revised approach?`,
        ["continue", "abort"],
      )
    }

    if (loopDetected) {
      await requestDecision(
        "Detected repeated tool calls with identical inputs. Please choose how to proceed.",
        ["revise plan", "abort"],
      )
    }

    const updatedMessages: ModelMessage[] = [...messages, ...responseMessages]
    await withAbortRace(saveSessionMessages(input.sessionId, updatedMessages), input.abortSignal)

    const summaryText = finalText.trim().length > 0 ? finalText.trim() : "Task completed"
    filesChanged = Array.from(new Set(filesChanged))

    input.onComplete({
      summary: summaryText,
      decisionsRecorded: 0,
      filesChanged,
      durationMs: Date.now() - startedAt,
    })

    input.onLog("info", `Task completed with ${toolCallsSeen} tool call(s).`)
  } catch (error) {
    const message = isAbortError(error) ? "Task cancelled" : normalizeErrorMessage(error)

    input.onFailed({
      error: message,
      partialCompletionSummary: "Agent loop failed before completion.",
      filesChanged: Array.from(new Set(filesChanged)),
    })

    input.onLog("error", `Task failed: ${message}`)
  }
}
