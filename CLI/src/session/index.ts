import type { ModelMessage } from "ai"
import type { SessionContext } from "./context"

const sessions = new Map<string, SessionContext>()

export function createSessionContext(input: {
  sessionId: string
  projectId: string
  messages?: ModelMessage[]
}): SessionContext {
  const now = new Date().toISOString()
  const context: SessionContext = {
    sessionId: input.sessionId,
    projectId: input.projectId,
    messages: input.messages ?? [],
    createdAt: now,
    updatedAt: now,
  }
  sessions.set(context.sessionId, context)
  return context
}

export function getSessionContext(sessionId: string): SessionContext | undefined {
  return sessions.get(sessionId)
}

export function updateSessionMessages(sessionId: string, messages: ModelMessage[]): SessionContext | undefined {
  const current = sessions.get(sessionId)
  if (!current) return undefined

  const next: SessionContext = {
    ...current,
    messages,
    updatedAt: new Date().toISOString(),
  }
  sessions.set(sessionId, next)
  return next
}

export function deleteSessionContext(sessionId: string): void {
  sessions.delete(sessionId)
}
