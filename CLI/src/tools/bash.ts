import { exec as execCallback } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { z } from "zod"
import { BASH_TIMEOUT_MS, DANGEROUS_SHELL_PATTERNS, MAX_TOOL_OUTPUT_BYTES } from "../shared/constants"
import { Tool } from "./tool"

const execAsync = promisify(execCallback)

const LEVEL_3_MUTATING_PATTERNS: RegExp[] = [
  /\b(npm|pnpm|yarn|bun)\s+(install|add|remove|update|upgrade)\b/i,
  /\brm\b/i,
  /\bgit\s+push\b/i,
  /\b(mv|cp|mkdir|touch|chmod|chown)\b/i,
  /\b(curl|wget)\b/i,
]

const LEVEL_4_DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\b/i,
  /\bgit\s+push\b/i,
  /\b(terraform|pulumi)\s+(apply|destroy|up)\b/i,
  /\b(kubectl)\s+(apply|replace|delete|rollout)\b/i,
  /\b(helm)\s+(install|upgrade|rollback|uninstall)\b/i,
  /\b(docker\s+compose|docker-compose)\s+(up|down)\b/i,
]

function isApproved(answer: string): boolean {
  const value = answer.trim().toLowerCase()
  return value === "approve" || value === "approved" || value === "yes" || value === "y"
}

function shouldAskBeforeBash(level: number, command: string): boolean {
  if (level <= 2) return true
  if (level === 3) {
    return LEVEL_3_MUTATING_PATTERNS.some((pattern) => pattern.test(command))
  }
  if (level === 4) {
    return LEVEL_4_DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))
  }
  if (level >= 5) return false

  return false
}

function isDangerous(command: string): RegExp | undefined {
  return DANGEROUS_SHELL_PATTERNS.find((pattern) => pattern.test(command))
}

function normalizeOutput(stdout: string, stderr: string): string {
  const combined = [stdout, stderr].filter((value) => value.length > 0).join("\n")
  if (combined.length === 0) return "[no output]"

  const size = Buffer.byteLength(combined, "utf8")
  if (size <= MAX_TOOL_OUTPUT_BYTES) return combined

  const sliced = Buffer.from(combined, "utf8").subarray(0, MAX_TOOL_OUTPUT_BYTES)
  return `${sliced.toString("utf8")}\n\n[output truncated to ${MAX_TOOL_OUTPUT_BYTES} bytes]`
}

function createCommandSignal(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  if (!parent) {
    return AbortSignal.timeout(timeoutMs)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error(`timed out after ${timeoutMs}ms`))
  }, timeoutMs)

  const onParentAbort = () => {
    controller.abort(parent.reason ?? new Error("task aborted"))
  }

  if (parent.aborted) {
    onParentAbort()
  } else {
    parent.addEventListener("abort", onParentAbort, { once: true })
  }

  controller.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timeout)
      parent.removeEventListener("abort", onParentAbort)
    },
    { once: true },
  )

  return controller.signal
}

export const BashTool = Tool.define("bash", {
  description: "Execute a shell command with dependence-level safety checks.",
  parameters: z.object({
    command: z.string().min(1).describe("The shell command to execute"),
    cwd: z.string().optional().describe("Optional working directory for the command"),
  }),
  async execute(params, ctx) {
    if (ctx.abortSignal?.aborted) {
      throw new Error("Shell command cancelled because the task was aborted")
    }

    const dangerousPattern = isDangerous(params.command)
    if (dangerousPattern) {
      throw new Error(`Command blocked for safety by pattern '${dangerousPattern.source}'`)
    }

    if (shouldAskBeforeBash(ctx.dependenceLevel, params.command)) {
      const answer = await ctx.ask(
        `Approve shell command? ${params.command}`,
        ["approve", "reject"],
      )
      if (!isApproved(answer)) {
        throw new Error("Shell command rejected by user")
      }
    }

    const cwd = params.cwd ? path.resolve(process.cwd(), params.cwd) : process.cwd()
    ctx.log("tool", `bash: ${params.command}`)

    try {
      const signal = createCommandSignal(BASH_TIMEOUT_MS, ctx.abortSignal)
      const result = await execAsync(params.command, {
        cwd,
        signal,
        maxBuffer: MAX_TOOL_OUTPUT_BYTES,
        encoding: "utf8",
      })

      return {
        title: `bash: ${params.command}`,
        output: normalizeOutput(result.stdout, result.stderr),
        metadata: {
          exitCode: 0,
        },
      }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError"
      if (isAbort) {
        if (ctx.abortSignal?.aborted) {
          throw new Error("Shell command cancelled because the task was aborted")
        }
        throw new Error(`Shell command timed out after ${BASH_TIMEOUT_MS}ms`)
      }

      const execError = error as {
        code?: number | string | null
        stdout?: string
        stderr?: string
        message?: string
      }

      return {
        title: `bash: ${params.command}`,
        output: normalizeOutput(
          execError.stdout ?? "",
          execError.stderr ?? execError.message ?? "",
        ),
        metadata: {
          exitCode: typeof execError.code === "number" ? execError.code : 1,
        },
      }
    }
  },
})
