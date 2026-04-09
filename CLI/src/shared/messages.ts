import { z } from "zod"

export const MessageTypeSchema = z.enum([
  "TASK_SUBMIT",
  "TASK_CANCEL",
  "PREFLIGHT_MAP",
  "AWAITING_APPROVAL",
  "USER_APPROVE",
  "USER_REJECT",
  "USER_ANSWER",
  "AGENT_LOG",
  "TASK_COMPLETE",
  "TASK_FAILED",
  "SESSION_STATUS",
  "DECISION_QUEUED",
  "TWIN_UPDATE",
  "DAEMON_ONLINE",
  "DAEMON_OFFLINE",
  "LEVEL_CHANGE",
  "PING",
  "PONG",
])

export const DependenceLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
])

export const AgentMessageSchema = z.object({
  type: MessageTypeSchema,
  sessionId: z.string(),
  projectId: z.string(),
  deviceId: z.string(),
  timestamp: z.string(),
  payload: z.unknown(),
})

export const TaskSubmitSchema = z.object({
  task: z.string().min(1),
  dependenceLevel: DependenceLevelSchema.optional(),
})

export const UserAnswerSchema = z.object({
  awaitingResponseId: z.string(),
  answer: z.string(),
})

export const LevelChangeSchema = z.object({
  newLevel: DependenceLevelSchema,
})
