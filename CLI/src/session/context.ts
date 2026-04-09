import type { ModelMessage } from "ai"

export interface SessionContext {
  sessionId: string
  projectId: string
  messages: ModelMessage[]
  createdAt: string
  updatedAt: string
}
