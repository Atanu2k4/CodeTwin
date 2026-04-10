import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import readline from "node:readline/promises"
import path from "node:path"
import process from "node:process"
import { Command } from "commander"
import { render } from "ink"
import { configExists, loadConfig, saveConfig } from "../config"
import type { ProjectConfig } from "../shared/types"
import { DAEMON_PORT_FILE } from "../shared/constants"
import { App } from "./App"
import { resolveDaemonRunner } from "./daemonRunner"

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function spawnDaemon(): void {
  const runner = resolveDaemonRunner("src/daemon/index.ts")
  const child = spawn(runner.command, runner.args, {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  })
  child.unref()
}

async function readDaemonPort(): Promise<number | null> {
  const file = path.resolve(process.cwd(), DAEMON_PORT_FILE)
  try {
    const raw = await readFile(file, "utf8")
    const parsed = Number.parseInt(raw.trim(), 10)
    if (!Number.isFinite(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

async function pingHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`)
    return response.ok
  } catch {
    return false
  }
}

async function ensureDaemonBaseUrl(): Promise<string> {
  const existingPort = await readDaemonPort()
  if (existingPort) {
    const existingUrl = `http://127.0.0.1:${existingPort}`
    if (await pingHealth(existingUrl)) return existingUrl
  }

  spawnDaemon()

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const port = await readDaemonPort()
    if (port) {
      const nextUrl = `http://127.0.0.1:${port}`
      if (await pingHealth(nextUrl)) return nextUrl
    }
    await delay(200)
  }

  throw new Error("Starting CodeTwin daemon timed out")
}

async function apiRequest<TResponse>(baseUrl: string, pathValue: string, init?: RequestInit): Promise<TResponse> {
  const response = await fetch(`${baseUrl}${pathValue}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  })

  const json = (await response.json()) as TResponse | { error?: string }
  if (!response.ok) {
    const message = typeof json === "object" && json && "error" in json ? json.error : undefined
    throw new Error(message ?? `Request failed with status ${response.status}`)
  }

  return json as TResponse
}

async function runInitWizard(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    console.log("Welcome to CodeTwin.")
    const name = (await rl.question("Project name: ")).trim() || path.basename(process.cwd())
    const stackRaw = await rl.question("Stack (comma separated, e.g. Next.js, TypeScript, MongoDB): ")
    const dependenceRaw = await rl.question("Dependence level (1-5, default 3): ")
    const provider =
      (await rl.question(
        "LLM provider (openai/anthropic/groq/google/mistral/cohere/ollama/azure/openrouter/openai-compatible): ",
      ))
        .trim() || "openai"
    const model = (await rl.question("Model name (e.g. gpt-4o, claude-opus-4-5): ")).trim() || "gpt-4o"

    const needsApiKey = provider !== "ollama"
    const needsBaseUrl = provider === "ollama" || provider === "azure" || provider === "openai-compatible"

    const apiKey = needsApiKey ? (await rl.question("API key: ")).trim() : undefined
    const baseUrl = needsBaseUrl ? (await rl.question("Base URL: ")).trim() : undefined

    const config: ProjectConfig = {
      projectId: randomUUID(),
      name,
      rootDir: process.cwd(),
      stack: stackRaw
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
      dependenceLevel:
        [1, 2, 3, 4, 5].includes(Number.parseInt(dependenceRaw, 10))
          ? (Number.parseInt(dependenceRaw, 10) as 1 | 2 | 3 | 4 | 5)
          : 3,
      llmProvider: provider as ProjectConfig["llmProvider"],
      model,
      apiKey: apiKey && apiKey.length > 0 ? apiKey : undefined,
      baseUrl: baseUrl && baseUrl.length > 0 ? baseUrl : undefined,
      connectors: [],
      createdAt: new Date().toISOString(),
    }

    console.log("Add .CodeTwin/config.json to your .gitignore to protect your API key.")
    console.log("Creating .CodeTwin/config.json...")
    await saveConfig(config)
    console.log("Initializing twin memory...")

    const daemonUrl = await ensureDaemonBaseUrl()
    await apiRequest(daemonUrl, "/config/init", {
      method: "POST",
      body: JSON.stringify(config),
    })

    console.log("Done.")
  } finally {
    rl.close()
  }
}

async function ensureConfigReady(): Promise<void> {
  if (configExists()) return
  await runInitWizard()
}

async function startInteractive(): Promise<void> {
  await ensureConfigReady()
  render(<App />)
}

async function runTask(
  taskParts: string[],
  options?: {
    sessionId?: string
    continueLast?: boolean
    fork?: boolean
  },
): Promise<void> {
  await ensureConfigReady()
  const task = taskParts.join(" ").trim()
  if (!task) throw new Error("Task text is required")

  const daemonUrl = await ensureDaemonBaseUrl()
  const session = await apiRequest<{ sessionId: string; resumed?: boolean }>(daemonUrl, "/session/new", {
    method: "POST",
    body: JSON.stringify({
      sessionId: options?.sessionId,
      continueLast: options?.sessionId ? false : options?.continueLast ?? true,
      fork: options?.fork ?? false,
    }),
  })

  await apiRequest(daemonUrl, `/session/${session.sessionId}/task`, {
    method: "POST",
    body: JSON.stringify({ task }),
  })

  console.log(`Task submitted to session ${session.sessionId}${session.resumed ? " (resumed)" : ""}`)
}

async function showStatus(): Promise<void> {
  const daemonUrl = await ensureDaemonBaseUrl()
  const status = await apiRequest<{ sessions: unknown[] }>(daemonUrl, "/sessions")
  console.log(JSON.stringify(status, null, 2))
}

async function showLogs(): Promise<void> {
  const daemonUrl = await ensureDaemonBaseUrl()
  const status = await apiRequest<{ sessions: Array<{ id: string; status: string; currentTask?: string }> }>(
    daemonUrl,
    "/sessions",
  )

  if (status.sessions.length === 0) {
    console.log("No active sessions.")
    return
  }

  for (const session of status.sessions) {
    console.log(`${session.id} | ${session.status}${session.currentTask ? ` | ${session.currentTask}` : ""}`)
  }
  console.log("Use interactive mode (`CodeTwin start`) to stream live AGENT_LOG events.")
}

async function setLevel(levelRaw: string): Promise<void> {
  const level = Number.parseInt(levelRaw, 10)
  if (![1, 2, 3, 4, 5].includes(level)) {
    throw new Error("Level must be between 1 and 5")
  }

  const daemonUrl = await ensureDaemonBaseUrl()
  const sessions = await apiRequest<{
    sessions: Array<{
      id: string
      status: string
      runtimeActive?: boolean
    }>
  }>(daemonUrl, "/sessions")
  const first =
    sessions.sessions.find((session) => session.runtimeActive || session.status === "running" || session.status === "awaiting_approval") ??
    sessions.sessions[0]
  if (!first) {
    throw new Error("No active session found")
  }

  await apiRequest(daemonUrl, `/session/${first.id}/level`, {
    method: "POST",
    body: JSON.stringify({ newLevel: level }),
  })
  console.log(`Dependence level updated to ${level}`)
}

async function showConnect(): Promise<void> {
  const daemonUrl = await ensureDaemonBaseUrl()
  const payload = await apiRequest<{ deviceId: string; qrData: string }>(daemonUrl, "/connect")
  console.log(`deviceId: ${payload.deviceId}`)
  console.log(`qrData: ${payload.qrData}`)
}

async function resolveProjectId(daemonUrl: string): Promise<string> {
  try {
    const config = await loadConfig()
    return config.projectId
  } catch {
    const sessions = await apiRequest<{ sessions: Array<{ projectId: string }> }>(daemonUrl, "/sessions")
    return sessions.sessions[0]?.projectId ?? "default-project"
  }
}

async function showHistory(query?: string): Promise<void> {
  const daemonUrl = await ensureDaemonBaseUrl()
  const projectId = await resolveProjectId(daemonUrl)
  const profile = await apiRequest<{
    decisions: Array<{
      id: string
      timestamp: string
      description: string
      choice: string
      reasoning: string
    }>
  }>(daemonUrl, `/twin/${projectId}`)

  let decisions = profile.decisions
  if (query && query.trim().length > 0) {
    const q = query.toLowerCase()
    decisions = decisions.filter(
      (decision) =>
        decision.description.toLowerCase().includes(q) ||
        decision.choice.toLowerCase().includes(q) ||
        decision.reasoning.toLowerCase().includes(q),
    )
  }

  if (decisions.length === 0) {
    console.log("No decisions found.")
    return
  }

  for (const decision of decisions) {
    console.log(`[${decision.timestamp}] ${decision.choice} - ${decision.description}`)
    console.log(`  Reasoning: ${decision.reasoning}`)
  }
}

async function listConstraintsCommand(): Promise<void> {
  const daemonUrl = await ensureDaemonBaseUrl()
  const projectId = await resolveProjectId(daemonUrl)
  const profile = await apiRequest<{
    constraints: Array<{ id: string; category: string; description: string; expiresAt?: string }>
  }>(daemonUrl, `/twin/${projectId}`)

  if (profile.constraints.length === 0) {
    console.log("No active constraints.")
    return
  }

  for (const constraint of profile.constraints) {
    console.log(`${constraint.id} | ${constraint.category} | ${constraint.description}`)
    if (constraint.expiresAt) {
      console.log(`  expiresAt: ${constraint.expiresAt}`)
    }
  }
}

async function addConstraintCommand(input: {
  description: string
  category: "library" | "api" | "pattern" | "technology" | "client-requirement"
  expiresAt?: string
}): Promise<void> {
  const daemonUrl = await ensureDaemonBaseUrl()
  const projectId = await resolveProjectId(daemonUrl)
  const created = await apiRequest<{ id: string }>(daemonUrl, `/twin/${projectId}/constraint`, {
    method: "POST",
    body: JSON.stringify({
      description: input.description,
      category: input.category,
      expiresAt: input.expiresAt,
    }),
  })

  console.log(`Added constraint ${created.id}`)
}

async function removeConstraintCommand(id: string): Promise<void> {
  const daemonUrl = await ensureDaemonBaseUrl()
  const projectId = await resolveProjectId(daemonUrl)
  await apiRequest(daemonUrl, `/twin/${projectId}/constraint/${id}`, {
    method: "DELETE",
  })
  console.log(`Removed constraint ${id}`)
}

async function listSessionsCommand(): Promise<void> {
  const daemonUrl = await ensureDaemonBaseUrl()
  const payload = await apiRequest<{
    sessions: Array<{
      id: string
      projectId: string
      title: string
      parentId?: string
      status: string
      currentTask?: string
      updatedAt: string
      runtimeActive: boolean
    }>
  }>(daemonUrl, "/sessions")

  if (payload.sessions.length === 0) {
    console.log("No sessions found.")
    return
  }

  for (const session of payload.sessions) {
    const details = [
      session.projectId,
      session.status,
      session.runtimeActive ? "runtime:active" : "runtime:idle",
      `updated:${session.updatedAt}`,
    ]
    if (session.parentId) {
      details.push(`parent:${session.parentId}`)
    }

    console.log(`${session.id} | ${session.title}`)
    console.log(`  ${details.join(" | ")}`)
    if (session.currentTask) {
      console.log(`  task: ${session.currentTask}`)
    }
  }
}

async function deleteSessionCommand(sessionId: string): Promise<void> {
  const daemonUrl = await ensureDaemonBaseUrl()
  await apiRequest(daemonUrl, `/session/${sessionId}`, {
    method: "DELETE",
  })
  console.log(`Deleted session ${sessionId}`)
}

async function useSessionCommand(sessionId: string): Promise<void> {
  await ensureConfigReady()
  const daemonUrl = await ensureDaemonBaseUrl()

  const sessions = await apiRequest<{ sessions: Array<{ id: string }> }>(daemonUrl, "/sessions")
  if (!sessions.sessions.some((session) => session.id === sessionId)) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  await apiRequest(daemonUrl, "/config", {
    method: "PUT",
    body: JSON.stringify({ activeSessionId: sessionId }),
  })

  console.log(`Selected active session ${sessionId}`)
}

async function listProjectsCommand(): Promise<void> {
  const daemonUrl = await ensureDaemonBaseUrl()
  const payload = await apiRequest<{
    projects: Array<{
      projectId: string
      name: string
      rootDir: string
      stack: string[]
      createdAt: string
    }>
  }>(daemonUrl, "/projects")

  if (payload.projects.length === 0) {
    console.log("No projects found.")
    return
  }

  for (const project of payload.projects) {
    console.log(`${project.projectId} | ${project.name}`)
    console.log(`  root: ${project.rootDir}`)
    console.log(`  stack: ${project.stack.join(", ") || "(none)"}`)
    console.log(`  created: ${project.createdAt}`)
  }
}

async function createProjectCommand(input: {
  name: string
  rootDir?: string
  stack?: string
  select?: boolean
}): Promise<void> {
  const daemonUrl = await ensureDaemonBaseUrl()
  const stack = input.stack
    ? input.stack
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : undefined

  const payload = await apiRequest<{
    created: boolean
    selected: boolean
    project: {
      projectId: string
      name: string
      rootDir: string
      stack: string[]
    }
  }>(daemonUrl, "/projects/create", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      rootDir: input.rootDir,
      stack,
      select: input.select,
    }),
  })

  console.log(`Created project ${payload.project.projectId} (${payload.project.name})`)
  if (payload.selected) {
    console.log("Project selected in config.")
  }
}

async function selectProjectCommand(projectId: string): Promise<void> {
  const daemonUrl = await ensureDaemonBaseUrl()
  const payload = await apiRequest<{
    selected: boolean
    project: {
      projectId: string
      name: string
      rootDir: string
      stack: string[]
    }
  }>(daemonUrl, "/projects/select", {
    method: "POST",
    body: JSON.stringify({ projectId }),
  })

  console.log(`Selected project ${payload.project.projectId} (${payload.project.name})`)
}

function listProviders(): void {
  const providers = [
    { id: "openai", requiresApiKey: true, requiresBaseUrl: false },
    { id: "anthropic", requiresApiKey: true, requiresBaseUrl: false },
    { id: "groq", requiresApiKey: true, requiresBaseUrl: false },
    { id: "google", requiresApiKey: true, requiresBaseUrl: false },
    { id: "mistral", requiresApiKey: true, requiresBaseUrl: false },
    { id: "cohere", requiresApiKey: true, requiresBaseUrl: false },
    { id: "ollama", requiresApiKey: false, requiresBaseUrl: true },
    { id: "azure", requiresApiKey: true, requiresBaseUrl: true },
    { id: "openrouter", requiresApiKey: true, requiresBaseUrl: false },
    { id: "openai-compatible", requiresApiKey: true, requiresBaseUrl: true },
  ]

  for (const provider of providers) {
    console.log(
      `${provider.id} | apiKey:${provider.requiresApiKey ? "required" : "optional"} | baseUrl:${provider.requiresBaseUrl ? "required" : "optional"}`,
    )
  }
}

async function main(): Promise<void> {
  const program = new Command()
  program.name("CodeTwin")

  program.command("start").description("boot daemon and open TUI").action(async () => {
    await startInteractive()
  })

  program
    .command("task")
    .description("submit task non-interactively")
    .option("-c, --continue", "continue the latest session", true)
    .option("-s, --session <id>", "continue a specific session id")
    .option("--fork", "fork from the selected/continued session")
    .option("--new", "always create a fresh session")
    .argument("<task...>")
    .action(
      async (
        taskParts: string[],
        options: {
          continue?: boolean
          session?: string
          fork?: boolean
          new?: boolean
        },
      ) => {
        await runTask(taskParts, {
          sessionId: options.session,
          continueLast: options.new ? false : options.continue ?? true,
          fork: options.fork,
        })
      },
    )

  const sessionCommand = program.command("session").description("list, select, and delete sessions")

  sessionCommand.command("list").description("list stored sessions").action(async () => {
    await listSessionsCommand()
  })

  sessionCommand
    .command("use")
    .description("select active session id in config")
    .argument("<sessionId>")
    .action(async (sessionId: string) => {
      await useSessionCommand(sessionId)
    })

  sessionCommand
    .command("delete")
    .description("delete a session and its persisted message history")
    .argument("<sessionId>")
    .action(async (sessionId: string) => {
      await deleteSessionCommand(sessionId)
    })

  const projectCommand = program.command("project").description("create, list, and select projects")

  projectCommand.command("list").description("list known projects").action(async () => {
    await listProjectsCommand()
  })

  projectCommand
    .command("create")
    .description("create a new project entry")
    .argument("<name>")
    .option("-r, --root-dir <path>", "root directory")
    .option("-s, --stack <list>", "comma-separated stack values")
    .option("--select", "select this project in config after creation")
    .action(
      async (
        name: string,
        options: {
          rootDir?: string
          stack?: string
          select?: boolean
        },
      ) => {
        await createProjectCommand({
          name,
          rootDir: options.rootDir,
          stack: options.stack,
          select: options.select,
        })
      },
    )

  projectCommand
    .command("select")
    .description("select project in config")
    .argument("<projectId>")
    .action(async (projectId: string) => {
      await selectProjectCommand(projectId)
    })

  program.command("status").description("show running tasks").action(async () => {
    await showStatus()
  })

  program.command("log").description("show session log summary").action(async () => {
    await showLogs()
  })

  program
    .command("level")
    .description("set dependence level immediately")
    .argument("<level>")
    .action(async (levelRaw: string) => {
      await setLevel(levelRaw)
    })

  const configCmd = program.command("config").description("configuration commands")
  configCmd.command("init").description("re-run init wizard").action(async () => {
    await runInitWizard()
  })

  program.command("connect").description("show deviceId and QR payload").action(async () => {
    await showConnect()
  })

  program
    .command("history")
    .description("decision history for this project")
    .option("-q, --query <query>", "filter decisions by keyword")
    .action(async (options: { query?: string }) => {
      await showHistory(options.query)
    })

  const constraintsCommand = program.command("constraints").description("list/add/remove constraints")

  constraintsCommand.command("list").description("list active constraints").action(async () => {
    await listConstraintsCommand()
  })

  constraintsCommand
    .command("add")
    .description("add an active constraint")
    .argument("<description>")
    .option(
      "-c, --category <category>",
      "constraint category",
      "client-requirement",
    )
    .option("-e, --expires-at <iso>", "optional ISO expiry timestamp")
    .action(
      async (
        description: string,
        options: {
          category?: "library" | "api" | "pattern" | "technology" | "client-requirement"
          expiresAt?: string
        },
      ) => {
        const category =
          options.category &&
          ["library", "api", "pattern", "technology", "client-requirement"].includes(options.category)
            ? options.category
            : "client-requirement"

        await addConstraintCommand({
          description,
          category,
          expiresAt: options.expiresAt,
        })
      },
    )

  constraintsCommand
    .command("remove")
    .description("remove a constraint by id")
    .argument("<id>")
    .action(async (id: string) => {
      await removeConstraintCommand(id)
    })

  constraintsCommand.action(async () => {
    await listConstraintsCommand()
  })

  program.command("providers").description("list supported providers").action(() => {
    listProviders()
  })

  if (process.argv.length <= 2) {
    await startInteractive()
    return
  }

  await program.parseAsync(process.argv)
}

if (!existsSync(path.resolve(process.cwd(), "src/cli/index.tsx"))) {
  console.error("CodeTwin CLI entry not found")
  process.exit(1)
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
