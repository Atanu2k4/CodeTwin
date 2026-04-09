import { mkdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { Tool } from "./tool"
import type { PreflightMap } from "../shared/types"

function toPreflightMap(task: string, filePath: string): PreflightMap {
  return {
    taskDescription: task,
    filesToRead: [],
    filesToWrite: [filePath],
    filesToDelete: [],
    shellCommandsToRun: [],
    estimatedBlastRadius: "low",
    affectedFunctions: [],
    affectedModules: [filePath],
    reasoning: "Creating a new file with write tool",
  }
}

export const WriteTool = Tool.define("write", {
  description: "Write a new file. Fails if the file already exists.",
  parameters: z.object({
    filePath: z.string().describe("Absolute or relative path to the new file"),
    content: z.string().describe("Content to write"),
  }),
  async execute(params, ctx) {
    const resolvedPath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.resolve(process.cwd(), params.filePath)

    if (existsSync(resolvedPath)) {
      throw new Error(`File already exists: ${resolvedPath}. Use the edit tool instead.`)
    }

    if (ctx.dependenceLevel <= 4) {
      const approved = await ctx.preflight(toPreflightMap(`create file ${resolvedPath}`, resolvedPath))
      if (!approved) {
        throw new Error("Write cancelled by preflight rejection")
      }
    }

    const parentDir = path.dirname(resolvedPath)
    const parentExists = existsSync(parentDir)
    await mkdir(parentDir, { recursive: true })
    if (!parentExists) {
      ctx.log("tool", `Created parent directory: ${parentDir}`)
    }

    await writeFile(resolvedPath, params.content, "utf8")
    ctx.log("tool", `write: ${resolvedPath}`)

    return {
      title: path.basename(resolvedPath),
      output: `File created successfully: ${resolvedPath}`,
    }
  },
})
