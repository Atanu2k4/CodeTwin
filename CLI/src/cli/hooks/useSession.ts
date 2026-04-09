import { useCallback, useEffect, useMemo, useRef, useState } from "react"
// @ts-ignore eventsource typings use `export =` while this runtime path expects default import.
import EventSource from "eventsource"
import type { AgentMessage, PreflightMap, SessionStatusPayload } from "../../shared/types"

export interface ChatEntry {
  id: string
  role: "agent" | "user" | "system"
  text: string
}

export interface PendingPreflight {
  awaitingResponseId: string
  map: PreflightMap
}

export interface PendingDecision {
  awaitingResponseId: string
  question: string
  options: string[]
}

interface SessionState {
  sessionId: string | null
  status: SessionStatusPayload["status"]
  dependenceLevel: number
  logs: ChatEntry[]
  pendingPreflight: PendingPreflight | null
  pendingDecision: PendingDecision | null
  completionSummary: string | null
  error: string | null
}

type SSEEvent = {
  data: string
}

function parseMessage(raw: string): AgentMessage | null {
  try {
    return JSON.parse(raw) as AgentMessage
  } catch {
    return null
  }
}

export function useSession(input: {
  daemonUrl: string | null
  ensureDaemon: () => Promise<string | null>
  request: <TResponse = unknown>(pathValue: string, init?: RequestInit) => Promise<TResponse>
}): {
  sessionId: string | null
  status: SessionStatusPayload["status"]
  dependenceLevel: number
  logs: ChatEntry[]
  pendingPreflight: PendingPreflight | null
  pendingDecision: PendingDecision | null
  completionSummary: string | null
  error: string | null
  createSession: () => Promise<void>
  submitTask: (task: string) => Promise<void>
  respondPreflight: (decision: "approve" | "reject" | "modify") => Promise<void>
  respondDecision: (answer: string) => Promise<void>
  setLevel: (level: 1 | 2 | 3 | 4 | 5) => Promise<void>
} {
  const [state, setState] = useState<SessionState>({
    sessionId: null,
    status: "idle",
    dependenceLevel: 3,
    logs: [],
    pendingPreflight: null,
    pendingDecision: null,
    completionSummary: null,
    error: null,
  })

  const eventSourceRef = useRef<EventSource | null>(null)

  const appendLog = useCallback((entry: ChatEntry) => {
    setState((prev) => ({
      ...prev,
      logs: [...prev.logs, entry],
    }))
  }, [])

  const connectStream = useCallback(
    async (sessionId: string) => {
      let daemonUrl = input.daemonUrl
      if (!daemonUrl) {
        daemonUrl = await input.ensureDaemon()
      }

      if (!daemonUrl) {
        setState((prev) => ({
          ...prev,
          error: "Daemon is not ready",
        }))
        return
      }

      eventSourceRef.current?.close()
      const source = new EventSource(`${daemonUrl}/session/${sessionId}/stream`)
      eventSourceRef.current = source

      source.addEventListener("AGENT_LOG", (event: SSEEvent) => {
        const message = parseMessage(event.data)
        if (!message) return

        const payload = message.payload as { message?: string }
        appendLog({
          id: `${message.timestamp}:${Math.random().toString(36).slice(2)}`,
          role: "agent",
          text: payload.message ?? "",
        })
      })

      source.addEventListener("PREFLIGHT_MAP", (event: SSEEvent) => {
        const message = parseMessage(event.data)
        if (!message) return

        const payload = message.payload as { map: PreflightMap; awaitingResponseId: string }
        setState((prev) => ({
          ...prev,
          pendingPreflight: {
            awaitingResponseId: payload.awaitingResponseId,
            map: payload.map,
          },
        }))
      })

      source.addEventListener("AWAITING_APPROVAL", (event: SSEEvent) => {
        const message = parseMessage(event.data)
        if (!message) return

        const payload = message.payload as {
          awaitingResponseId: string
          question: string
          options?: string[]
        }
        setState((prev) => ({
          ...prev,
          pendingDecision: {
            awaitingResponseId: payload.awaitingResponseId,
            question: payload.question,
            options: payload.options ?? [],
          },
        }))
      })

      source.addEventListener("TASK_COMPLETE", (event: SSEEvent) => {
        const message = parseMessage(event.data)
        if (!message) return

        const payload = message.payload as { summary?: string }
        setState((prev) => ({
          ...prev,
          status: "idle",
          pendingDecision: null,
          pendingPreflight: null,
          completionSummary: payload.summary ?? "Task complete",
        }))
      })

      source.addEventListener("TASK_FAILED", (event: SSEEvent) => {
        const message = parseMessage(event.data)
        if (!message) return

        const payload = message.payload as { error?: string }
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: payload.error ?? "Task failed",
        }))
      })

      source.addEventListener("SESSION_STATUS", (event: SSEEvent) => {
        const message = parseMessage(event.data)
        if (!message) return

        const payload = message.payload as SessionStatusPayload
        setState((prev) => ({
          ...prev,
          status: payload.status,
          dependenceLevel: payload.dependenceLevel,
        }))
      })

      source.onerror = () => {
        setState((prev) => ({
          ...prev,
          error: "Session stream disconnected",
        }))
      }
    },
    [appendLog, input.daemonUrl, input.ensureDaemon],
  )

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close()
      eventSourceRef.current = null
    }
  }, [])

  const createSession = useCallback(async () => {
    const response = await input.request<{ sessionId: string; dependenceLevel: number }>("/session/new", {
      method: "POST",
      body: JSON.stringify({}),
    })

    setState((prev) => ({
      ...prev,
      sessionId: response.sessionId,
      dependenceLevel: response.dependenceLevel,
      logs: [],
      completionSummary: null,
      error: null,
    }))

    await connectStream(response.sessionId)
  }, [connectStream, input])

  const submitTask = useCallback(
    async (task: string) => {
      if (!state.sessionId) throw new Error("Session is not initialized")

      appendLog({
        id: `${Date.now()}:user`,
        role: "user",
        text: task,
      })

      await input.request(`/session/${state.sessionId}/task`, {
        method: "POST",
        body: JSON.stringify({ task }),
      })

      setState((prev) => ({
        ...prev,
        status: "running",
        completionSummary: null,
      }))
    },
    [appendLog, input, state.sessionId],
  )

  const respondPreflight = useCallback(
    async (decision: "approve" | "reject" | "modify") => {
      if (!state.sessionId || !state.pendingPreflight) return

      await input.request(`/session/${state.sessionId}/response/preflight`, {
        method: "POST",
        body: JSON.stringify({
          awaitingResponseId: state.pendingPreflight.awaitingResponseId,
          decision,
        }),
      })

      setState((prev) => ({
        ...prev,
        pendingPreflight: null,
      }))
    },
    [input, state.pendingPreflight, state.sessionId],
  )

  const respondDecision = useCallback(
    async (answer: string) => {
      if (!state.sessionId || !state.pendingDecision) return

      await input.request(`/session/${state.sessionId}/response/decision`, {
        method: "POST",
        body: JSON.stringify({
          awaitingResponseId: state.pendingDecision.awaitingResponseId,
          answer,
        }),
      })

      setState((prev) => ({
        ...prev,
        pendingDecision: null,
      }))
    },
    [input, state.pendingDecision, state.sessionId],
  )

  const setLevel = useCallback(
    async (level: 1 | 2 | 3 | 4 | 5) => {
      if (!state.sessionId) return

      await input.request(`/session/${state.sessionId}/level`, {
        method: "POST",
        body: JSON.stringify({ newLevel: level }),
      })

      setState((prev) => ({
        ...prev,
        dependenceLevel: level,
      }))
    },
    [input, state.sessionId],
  )

  return useMemo(
    () => ({
      sessionId: state.sessionId,
      status: state.status,
      dependenceLevel: state.dependenceLevel,
      logs: state.logs,
      pendingPreflight: state.pendingPreflight,
      pendingDecision: state.pendingDecision,
      completionSummary: state.completionSummary,
      error: state.error,
      createSession,
      submitTask,
      respondPreflight,
      respondDecision,
      setLevel,
    }),
    [createSession, respondDecision, respondPreflight, setLevel, state],
  )
}
