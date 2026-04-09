export const CODETWIN_DIR = ".CodeTwin"

export const CONFIG_FILE = ".CodeTwin/config.json"
export const TWIN_DB_FILE = ".CodeTwin/twin.db"
export const SESSIONS_DB_FILE = ".CodeTwin/sessions.db"
export const DAEMON_PID_FILE = ".CodeTwin/daemon.pid"
export const DAEMON_PORT_FILE = ".CodeTwin/daemon.port"

export const DAEMON_PORT_CANDIDATES = [7878, 7879, 7880] as const
export const DAEMON_HOST = "127.0.0.1"

export const MAX_TOOL_OUTPUT_BYTES = 50 * 1024
export const BASH_TIMEOUT_MS = 30_000
export const MAX_TOOL_ITERATIONS = 20
export const AGENT_STREAM_MAX_ATTEMPTS = 3
export const AGENT_STREAM_RETRY_BASE_MS = 1_000
export const AGENT_STREAM_RETRY_MAX_MS = 8_000
export const TASK_MAX_RUNTIME_MS = 30 * 60 * 1_000
export const PREFLIGHT_PENDING_TIMEOUT_MS = 5 * 60 * 1_000
export const PREFLIGHT_RESOLVED_TTL_MS = 15 * 60 * 1_000
export const DECISION_PENDING_TIMEOUT_MS = 10 * 60 * 1_000
export const DECISION_RESOLVED_TTL_MS = 30 * 60 * 1_000

export const DANGEROUS_SHELL_PATTERNS: RegExp[] = [
  /(^|\s)rm\s+-rf\s+\/$/i,
  /(^|\s)sudo(\s|$)/i,
  /(^|\s)(shutdown|reboot|halt|poweroff)(\s|$)/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /dd\s+if=.*\s+of=\/dev\/sd[a-z]/i,
  /drop\s+database/i,
  /(^|\s)mkfs(\s|$)/i,
  /(^|\s)format(\s|$)/i,
  /dd\s+if=\/dev\/zero/i,
]
