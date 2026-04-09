import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import type { ProjectConfig } from "../shared/types"
import { CONFIG_FILE } from "../shared/constants"
import { ProjectConfigSchema } from "./schema"

function resolveConfigPath(): string {
  return path.resolve(process.cwd(), CONFIG_FILE)
}

function maskSensitiveValue(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(maskSensitiveValue)
  }

  if (input && typeof input === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) {
      if (key.toLowerCase().includes("apikey") || key.toLowerCase().includes("token") || key.toLowerCase().includes("secret")) {
        result[key] = "****"
      } else {
        result[key] = maskSensitiveValue(value)
      }
    }
    return result
  }

  return input
}

function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const pathValue = issue.path.length > 0 ? issue.path.join(".") : "<root>"
      return `${pathValue}: ${issue.message}`
    })
    .join("\n")
}

function buildSchemaDiff(rawConfig: unknown, issues: z.ZodIssue[]): string {
  const masked = maskSensitiveValue(rawConfig)
  const maskedJson = JSON.stringify(masked, null, 2)
  return [`Schema validation failed`, `Issues:`, formatIssues(issues), `Masked config:`, maskedJson].join("\n")
}

export class ConfigNotFoundError extends Error {
  readonly configPath: string

  constructor(configPath: string) {
    super(`CodeTwin config not found at ${configPath}`)
    this.name = "ConfigNotFoundError"
    this.configPath = configPath
  }
}

export class ConfigInvalidError extends Error {
  readonly configPath: string
  readonly detail: string

  constructor(configPath: string, detail: string) {
    super(`CodeTwin config is invalid at ${configPath}`)
    this.name = "ConfigInvalidError"
    this.configPath = configPath
    this.detail = detail
  }
}

export function configExists(): boolean {
  return existsSync(resolveConfigPath())
}

export async function loadConfig(): Promise<ProjectConfig> {
  const configPath = resolveConfigPath()

  let rawContent = ""
  try {
    rawContent = await readFile(configPath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("ENOENT")) {
      throw new ConfigNotFoundError(configPath)
    }
    throw new ConfigInvalidError(configPath, `Unable to read config: ${message}`)
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawContent) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ConfigInvalidError(configPath, `Config JSON parse failed: ${message}`)
  }

  const parsed = ProjectConfigSchema.safeParse(parsedJson)
  if (!parsed.success) {
    const detail = buildSchemaDiff(parsedJson, parsed.error.issues)
    // Keep output safe for logs by masking secrets before printing.
    console.error(detail)
    throw new ConfigInvalidError(configPath, detail)
  }

  return parsed.data as ProjectConfig
}

export async function saveConfig(config: ProjectConfig): Promise<void> {
  const configPath = resolveConfigPath()
  const configDir = path.dirname(configPath)

  const parsed = ProjectConfigSchema.safeParse(config)
  if (!parsed.success) {
    const detail = buildSchemaDiff(config, parsed.error.issues)
    console.error(detail)
    throw new ConfigInvalidError(configPath, detail)
  }

  try {
    await mkdir(configDir, { recursive: true })
    await writeFile(configPath, `${JSON.stringify(parsed.data, null, 2)}\n`, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ConfigInvalidError(configPath, `Failed to write config: ${message}`)
  }
}
