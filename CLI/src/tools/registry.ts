import type { ToolDefinition } from "./tool"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GitTool } from "./git"
import { ReadTool } from "./read"
import { WriteTool } from "./write"

const BUILTIN_TOOLS: ToolDefinition[] = [ReadTool, BashTool, WriteTool, EditTool, GitTool]

export function listTools(): ToolDefinition[] {
  return [...BUILTIN_TOOLS]
}

export function getToolById(id: string): ToolDefinition | undefined {
  return BUILTIN_TOOLS.find((tool) => tool.id === id)
}
