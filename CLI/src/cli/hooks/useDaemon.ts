import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { useCallback, useMemo, useState } from "react"
import { DAEMON_PID_FILE, DAEMON_PORT_FILE } from "../../shared/constants"
import { resolveDaemonRunner } from "../daemonRunner"

interface DaemonState {
  daemonUrl: string | null
  loading: boolean
  error: string | null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function readDaemonPort(): Promise<number | null> {
  const portFile = path.resolve(process.cwd(), DAEMON_PORT_FILE)
  try {
    const raw = await readFile(portFile, "utf8")
    const parsed = Number.parseInt(raw.trim(), 10)
    if (!Number.isFinite(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

async function readDaemonPid(): Promise<number | null> {
  const pidFile = path.resolve(process.cwd(), DAEMON_PID_FILE)
  try {
    const raw = await readFile(pidFile, "utf8")
    const parsed = Number.parseInt(raw.trim(), 10)
    if (!Number.isFinite(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

async function pingHealth(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`)
    return response.ok
  } catch {
    return false
  }
}

function spawnDaemon(): void {
  const runner = resolveDaemonRunner("src/daemon/index.ts")
  const child = spawn(runner.command, runner.args, {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  })
  child.unref()
}

export function useDaemon(): {
  daemonUrl: string | null
  loading: boolean
  error: string | null
  ensureDaemon: () => Promise<string | null>
  stopDaemon: () => Promise<void>
  request: <TResponse = unknown>(pathValue: string, init?: RequestInit) => Promise<TResponse>
} {
  const [state, setState] = useState<DaemonState>({
    daemonUrl: null,
    loading: false,
    error: null,
  })

  const ensureDaemon = useCallback(async (): Promise<string | null> => {
    setState((prev) => ({ ...prev, loading: true, error: null }))

    try {
      const existingPort = await readDaemonPort()
      if (existingPort) {
        const existingUrl = `http://127.0.0.1:${existingPort}`
        if (await pingHealth(existingUrl)) {
          setState({ daemonUrl: existingUrl, loading: false, error: null })
          return existingUrl
        }
      }

      spawnDaemon()

      for (let attempt = 0; attempt < 50; attempt += 1) {
        const nextPort = await readDaemonPort()
        if (nextPort) {
          const nextUrl = `http://127.0.0.1:${nextPort}`
          if (await pingHealth(nextUrl)) {
            setState({ daemonUrl: nextUrl, loading: false, error: null })
            return nextUrl
          }
        }
        await delay(200)
      }

      setState({
        daemonUrl: null,
        loading: false,
        error: "Starting CodeTwin daemon timed out",
      })
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setState({ daemonUrl: null, loading: false, error: message })
      return null
    }
  }, [])

  const stopDaemon = useCallback(async (): Promise<void> => {
    const pid = await readDaemonPid()
    if (!pid) return

    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // Best-effort local shutdown.
    }
  }, [])

  const request = useCallback(
    async <TResponse = unknown>(pathValue: string, init?: RequestInit): Promise<TResponse> => {
      let daemonUrl = state.daemonUrl
      if (!daemonUrl) {
        daemonUrl = await ensureDaemon()
      }

      if (!daemonUrl) {
        throw new Error("Daemon is not ready")
      }

      if (!(await pingHealth(daemonUrl))) {
        daemonUrl = await ensureDaemon()
      }

      if (!daemonUrl) {
        throw new Error("Daemon is not ready")
      }

      const response = await fetch(`${daemonUrl}${pathValue}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      })

      const json = (await response.json()) as TResponse | { error?: string }
      if (!response.ok) {
        const message = typeof json === "object" && json && "error" in json ? json.error : undefined
        throw new Error(message ?? `Request failed with status ${response.status}`)
      }

      return json as TResponse
    },
    [ensureDaemon, state.daemonUrl],
  )

  return useMemo(
    () => ({
      daemonUrl: state.daemonUrl,
      loading: state.loading,
      error: state.error,
      ensureDaemon,
      stopDaemon,
      request,
    }),
    [ensureDaemon, request, state.daemonUrl, state.error, state.loading, stopDaemon],
  )
}
