import type { AttachedRepository } from "./settings";

export function preserveAccessibleRepositories(
  selected: readonly AttachedRepository[],
  accessible: readonly AttachedRepository[],
): AttachedRepository[] {
  const accessibleIds = new Set(accessible.map((repository) => repository.id));
  return selected.filter((repository) => accessibleIds.has(repository.id));
}
