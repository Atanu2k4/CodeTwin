import { exec as execCallback } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { z } from "zod"
import { BASH_TIMEOUT_MS } from "../shared/constants"
import type { PreflightMap } from "../shared/types"
import { Tool } from "./tool"

const execAsync = promisify(execCallback)

function isApproved(answer: string): boolean {
  const value = answer.trim().toLowerCase()
  return value === "approve" || value === "approved" || value === "yes" || value === "y"
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync("git rev-parse --is-inside-work-tree", {
      cwd,
      timeout: BASH_TIMEOUT_MS,
      encoding: "utf8",
    })
    return stdout.trim() === "true"
  } catch {
    return false
  }
}

async function gitStatusFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync("git status --porcelain", {
      cwd,
      timeout: BASH_TIMEOUT_MS,
      encoding: "utf8",
    })

    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.slice(2).trim())
      .filter((line) => line.length > 0)
  } catch {
    return []
  }
}

function buildCommand(operation: string, args: string[]): string {
  switch (operation) {
    case "commit":
      return `git commit ${args.join(" ")}`.trim()
    case "push":
      return `git push ${args.join(" ")}`.trim()
    case "branch":
      return `git branch ${args.join(" ")}`.trim()
    case "status":
      return "git status"
    case "diff":
      return `git diff ${args.join(" ")}`.trim()
    case "log":
      return `git log ${args.join(" ")}`.trim() || "git log --oneline -n 20"
    case "stash":
      return `git stash ${args.join(" ")}`.trim()
    default:
      return "git status"
  }
}

function preflightForGit(task: string, command: string, unstaged: string[]): PreflightMap {
  return {
    taskDescription: task,
    filesToRead: unstaged,
    filesToWrite: [],
    filesToDelete: [],
    shellCommandsToRun: [command],
    estimatedBlastRadius: unstaged.length > 5 ? "high" : unstaged.length > 2 ? "medium" : "low",
    affectedFunctions: [],
    affectedModules: unstaged,
    reasoning: "Executing git operation via git tool",
  }
}

export const GitTool = Tool.define("git", {
  description: "Run git operations with dependence-level safety gates.",
  parameters: z.object({
    operation: z.enum(["commit", "push", "branch", "status", "diff", "log", "stash"]),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
  }),
  async execute(params, ctx) {
    const cwd = params.cwd ? path.resolve(process.cwd(), params.cwd) : process.cwd()

    if (!(await isGitRepo(cwd))) {
      return {
        title: "git",
        output: "Git repository not initialized in this directory.",
      }
    }

    const args = params.args ?? []
    const command = buildCommand(params.operation, args)

    if (params.operation === "push") {
      if (ctx.dependenceLevel <= 4) {
        const answer = await ctx.ask("Approve git push?", ["approve", "reject"])
        if (!isApproved(answer)) {
          throw new Error("git push cancelled by user")
        }
      } else {
        const budget = ctx.delegationBudget
        if (!budget || budget.currentInterruptions >= budget.maxInterruptions) {
          throw new Error("git push blocked: delegation budget exhausted")
        }
        const answer = await ctx.ask("Approve git push under level 5?", ["approve", "reject"])
        if (!isApproved(answer)) {
          throw new Error("git push cancelled by user")
        }
        budget.currentInterruptions += 1
      }
    }

    if (params.operation === "commit" && ctx.dependenceLevel <= 4) {
      const unstaged = await gitStatusFiles(cwd)
      const approved = await ctx.preflight(
        preflightForGit("git commit", command, unstaged),
      )
      if (!approved) {
        throw new Error("git commit cancelled by preflight rejection")
      }
    }

    ctx.log("tool", `git: ${command}`)

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: BASH_TIMEOUT_MS,
        encoding: "utf8",
      })
      const output = [stdout, stderr].filter((item) => item.length > 0).join("\n") || "[no output]"

      return {
        title: `git ${params.operation}`,
        output,
      }
    } catch (error) {
      const execError = error as {
        stdout?: string
        stderr?: string
        message?: string
      }

      const output = [execError.stdout ?? "", execError.stderr ?? "", execError.message ?? ""]
        .filter((item) => item.length > 0)
        .join("\n")

      return {
        title: `git ${params.operation}`,
        output: output || "Git command failed",
      }
    }
  },
})
