import { z } from "zod"
import { MAX_TOOL_OUTPUT_BYTES } from "../shared/constants"
import type { ToolContext } from "../shared/types"

function throwIfAborted(ctx: ToolContext): void {
  if (ctx.abortSignal?.aborted) {
    throw new Error("Task cancelled before tool execution")
  }
}

export interface ToolResult {
  title: string
  output: string
  metadata?: Record<string, unknown>
}

export interface ToolDefinition<Parameters extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string
  description: string
  parameters: Parameters
  execute: (args: z.infer<Parameters>, ctx: ToolContext) => Promise<ToolResult>
  formatValidationError?: (error: z.ZodError) => string
}

function truncateOutput(text: string): { content: string; truncated: boolean } {
  const size = Buffer.byteLength(text, "utf8")
  if (size <= MAX_TOOL_OUTPUT_BYTES) {
    return { content: text, truncated: false }
  }

  const fullBuffer = Buffer.from(text, "utf8")
  const sliced = fullBuffer.subarray(0, MAX_TOOL_OUTPUT_BYTES)
  return {
    content: `${sliced.toString("utf8")}\n\n[output truncated to ${MAX_TOOL_OUTPUT_BYTES} bytes]`,
    truncated: true,
  }
}

export namespace Tool {
  export function define<Parameters extends z.ZodTypeAny>(
    id: string,
    definition: Omit<ToolDefinition<Parameters>, "id" | "execute"> & {
      execute: (args: z.infer<Parameters>, ctx: ToolContext) => Promise<ToolResult>
    },
  ): ToolDefinition<Parameters> {
    const execute = definition.execute

    return {
      id,
      description: definition.description,
      parameters: definition.parameters,
      formatValidationError: definition.formatValidationError,
      async execute(args, ctx) {
        throwIfAborted(ctx)

        const parsed = definition.parameters.safeParse(args)
        if (!parsed.success) {
          if (definition.formatValidationError) {
            throw new Error(definition.formatValidationError(parsed.error), { cause: parsed.error })
          }
          throw new Error(
            `The ${id} tool was called with invalid arguments. Please retry with valid parameters.`,
            { cause: parsed.error },
          )
        }

        const result = await execute(parsed.data, ctx)
        throwIfAborted(ctx)

        const truncated = truncateOutput(result.output)

        return {
          ...result,
          output: truncated.content,
          metadata: {
            ...(result.metadata ?? {}),
            truncated: truncated.truncated,
          },
        }
      },
    }
  }
}
