import { readFile, writeFile } from "node:fs/promises"
import { statSync } from "node:fs"
import path from "node:path"
import { createTwoFilesPatch } from "diff"
import { z } from "zod"
import { Tool } from "./tool"
import type { PreflightMap } from "../shared/types"

function isApproved(answer: string): boolean {
  const value = answer.trim().toLowerCase()
  return value === "approve" || value === "yes" || value === "y"
}

function buildDiff(filePath: string, oldContent: string, newContent: string): string {
  return createTwoFilesPatch(filePath, filePath, oldContent, newContent).trim()
}

function toPreflightMap(task: string, filePath: string, diff: string): PreflightMap {
  return {
    taskDescription: task,
    filesToRead: [filePath],
    filesToWrite: [filePath],
    filesToDelete: [],
    shellCommandsToRun: [],
    estimatedBlastRadius: "low",
    affectedFunctions: [],
    affectedModules: [filePath],
    reasoning: `Applying exact string replacement. Diff:\n${diff}`,
  }
}

export const EditTool = Tool.define("edit", {
  description: "Modify an existing file by exact string replacement.",
  parameters: z.object({
    filePath: z.string().describe("Absolute or relative path to an existing file"),
    oldString: z.string().describe("Exact text to replace"),
    newString: z.string().describe("Replacement text"),
    replaceAll: z.boolean().optional().describe("Replace all exact occurrences"),
  }),
  async execute(params, ctx) {
    const resolvedPath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.resolve(process.cwd(), params.filePath)

    const fileStat = statSync(resolvedPath, { throwIfNoEntry: false })
    if (!fileStat) {
      throw new Error(`File not found: ${resolvedPath}`)
    }
    if (fileStat.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${resolvedPath}`)
    }

    const oldContent = await readFile(resolvedPath, "utf8")
    if (!oldContent.includes(params.oldString)) {
      throw new Error(`Exact search string not found in ${resolvedPath}`)
    }

    const newContent = params.replaceAll
      ? oldContent.split(params.oldString).join(params.newString)
      : oldContent.replace(params.oldString, params.newString)

    const diff = buildDiff(resolvedPath, oldContent, newContent)

    if (ctx.dependenceLevel <= 3) {
      const approved = await ctx.preflight(
        toPreflightMap(`edit file ${resolvedPath}`, resolvedPath, diff),
      )
      if (!approved) {
        throw new Error("Edit cancelled by preflight rejection")
      }
    }

    if (ctx.dependenceLevel === 1) {
      const answer = await ctx.ask(
        `Approve replacement in ${resolvedPath}?`,
        ["approve", "reject"],
      )
      if (!isApproved(answer)) {
        throw new Error("Edit cancelled by user")
      }
    }

    await writeFile(resolvedPath, newContent, "utf8")
    ctx.log("tool", `edit: ${resolvedPath}`)

    return {
      title: path.basename(resolvedPath),
      output: `Edit applied successfully.\n\n${diff}`,
      metadata: {
        diff,
      },
    }
  },
})
