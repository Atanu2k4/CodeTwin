import type { Decision } from "../shared/types"
import { twin } from "./index"

export async function listDecisions(projectId: string, limit = 50): Promise<Decision[]> {
  const profile = await twin.getProfile(projectId)
  return profile.decisions.slice(0, limit)
}

export async function recordDecision(decision: Omit<Decision, "id">): Promise<Decision> {
  return twin.recordDecision(decision)
}

export async function searchDecisions(projectId: string, query: string): Promise<Decision[]> {
  return twin.searchDecisions(projectId, query)
}
