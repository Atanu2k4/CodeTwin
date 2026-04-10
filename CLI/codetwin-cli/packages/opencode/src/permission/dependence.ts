import type { Permission } from "./index"

export type DependenceLevel = 1 | 2 | 3 | 4 | 5

function deny(permission: string): Permission.Rule {
  return { permission, pattern: "*", action: "deny" }
}

function allow(permission: string): Permission.Rule {
  return { permission, pattern: "*", action: "allow" }
}

export function rules(level?: number): Permission.Ruleset {
  if (!level) return []

  if (level === 1) {
    return [deny("*")]
  }

  if (level === 2) {
    return [
      allow("read"),
      allow("list"),
      allow("glob"),
      allow("grep"),
      deny("bash"),
      deny("edit"),
      deny("write"),
      deny("multiedit"),
      deny("patch"),
      deny("task"),
      deny("webfetch"),
    ]
  }

  if (level === 4 || level === 5) {
    return [allow("*")]
  }

  return []
}

export function isDependenceLevel(input: number): input is DependenceLevel {
  return input >= 1 && input <= 5
}
