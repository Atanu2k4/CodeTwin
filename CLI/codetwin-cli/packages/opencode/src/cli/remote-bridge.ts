import path from "path"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"

export interface RemoteBridgeState {
  version: 1
  updatedAt: number
  pairingId: string
  cliDeviceId: string
  workerId: string
  workerToken: string
  tokenExpiresAt: number
  server: {
    apiBaseUrl: string
    wsUrl: string
  }
}

const STORE_FILE = path.join(Global.Path.config, "remote-bridge.json")

export function getRemoteBridgeStatePath() {
  return STORE_FILE
}

export async function readRemoteBridgeState(): Promise<RemoteBridgeState | undefined> {
  try {
    const parsed = await Filesystem.readJson<RemoteBridgeState>(STORE_FILE)
    if (!parsed || parsed.version !== 1) return undefined
    if (typeof parsed.workerToken !== "string" || !parsed.workerToken) return undefined
    if (typeof parsed.workerId !== "string" || !parsed.workerId) return undefined
    if (typeof parsed.pairingId !== "string" || !parsed.pairingId) return undefined
    if (typeof parsed.server?.apiBaseUrl !== "string" || !parsed.server.apiBaseUrl) return undefined
    if (typeof parsed.server?.wsUrl !== "string" || !parsed.server.wsUrl) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export async function writeRemoteBridgeState(next: RemoteBridgeState) {
  await Filesystem.writeJson(STORE_FILE, next, 0o600)
}

export function normalizeHttpUrl(input: string) {
  let value = input.trim()
  if (!value) throw new Error("server URL is required")
  if (!/^https?:\/\//.test(value)) {
    value = `https://${value}`
  }
  return value.replace(/\/+$/, "")
}

export function normalizeWsUrl(input: string) {
  let value = input.trim()
  if (!value) throw new Error("worker websocket URL is required")

  if (value.startsWith("http://")) value = "ws://" + value.slice("http://".length)
  if (value.startsWith("https://")) value = "wss://" + value.slice("https://".length)
  if (!value.startsWith("ws://") && !value.startsWith("wss://")) {
    value = "ws://" + value
  }

  if (!value.endsWith("/ws")) {
    value = value.replace(/\/+$/, "") + "/ws"
  }

  return value
}
