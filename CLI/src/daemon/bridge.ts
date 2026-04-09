import { createHash } from "node:crypto"
import os from "node:os"
import process from "node:process"
import { io, type Socket } from "socket.io-client"
import { AgentMessageSchema } from "../shared/messages"
import type { AgentMessage } from "../shared/types"

function buildDeviceId(projectId: string): string {
  const source = `${os.hostname()}:${projectId}:${process.cwd()}`
  return createHash("sha256").update(source).digest("hex").slice(0, 12)
}

export class RemoteBridge {
  private socket?: Socket
  private readonly deviceId: string
  private mobileHandler?: (msg: AgentMessage) => void
  private clientConnectionHandler?: (connected: boolean) => void
  private pingInterval?: NodeJS.Timeout
  private pongTimeout?: NodeJS.Timeout

  constructor(projectId: string) {
    this.deviceId = buildDeviceId(projectId)
  }

  connect(signalingUrl: string): void {
    this.disconnect()

    this.socket = io(signalingUrl, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 60_000,
    })

    this.socket.on("connect", () => {
      this.socket?.emit("register", { deviceId: this.deviceId, type: "daemon" })
      this.startHeartbeat()
    })

    this.socket.on("paired", () => {
      this.clientConnectionHandler?.(true)
    })

    this.socket.on("message", (payload: unknown) => {
      const parsed = AgentMessageSchema.safeParse(payload)
      if (!parsed.success) {
        console.warn("RemoteBridge: invalid inbound message payload ignored")
        return
      }

      if (parsed.data.type === "PING") {
        const pong: AgentMessage = {
          ...parsed.data,
          type: "PONG",
          timestamp: new Date().toISOString(),
        }
        this.sendToMobile(pong)
        return
      }

      this.mobileHandler?.(parsed.data)
    })

    this.socket.on("client_connected", () => {
      console.log("RemoteBridge: mobile client connected")
      this.clientConnectionHandler?.(true)
    })

    this.socket.on("client_disconnected", () => {
      console.log("RemoteBridge: mobile client disconnected")
      this.clientConnectionHandler?.(false)
    })

    this.socket.on("pong", () => {
      if (this.pongTimeout) clearTimeout(this.pongTimeout)
      this.pongTimeout = undefined
    })

    this.socket.on("disconnect", () => {
      this.stopHeartbeat()
      this.clientConnectionHandler?.(false)
    })
  }

  disconnect(): void {
    this.stopHeartbeat()

    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = undefined
    }
  }

  onMobileMessage(handler: (msg: AgentMessage) => void): void {
    this.mobileHandler = handler
  }

  onClientConnectionChanged(handler: (connected: boolean) => void): void {
    this.clientConnectionHandler = handler
  }

  sendToMobile(msg: AgentMessage): void {
    if (!this.socket?.connected) return
    this.socket.emit("message", msg)
  }

  isConnected(): boolean {
    return Boolean(this.socket?.connected)
  }

  getDeviceId(): string {
    return this.deviceId
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()

    this.pingInterval = setInterval(() => {
      if (!this.socket?.connected) return

      this.socket.emit("ping", { deviceId: this.deviceId, timestamp: new Date().toISOString() })

      if (this.pongTimeout) clearTimeout(this.pongTimeout)
      this.pongTimeout = setTimeout(() => {
        if (!this.socket) return

        // Trigger reconnect when signaling heartbeat times out.
        this.socket.disconnect()
        this.socket.connect()
      }, 10_000)
    }, 25_000)
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) clearInterval(this.pingInterval)
    if (this.pongTimeout) clearTimeout(this.pongTimeout)
    this.pingInterval = undefined
    this.pongTimeout = undefined
  }
}
