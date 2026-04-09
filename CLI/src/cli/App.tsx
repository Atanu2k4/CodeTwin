import { Box, Text, useApp, useInput } from "ink"
import { useCallback, useEffect, useRef, useState } from "react"
import { Chat, DecisionPrompt, PreflightMapView, StatusBar } from "./components"
import { useDaemon } from "./hooks/useDaemon"
import { useSession } from "./hooks/useSession"

export function App(): JSX.Element {
  const { exit } = useApp()
  const daemon = useDaemon()
  const session = useSession({
    daemonUrl: daemon.daemonUrl,
    ensureDaemon: daemon.ensureDaemon,
    request: daemon.request,
  })

  const [input, setInput] = useState("")
  const initializedRef = useRef(false)
  const exitingRef = useRef(false)

  const handleExit = useCallback(async () => {
    if (exitingRef.current) return
    exitingRef.current = true

    try {
      if (
        session.sessionId &&
        (session.status === "running" || session.status === "awaiting_approval") &&
        daemon.daemonUrl
      ) {
        try {
          await daemon.request(`/session/${session.sessionId}/cancel`, {
            method: "POST",
            body: JSON.stringify({
              reason: "Task cancelled from CLI exit",
            }),
          })
        } catch {
          // Best-effort cancellation only.
        }
      }

      await daemon.stopDaemon()
    } finally {
      exit()
    }
  }, [daemon, exit, session.sessionId, session.status])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    void (async () => {
      const ready = await daemon.ensureDaemon()
      if (!ready) return
      await session.createSession()
    })()
  }, [daemon, session])

  useInput((chunk, key) => {
    if (key.ctrl && chunk.toLowerCase() === "c") {
      void handleExit()
      return
    }

    if (chunk.toLowerCase() === "q") {
      void handleExit()
      return
    }

    if (session.pendingPreflight) {
      const lower = chunk.toLowerCase()
      if (lower === "a") {
        void session.respondPreflight("approve")
        return
      }
      if (lower === "r") {
        void session.respondPreflight("reject")
        return
      }
      if (lower === "m") {
        void session.respondPreflight("modify")
        return
      }
    }

    if (chunk >= "1" && chunk <= "5") {
      const nextLevel = Number.parseInt(chunk, 10) as 1 | 2 | 3 | 4 | 5
      void session.setLevel(nextLevel)
      return
    }

    if (key.return) {
      const trimmed = input.trim()
      if (!trimmed) return

      if (session.pendingDecision) {
        void session.respondDecision(trimmed)
      } else {
        void session.submitTask(trimmed)
      }
      setInput("")
      return
    }

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1))
      return
    }

    if (chunk.length > 0 && !key.ctrl && !key.meta) {
      setInput((prev) => `${prev}${chunk}`)
    }
  })

  return (
    <Box flexDirection="column">
      <StatusBar
        projectName="CodeTwin"
        level={session.dependenceLevel}
        modelLabel={daemon.daemonUrl ? daemon.daemonUrl : "daemon:offline"}
        remoteConnected={session.status !== "failed"}
      />

      <Box flexDirection="column" minHeight={16} borderStyle="single" borderColor="gray" padding={1}>
        <Chat entries={session.logs} />
        {session.pendingPreflight ? <PreflightMapView map={session.pendingPreflight.map} /> : null}
        {session.pendingDecision ? (
          <DecisionPrompt
            question={session.pendingDecision.question}
            options={session.pendingDecision.options}
          />
        ) : null}
        {session.completionSummary ? <Text color="green">{`Summary: ${session.completionSummary}`}</Text> : null}
        {session.error ? <Text color="red">{`Error: ${session.error}`}</Text> : null}
      </Box>

      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text>{`> ${input}`}</Text>
      </Box>

      <Text color="gray">[Q] Quit  [A/R/M] Preflight  [1-5] Level  [Enter] Submit</Text>
      {daemon.loading ? <Text color="yellow">Starting CodeTwin daemon...</Text> : null}
      {daemon.error ? <Text color="red">{daemon.error}</Text> : null}
    </Box>
  )
}
