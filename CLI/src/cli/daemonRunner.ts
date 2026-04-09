import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

export interface RunnerSpec {
  command: string
  args: string[]
  label: string
}

let cachedRunner: RunnerSpec | null = null

function hasBun(): boolean {
  const check = spawnSync("bun", ["--version"], { stdio: "ignore" })
  return check.status === 0
}

function localTsxPath(): string {
  const executable = process.platform === "win32" ? "tsx.cmd" : "tsx"
  return path.resolve(process.cwd(), "node_modules", ".bin", executable)
}

export function resolveDaemonRunner(entryFile = "src/daemon/index.ts"): RunnerSpec {
  if (cachedRunner) {
    return {
      command: cachedRunner.command,
      args: [...cachedRunner.args.slice(0, -1), entryFile],
      label: cachedRunner.label,
    }
  }

  if (hasBun()) {
    cachedRunner = {
      command: "bun",
      args: ["run", entryFile],
      label: "bun",
    }
    return cachedRunner
  }

  const tsx = localTsxPath()
  if (existsSync(tsx)) {
    cachedRunner = {
      command: tsx,
      args: [entryFile],
      label: "tsx",
    }
    return cachedRunner
  }

  cachedRunner = {
    command: "npx",
    args: ["tsx", entryFile],
    label: "npx-tsx",
  }
  return cachedRunner
}
