import type { Argv } from "yargs"
import { randomBytes } from "crypto"
import { networkInterfaces } from "os"
import { cmd } from "./cmd"
import { Server } from "../../server/server"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { PairingCode } from "../../pairing/code"
import { UI } from "../ui"

function pickLanAddress() {
  const nets = networkInterfaces()

  for (const list of Object.values(nets)) {
    if (!list) continue
    for (const info of list) {
      if (info.internal || info.family !== "IPv4") continue
      if (info.address.startsWith("172.")) continue
      return info.address
    }
  }

  return undefined
}

function resolvePeerHostname(hostname: string, override?: string) {
  if (override) return override
  if (hostname === "0.0.0.0") return pickLanAddress() ?? "localhost"
  if (hostname === "127.0.0.1") return "localhost"
  return hostname
}

export const PairCommand = cmd({
  command: "pair",
  describe: "host pairing sessions",
  builder: (yargs: Argv) => yargs.command(PairHostCommand).demandCommand(),
  async handler() {},
})

export const PairHostCommand = cmd({
  command: "host",
  describe: "start a codetwin server and print a secure pairing code",
  builder: (yargs: Argv) =>
    withNetworkOptions(yargs)
      .option("password", {
        type: "string",
        describe: "password for basic auth (auto-generated if omitted)",
      })
      .option("username", {
        type: "string",
        describe: "basic auth username",
        default: "codetwin",
      })
      .option("public-host", {
        type: "string",
        describe: "host/IP peers should use to connect",
      })
      .option("ttl", {
        type: "number",
        describe: "pair code validity in seconds (0 disables expiry)",
        default: 3600,
      }),
  handler: async (args) => {
    const password = args.password ?? randomBytes(18).toString("base64url")
    const username = args.username ?? "codetwin"

    process.env.CODETWIN_SERVER_PASSWORD = password
    process.env.CODETWIN_SERVER_USERNAME = username

    const opts = await resolveNetworkOptions(args)
    const server = await Server.listen(opts)

    const url = new URL(server.url.toString())
    url.hostname = resolvePeerHostname(server.hostname, args.publicHost)

    const ttl = Math.max(0, Math.floor(args.ttl ?? 3600))
    const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : undefined

    const pairCode = PairingCode.encode({
      url: url.toString(),
      username,
      password,
      expiresAt,
    })

    UI.empty()
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Pairing host is ready" + UI.Style.TEXT_NORMAL)
    UI.println(UI.Style.TEXT_INFO_BOLD + "Attach URL: " + UI.Style.TEXT_NORMAL + url.toString())
    UI.println(UI.Style.TEXT_INFO_BOLD + "Pair code:  " + UI.Style.TEXT_NORMAL + pairCode)
    UI.println(UI.Style.TEXT_INFO_BOLD + "Join with:  " + UI.Style.TEXT_NORMAL + `codetwin attach --pair-code ${pairCode}`)
    if (expiresAt) {
      UI.println(
        UI.Style.TEXT_DIM + `Code expires at ${new Date(expiresAt).toISOString()} (UTC)` + UI.Style.TEXT_NORMAL,
      )
    } else {
      UI.println(UI.Style.TEXT_DIM + "Code does not expire automatically." + UI.Style.TEXT_NORMAL)
    }
    UI.empty()

    if (ttl > 0) {
      setTimeout(() => {
        UI.println(UI.Style.TEXT_WARNING_BOLD + "Pairing host expired. Shutting down." + UI.Style.TEXT_NORMAL)
        process.exit(0)
      }, ttl * 1000).unref()
    }

    await new Promise(() => {})
    await server.stop()
  },
})
