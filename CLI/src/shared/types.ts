// Providers
export type LLMProvider =
  | "openai"
  | "anthropic"
  | "groq"
  | "google"
  | "mistral"
  | "cohere"
  | "ollama"
  | "azure"
  | "openai-compatible"

// Dependence levels
export type DependenceLevel = 1 | 2 | 3 | 4 | 5

// Project config
export interface ProjectConfig {
  projectId: string
  name: string
  rootDir: string
  stack: string[]
  dependenceLevel: DependenceLevel
  llmProvider: LLMProvider
  model: string
  apiKey?: string
  baseUrl?: string
  connectors: ConnectorConfig[]
  createdAt: string
}

export interface ConnectorConfig {
  type: "github" | "slack" | "jira"
  config: Record<string, string>
  enabled: boolean
}

// WebSocket message protocol
export type MessageType =
  | "TASK_SUBMIT"
  | "TASK_CANCEL"
  | "PREFLIGHT_MAP"
  | "AWAITING_APPROVAL"
  | "USER_APPROVE"
  | "USER_REJECT"
  | "USER_ANSWER"
  | "AGENT_LOG"
  | "TASK_COMPLETE"
  | "TASK_FAILED"
  | "SESSION_STATUS"
  | "DECISION_QUEUED"
  | "TWIN_UPDATE"
  | "DAEMON_ONLINE"
  | "DAEMON_OFFLINE"
  | "LEVEL_CHANGE"
  | "PING"
  | "PONG"

export interface AgentMessage {
  type: MessageType
  sessionId: string
  projectId: string
  deviceId: string
  timestamp: string
  payload: unknown
}

// Typed payloads
export interface TaskSubmitPayload {
  task: string
  dependenceLevel?: DependenceLevel
}

export interface PreflightMapPayload {
  map: PreflightMap
  awaitingResponseId: string
}

export interface AwaitingApprovalPayload {
  question: string
  options?: string[]
  awaitingResponseId: string
  timeoutMs?: number
}

export interface UserAnswerPayload {
  awaitingResponseId: string
  answer: string
}

export interface AgentLogPayload {
  level: "info" | "warn" | "error" | "tool"
  message: string
  toolName?: string
}

export interface TaskCompletePayload {
  summary: string
  decisionsRecorded: number
  filesChanged: string[]
  durationMs: number
}

export interface TaskFailedPayload {
  error: string
  partialCompletionSummary: string
  filesChanged: string[]
}

export interface SessionStatusPayload {
  status: "idle" | "running" | "awaiting_approval" | "paused" | "failed"
  currentTask?: string
  dependenceLevel: DependenceLevel
  remoteConnected: boolean
}

export interface LevelChangePayload {
  newLevel: DependenceLevel
}

// Pre-flight map
export interface PreflightMap {
  taskDescription: string
  filesToRead: string[]
  filesToWrite: string[]
  filesToDelete: string[]
  shellCommandsToRun: string[]
  estimatedBlastRadius: "low" | "medium" | "high"
  affectedFunctions: string[]
  affectedModules: string[]
  reasoning: string
}

// Twin memory
export interface Decision {
  id: string
  sessionId: string
  projectId: string
  timestamp: string
  description: string
  choice: string
  rejectedAlternatives: string[]
  reasoning: string
  causedBy?: string
  causes?: string[]
}

export interface Constraint {
  id: string
  projectId: string
  description: string
  category: "library" | "api" | "pattern" | "technology" | "client-requirement"
  expiresAt?: string
  createdAt: string
}

export interface FailurePattern {
  id: string
  projectId: string
  timestamp: string
  context: string
  errorMessage: string
  toolName: string
}

export interface CausalEdge {
  fromDecisionId: string
  toDecisionId: string
  projectId: string
}

export interface TwinProfile {
  projectId: string
  stack: string[]
  decisions: Decision[]
  constraints: Constraint[]
  failurePatterns: FailurePattern[]
}

// Delegation
export interface DelegationBudget {
  maxInterruptions: number
  currentInterruptions: number
  minComplexityToInterrupt: 1 | 2 | 3
  queuedDecisions: QueuedDecision[]
}

export interface QueuedDecision {
  id: string
  description: string
  options: string[]
  complexity: 1 | 2 | 3
  queuedAt: string
}

// Tools
export interface ToolContext {
  sessionId: string
  projectId: string
  dependenceLevel: DependenceLevel
  delegationBudget?: DelegationBudget
  abortSignal?: AbortSignal
  ask: (question: string, options?: string[]) => Promise<string>
  log: (level: "info" | "warn" | "error" | "tool", message: string) => void
  preflight: (map: PreflightMap) => Promise<boolean>
}
