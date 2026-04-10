import { z } from "zod"

export const LLMProviderSchema = z.enum([
  "openai",
  "anthropic",
  "groq",
  "google",
  "mistral",
  "cohere",
  "ollama",
  "azure",
  "openrouter",
  "openai-compatible",
])

export const DependenceLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
])

export const ConnectorConfigSchema = z.object({
  type: z.enum(["github", "slack", "jira"]),
  config: z.record(z.string(), z.string()),
  enabled: z.boolean(),
})

export const ProjectConfigSchema = z
  .object({
    projectId: z.string(),
    name: z.string(),
    rootDir: z.string(),
    stack: z.array(z.string()),
    activeSessionId: z.string().optional(),
    dependenceLevel: DependenceLevelSchema,
    llmProvider: LLMProviderSchema,
    model: z.string(),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    connectors: z.array(ConnectorConfigSchema),
    createdAt: z.string(),
  })
  .superRefine((config, ctx) => {
    const needsBaseUrl =
      config.llmProvider === "ollama" ||
      config.llmProvider === "azure" ||
      config.llmProvider === "openai-compatible"

    if (needsBaseUrl && !config.baseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseUrl"],
        message: `baseUrl is required for provider '${config.llmProvider}'`,
      })
    }

    if (config.llmProvider !== "ollama" && !config.apiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiKey"],
        message: `apiKey is required for provider '${config.llmProvider}'`,
      })
    }
  })

export type ProjectConfigInput = z.infer<typeof ProjectConfigSchema>
