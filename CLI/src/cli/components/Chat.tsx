import { Box, Text } from "ink"
import type { ChatEntry } from "../hooks/useSession"

function colorForRole(role: ChatEntry["role"]): "blue" | "green" | "gray" {
  switch (role) {
    case "agent":
      return "green"
    case "user":
      return "blue"
    case "system":
    default:
      return "gray"
  }
}

export function Chat(props: { entries: ChatEntry[] }): JSX.Element {
  return (
    <Box flexDirection="column" paddingX={1}>
      {props.entries.map((entry) => (
        <Text key={entry.id} color={colorForRole(entry.role)}>
          {`${entry.role}: ${entry.text}`}
        </Text>
      ))}
    </Box>
  )
}
