import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { Tool } from "./tool"

const MAX_READ_BYTES = 50 * 1024
const DEFAULT_LIMIT = 2000

function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false

  let nonTextCount = 0
  for (const byte of buffer) {
    if (byte === 0) return true
    const isTabOrNewLine = byte === 9 || byte === 10 || byte === 13
    const isPrintableAscii = byte >= 32 && byte <= 126
    if (!isTabOrNewLine && !isPrintableAscii) {
      nonTextCount += 1
    }
  }

  return nonTextCount / buffer.length > 0.2
}

function truncateBytes(input: string, maxBytes: number): { content: string; truncated: boolean } {
  const size = Buffer.byteLength(input, "utf8")
  if (size <= maxBytes) {
    return { content: input, truncated: false }
  }

  const slice = Buffer.from(input, "utf8").subarray(0, maxBytes).toString("utf8")
  return {
    content: `${slice}\n\n[content truncated to ${maxBytes} bytes]`,
    truncated: true,
  }
}

export const ReadTool = Tool.define("read", {
  description: "Read a file or list a directory.",
  parameters: z.object({
    filePath: z.string().describe("The absolute or relative path to a file or directory"),
    offset: z.number().int().min(1).optional().describe("Line offset for file reads (1-indexed)"),
    limit: z.number().int().min(1).optional().describe("Maximum lines to read from files or entries from directories"),
  }),
  async execute(params, ctx) {
    const resolvedPath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.resolve(process.cwd(), params.filePath)

    const fileStat = await stat(resolvedPath)

    if (fileStat.isDirectory()) {
      const entries = await readdir(resolvedPath)
      entries.sort((a, b) => a.localeCompare(b))

      const offset = params.offset ?? 1
      const limit = params.limit ?? DEFAULT_LIMIT
      const startIndex = offset - 1
      const sliced = entries.slice(startIndex, startIndex + limit)
      const hasMore = startIndex + sliced.length < entries.length

      const output = [
        `<path>${resolvedPath}</path>`,
        `<type>directory</type>`,
        `<entries>`,
        ...sliced,
        hasMore
          ? `(showing ${sliced.length} of ${entries.length}; use offset=${offset + sliced.length} for more)`
          : `(${entries.length} entries total)`,
        `</entries>`,
      ].join("\n")

      return {
        title: path.basename(resolvedPath) || resolvedPath,
        output,
        metadata: {
          entryCount: entries.length,
          truncated: hasMore,
        },
      }
    }

    const buffer = await readFile(resolvedPath)
    if (isProbablyBinary(buffer)) {
      return {
        title: path.basename(resolvedPath),
        output: "[binary file — cannot display]",
      }
    }

    const content = buffer.toString("utf8")
    const lines = content.split(/\r?\n/)
    const offset = params.offset ?? 1
    const limit = params.limit ?? DEFAULT_LIMIT
    const startIndex = offset - 1
    const selected = lines.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + selected.length < lines.length

    const body = selected.map((line, index) => `${offset + index}: ${line}`).join("\n")
    const withMeta = [
      `<path>${resolvedPath}</path>`,
      `<type>file</type>`,
      `<content>`,
      body,
      hasMore
        ? `(showing lines ${offset}-${offset + selected.length - 1} of ${lines.length}; use offset=${offset + selected.length})`
        : `(end of file; ${lines.length} lines total)`,
      `</content>`,
    ].join("\n")

    const truncated = truncateBytes(withMeta, MAX_READ_BYTES)
    ctx.log("tool", `read: ${resolvedPath}`)

    return {
      title: path.basename(resolvedPath),
      output: truncated.content,
      metadata: {
        lineCount: lines.length,
        truncated: truncated.truncated || hasMore,
      },
    }
  },
})
