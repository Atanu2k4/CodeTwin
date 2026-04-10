import type { LanguageModel } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createAzure } from "@ai-sdk/azure"
import { createCohere } from "@ai-sdk/cohere"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createGroq } from "@ai-sdk/groq"
import { createMistral } from "@ai-sdk/mistral"
import { createOpenAI } from "@ai-sdk/openai"
import { createOllama } from "ollama-ai-provider"
import type { ProjectConfig } from "../shared/types"

function requireApiKey(config: ProjectConfig): string {
  if (!config.apiKey) {
    throw new Error(`apiKey is required for provider '${config.llmProvider}'`)
  }
  return config.apiKey
}

function requireBaseUrl(config: ProjectConfig): string {
  if (!config.baseUrl) {
    throw new Error(`baseUrl is required for provider '${config.llmProvider}'`)
  }
  return config.baseUrl
}

export function buildProvider(config: ProjectConfig): LanguageModel {
  const { llmProvider, model, baseUrl } = config

  switch (llmProvider) {
    case "openai":
      return createOpenAI({ apiKey: requireApiKey(config) })(model)

    case "anthropic":
      return createAnthropic({ apiKey: requireApiKey(config) })(model)

    case "groq":
      return createGroq({ apiKey: requireApiKey(config) })(model)

    case "google":
      return createGoogleGenerativeAI({ apiKey: requireApiKey(config) })(model)

    case "mistral":
      return createMistral({ apiKey: requireApiKey(config) })(model)

    case "cohere":
      return createCohere({ apiKey: requireApiKey(config) })(model)

    case "ollama":
      return createOllama({ baseURL: baseUrl ?? "http://localhost:11434/api" })(model) as unknown as LanguageModel

    case "azure":
      return createAzure({ apiKey: requireApiKey(config), baseURL: requireBaseUrl(config) })(model)

    case "openrouter":
      return createOpenAI({
        apiKey: requireApiKey(config),
        baseURL: baseUrl ?? "https://openrouter.ai/api/v1",
      })(model)

    case "openai-compatible":
      return createOpenAI({ apiKey: requireApiKey(config), baseURL: requireBaseUrl(config) })(model)

    default: {
      const exhaustive: never = llmProvider
      throw new Error(`Unknown provider: ${String(exhaustive)}`)
    }
  }
}
