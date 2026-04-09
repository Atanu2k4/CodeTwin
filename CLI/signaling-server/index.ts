import express from "express"
import { createServer } from "node:http"
import { Server, type Socket } from "socket.io"

type ClientType = "daemon" | "client"

interface RegisterPayload {
  deviceId: string
  type: ClientType
}

interface Pair {
  daemon?: Socket
  client?: Socket
}

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: "*" } })
const pairs = new Map<string, Pair>()

function getPair(deviceId: string): Pair {
  const existing = pairs.get(deviceId)
  if (existing) return existing
  const created: Pair = {}
  pairs.set(deviceId, created)
  return created
}

function peerOf(pair: Pair, type: ClientType): Socket | undefined {
  return type === "daemon" ? pair.client : pair.daemon
}

io.on("connection", (socket) => {
  let registered: RegisterPayload | undefined

  socket.on("register", (payload: RegisterPayload) => {
    if (!payload?.deviceId || (payload.type !== "daemon" && payload.type !== "client")) return

    const pair = getPair(payload.deviceId)
    const current = payload.type === "daemon" ? pair.daemon : pair.client
    if (current && current.id !== socket.id) {
      current.emit("message", { type: "DISPLACED" })
      current.disconnect(true)
    }

    if (payload.type === "daemon") pair.daemon = socket
    else pair.client = socket
    registered = payload

    if (payload.type === "client" && pair.daemon) {
      pair.daemon.emit("client_connected", { deviceId: payload.deviceId })
    }

    if (payload.type === "daemon" && pair.client) {
      socket.emit("client_connected", { deviceId: payload.deviceId })
    }

    if (pair.daemon && pair.client) {
      pair.daemon.emit("paired", { deviceId: payload.deviceId })
      pair.client.emit("paired", { deviceId: payload.deviceId })
    }
  })

  socket.on("ping", (payload: unknown) => {
    socket.emit("pong", payload)
  })

  socket.on("message", (message: unknown) => {
    if (!registered) return
    const pair = pairs.get(registered.deviceId)
    if (!pair) return

    const peer = peerOf(pair, registered.type)
    if (!peer) {
      socket.emit("no_pair")
      return
    }

    peer.emit("message", message)
  })

  socket.on("disconnect", () => {
    if (!registered) return

    const pair = pairs.get(registered.deviceId)
    if (!pair) return

    if (registered.type === "daemon") {
      if (pair.client) {
        pair.client.emit("message", {
          type: "DAEMON_OFFLINE",
          sessionId: "",
          projectId: "",
          deviceId: registered.deviceId,
          timestamp: new Date().toISOString(),
          payload: {},
        })
      }
      pair.daemon = undefined
    } else {
      pair.daemon?.emit("client_disconnected", { deviceId: registered.deviceId })
      pair.client = undefined
    }

    if (!pair.daemon && !pair.client) pairs.delete(registered.deviceId)
  })
})

const port = Number.parseInt(process.env.PORT ?? "8787", 10)
httpServer.listen(port, () => {
  console.log(`CodeTwin signaling server listening on :${port}`)
})
