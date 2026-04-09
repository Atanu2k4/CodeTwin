import { Box, Text } from "ink"

export function DecisionPrompt(props: {
  question: string
  options: string[]
}): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">Decision required</Text>
      <Text>{props.question}</Text>
      <Text>{props.options.length > 0 ? props.options.map((item, index) => `${index + 1}. ${item}`).join("  ") : "Type your response and press Enter."}</Text>
    </Box>
  )
}
