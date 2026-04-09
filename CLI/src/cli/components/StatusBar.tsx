import { Box, Text } from "ink"

export function StatusBar(props: {
  projectName: string
  level: number
  modelLabel: string
  remoteConnected: boolean
}): JSX.Element {
  return (
    <Box justifyContent="space-between" borderStyle="single" paddingX={1}>
      <Text>{`CodeTwin | ${props.projectName}`}</Text>
      <Text>{`level: ${props.level}`}</Text>
      <Text>{props.modelLabel}</Text>
      <Text color={props.remoteConnected ? "green" : "red"}>{props.remoteConnected ? "remote:online" : "remote:offline"}</Text>
    </Box>
  )
}
