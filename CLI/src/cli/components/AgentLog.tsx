import { Text } from "ink"

export interface AgentLogEntry {
  id: string
  level: "info" | "warn" | "error" | "tool"
  message: string
}

function colorForLevel(level: AgentLogEntry["level"]): "green" | "yellow" | "red" | "cyan" {
  switch (level) {
    case "warn":
      return "yellow"
    case "error":
      return "red"
    case "tool":
      return "cyan"
    case "info":
    default:
      return "green"
  }
}

export function AgentLog(props: { entry: AgentLogEntry }): JSX.Element {
  return <Text color={colorForLevel(props.entry.level)}>{`[${props.entry.level}] ${props.entry.message}`}</Text>
}
