import { Box, Static, Text } from "ink"
import type { PreflightMap } from "../../shared/types"

function blastColor(level: PreflightMap["estimatedBlastRadius"]): "green" | "yellow" | "red" {
  switch (level) {
    case "high":
      return "red"
    case "medium":
      return "yellow"
    case "low":
    default:
      return "green"
  }
}

export function PreflightMapView(props: { map: PreflightMap }): JSX.Element {
  const map = props.map

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={blastColor(map.estimatedBlastRadius)} paddingX={1}>
      <Text>PRE-FLIGHT MAP</Text>
      <Text>{`Task: ${map.taskDescription}`}</Text>
      <Text color={blastColor(map.estimatedBlastRadius)}>{`Blast Radius: ${map.estimatedBlastRadius.toUpperCase()}`}</Text>
      <Text>{`Files to write: ${map.filesToWrite.join(", ") || "none"}`}</Text>
      <Text>{`Files to delete: ${map.filesToDelete.join(", ") || "none"}`}</Text>
      <Text>{`Shell commands: ${map.shellCommandsToRun.join(" | ") || "none"}`}</Text>
      <Text>{`Affected functions: ${map.affectedFunctions.join(", ") || "none"}`}</Text>
      <Text>{`Reasoning: ${map.reasoning}`}</Text>
      <Static items={["[A] Approve   [R] Reject   [M] Modify approach"]}>
        {(item, index) => <Text key={`preflight-action-${index}-${item}`}>{item}</Text>}
      </Static>
    </Box>
  )
}
