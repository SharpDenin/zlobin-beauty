/**
 * Owner Day/Week columns: only masters with an explicit branch_id matching the
 * selected branch. Unknown / unloaded profiles are excluded (no temporary leak).
 */
export function ownerMasterIdsForBranch(
  candidateIds: string[],
  branchId: string,
  branchByUser: Record<string, string | undefined | null>,
): string[] {
  if (!branchId) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of candidateIds) {
    if (!id || seen.has(id)) continue
    const bid = branchByUser[id]
    if (!bid || bid !== branchId) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
