import type { Permission } from "./index"

export type DependenceLevel = 1 | 2 | 3 | 4 | 5

function deny(permission: string): Permission.Rule {
  return { permission, pattern: "*", action: "deny" }
}

function allow(permission: string): Permission.Rule {
  return { permission, pattern: "*", action: "allow" }
}

function ask(permission: string): Permission.Rule {
  return { permission, pattern: "*", action: "ask" }
}

export function rules(level?: number): Permission.Ruleset {
  if (!level) return []

  if (level === 1) {
    return [ask("*")]
  }

  if (level === 2) {
    return [
      allow("read"),
      allow("list"),
      allow("glob"),
      allow("grep"),
      ask("bash"),
      ask("edit"),
      ask("write"),
      ask("multiedit"),
      ask("patch"),
      ask("task"),
      ask("webfetch"),
    ]
  }

  if (level === 4) {
    return []
  }

  if (level === 5) {
    return [allow("*")]
  }

  return []
}

export function isDependenceLevel(input: number): input is DependenceLevel {
  return input >= 1 && input <= 5
}
