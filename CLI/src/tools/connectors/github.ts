export class GitHubConnectorNotImplementedError extends Error {
  constructor() {
    super("GitHub connector is not implemented in this phase")
    this.name = "GitHubConnectorNotImplementedError"
  }
}

export async function runGitHubConnector(): Promise<never> {
  throw new GitHubConnectorNotImplementedError()
}
