import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import process from "node:process"
import type { ServerType, serve } from "@hono/node-server"
import { DAEMON_HOST, DAEMON_PID_FILE, DAEMON_PORT_CANDIDATES, DAEMON_PORT_FILE } from "../shared/constants"
import { ConfigNotFoundError, loadConfig } from "../config"
import { RemoteBridge } from "./bridge"
import { createDaemonServer, handleBridgeMessage, setAllSessionsRemoteConnected, setBridgeSender } from "./server"

let server: ServerType | null = null
let bridge: RemoteBridge | null = null
let cleanupStarted = false
let pidFileOwned = false

function resolveRuntimePath(relativePath: string): string {
  return path.resolve(process.cwd(), relativePath)
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function ensureSingleDaemonInstance(): Promise<void> {
  const pidPath = resolveRuntimePath(DAEMON_PID_FILE)
  await mkdir(path.dirname(pidPath), { recursive: true })

  if (existsSync(pidPath)) {
    const raw = await readFile(pidPath, "utf8")
    const existingPid = Number.parseInt(raw.trim(), 10)
    if (Number.isFinite(existingPid) && processExists(existingPid)) {
      throw new Error(`CodeTwin daemon is already running with PID ${existingPid}`)
    }
  }

  await writeFile(pidPath, `${process.pid}\n`, "utf8")
  pidFileOwned = true
}

async function releasePidFile(): Promise<void> {
  if (!pidFileOwned) return
  const pidPath = resolveRuntimePath(DAEMON_PID_FILE)
  if (!existsSync(pidPath)) return
  await rm(pidPath, { force: true })
  pidFileOwned = false
}

async function writePortFile(port: number): Promise<void> {
  const portPath = resolveRuntimePath(DAEMON_PORT_FILE)
  await mkdir(path.dirname(portPath), { recursive: true })
  await writeFile(portPath, `${port}\n`, "utf8")
}

async function releasePortFile(): Promise<void> {
  const portPath = resolveRuntimePath(DAEMON_PORT_FILE)
  if (!existsSync(portPath)) return
  await rm(portPath, { force: true })
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once("error", () => {
      resolve(false)
    })
    probe.once("listening", () => {
      probe.close(() => resolve(true))
    })
    probe.listen(port, DAEMON_HOST)
  })
}

async function pickPort(): Promise<number> {
  for (const port of DAEMON_PORT_CANDIDATES) {
    const available = await isPortAvailable(port)
    if (available) return port
  }
  throw new Error("CodeTwin daemon ports 7878-7880 are all in use")
}

async function cleanupAndExit(code: number): Promise<void> {
  if (cleanupStarted) return
  cleanupStarted = true

  setBridgeSender(null)
  bridge?.disconnect()
  bridge = null

  try {
    if (server) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve())
      })
    }
  } catch {
    // Best effort shutdown.
  }

  try {
    await releasePidFile()
  } catch {
    // Ignore cleanup failures.
  }

  try {
    await releasePortFile()
  } catch {
    // Ignore cleanup failures.
  }

  process.exit(code)
}

async function bootstrap(): Promise<void> {
  await ensureSingleDaemonInstance()

  const port = await pickPort()
  const app = createDaemonServer()

  const nodeServerModule = await import("@hono/node-server")
  server = nodeServerModule.serve(
    {
      fetch: app.fetch,
      hostname: DAEMON_HOST,
      port,
    },
    () => {
      console.log(`CodeTwin daemon listening on http://${DAEMON_HOST}:${port}`)
    },
  )

  await writePortFile(port)

  let projectId = "default-project"
  try {
    const config = await loadConfig()
    projectId = config.projectId
  } catch (error) {
    if (!(error instanceof ConfigNotFoundError)) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`CodeTwin daemon: continuing without loaded config (${message})`)
    }
  }

  bridge = new RemoteBridge(projectId)
  setBridgeSender((message) => {
    bridge?.sendToMobile(message)
  })

  bridge.onMobileMessage((message) => {
    void handleBridgeMessage(message)
      .then((response) => {
        if (response) {
          bridge?.sendToMobile(response)
        }
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`CodeTwin bridge message handling failed: ${msg}`)
      })
  })

  bridge.onClientConnectionChanged((connected) => {
    setAllSessionsRemoteConnected(connected)
  })

  const signalingUrl = process.env.CODETWIN_SIGNALING_URL ?? "http://127.0.0.1:8787"
  bridge.connect(signalingUrl)
}

process.on("SIGINT", () => {
  void cleanupAndExit(0)
})

process.on("SIGTERM", () => {
  void cleanupAndExit(0)
})

void bootstrap().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  await cleanupAndExit(1)
})
