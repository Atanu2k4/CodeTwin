import type { Constraint } from "../shared/types"
import { twin } from "./index"

export async function listConstraints(projectId: string): Promise<Constraint[]> {
  return twin.getConstraints(projectId)
}

export async function addConstraint(constraint: Omit<Constraint, "id">): Promise<Constraint> {
  return twin.addConstraint(constraint)
}

export async function removeConstraint(id: string): Promise<void> {
  return twin.removeConstraint(id)
}

export async function checkConstraintViolation(
  projectId: string,
  proposedAction: string,
): Promise<{ violated: boolean; constraint?: Constraint; reasoning?: string }> {
  return twin.checkConstraintViolation(projectId, proposedAction)
}
