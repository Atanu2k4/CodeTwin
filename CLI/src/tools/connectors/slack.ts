export class SlackConnectorNotImplementedError extends Error {
  constructor() {
    super("Slack connector is not implemented in this phase")
    this.name = "SlackConnectorNotImplementedError"
  }
}

export async function runSlackConnector(): Promise<never> {
  throw new SlackConnectorNotImplementedError()
}
