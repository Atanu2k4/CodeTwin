import type { Decision } from "../shared/types"
import { twin } from "./index"

export interface CausalGraphNode {
  id: string
  label: string
  timestamp: string
}

export interface CausalGraphEdge {
  from: string
  to: string
}

export interface CausalGraph {
  nodes: CausalGraphNode[]
  edges: CausalGraphEdge[]
}

function toNode(decision: Decision): CausalGraphNode {
  return {
    id: decision.id,
    label: `${decision.choice}: ${decision.description}`,
    timestamp: decision.timestamp,
  }
}

export async function buildCausalGraph(projectId: string): Promise<CausalGraph> {
  const profile = await twin.getProfile(projectId)
  const nodes = profile.decisions.map(toNode)

  const edges: CausalGraphEdge[] = []
  const seen = new Set<string>()

  for (const decision of profile.decisions) {
    if (decision.causedBy) {
      const key = `${decision.causedBy}->${decision.id}`
      if (!seen.has(key)) {
        seen.add(key)
        edges.push({ from: decision.causedBy, to: decision.id })
      }
    }

    for (const cause of decision.causes ?? []) {
      const key = `${decision.id}->${cause}`
      if (!seen.has(key)) {
        seen.add(key)
        edges.push({ from: decision.id, to: cause })
      }
    }
  }

  return {
    nodes,
    edges,
  }
}
