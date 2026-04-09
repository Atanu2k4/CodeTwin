import type { PreflightMap, PreflightMapPayload } from "../shared/types"
import { PREFLIGHT_PENDING_TIMEOUT_MS, PREFLIGHT_RESOLVED_TTL_MS } from "../shared/constants"

export type PreflightDecision = "approve" | "reject" | "modify"

interface PendingPreflight {
  id: string
  map: PreflightMap
  createdAt: string
  resolved: boolean
  timeout: NodeJS.Timeout
  resolve: (decision: PreflightDecision) => void
}

export function computeBlastRadius(map: PreflightMap): "low" | "medium" | "high" {
  const writeCount = map.filesToWrite.length + map.filesToDelete.length
  const shellCount = map.shellCommandsToRun.length
  const functionCount = map.affectedFunctions.length

  if (writeCount > 5 || shellCount > 3 || functionCount > 10) return "high"
  if (writeCount > 2 || shellCount > 1 || functionCount > 4) return "medium"
  return "low"
}

export function normalizePreflightMap(map: PreflightMap): PreflightMap {
  return {
    ...map,
    estimatedBlastRadius: computeBlastRadius(map),
  }
}

export class PreflightManager {
  private readonly pending = new Map<string, PendingPreflight>()
  private readonly resolvedAt = new Map<string, number>()

  constructor(
    private readonly options: {
      pendingTimeoutMs: number
      resolvedTtlMs: number
    } = {
      pendingTimeoutMs: PREFLIGHT_PENDING_TIMEOUT_MS,
      resolvedTtlMs: PREFLIGHT_RESOLVED_TTL_MS,
    },
  ) {}

  private cleanupResolved(now = Date.now()): void {
    for (const [id, timestamp] of this.resolvedAt.entries()) {
      if (now - timestamp > this.options.resolvedTtlMs) {
        this.resolvedAt.delete(id)
      }
    }
  }

  private markResolved(id: string): void {
    this.resolvedAt.set(id, Date.now())
    this.cleanupResolved()
  }

  request(map: PreflightMap): {
    awaitingResponseId: string
    payload: PreflightMapPayload
    waitForDecision: Promise<PreflightDecision>
  } {
    this.cleanupResolved()

    const awaitingResponseId = crypto.randomUUID()
    const normalized = normalizePreflightMap(map)

    const waitForDecision = new Promise<PreflightDecision>((resolve) => {
      const timeout = setTimeout(() => {
        const current = this.pending.get(awaitingResponseId)
        if (!current || current.resolved) return

        current.resolved = true
        current.resolve("reject")
        this.pending.delete(awaitingResponseId)
        this.markResolved(awaitingResponseId)
      }, this.options.pendingTimeoutMs)

      this.pending.set(awaitingResponseId, {
        id: awaitingResponseId,
        map: normalized,
        createdAt: new Date().toISOString(),
        resolved: false,
        timeout,
        resolve,
      })
    })

    return {
      awaitingResponseId,
      payload: {
        map: normalized,
        awaitingResponseId,
      },
      waitForDecision,
    }
  }

  resolve(
    awaitingResponseId: string,
    decision: PreflightDecision,
    input?: { onDuplicate?: (id: string) => void },
  ): boolean {
    this.cleanupResolved()

    const pending = this.pending.get(awaitingResponseId)
    if (!pending) {
      if (this.resolvedAt.has(awaitingResponseId)) {
        input?.onDuplicate?.(awaitingResponseId)
      }
      return false
    }

    if (pending.resolved) {
      input?.onDuplicate?.(awaitingResponseId)
      return false
    }

    pending.resolved = true
    clearTimeout(pending.timeout)
    pending.resolve(decision)
    this.pending.delete(awaitingResponseId)
    this.markResolved(awaitingResponseId)
    return true
  }

  has(awaitingResponseId: string): boolean {
    return this.pending.has(awaitingResponseId)
  }

  clear(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
    }
    this.pending.clear()
    this.resolvedAt.clear()
  }
}

export function decisionToApproval(decision: PreflightDecision): boolean {
  return decision === "approve"
}
