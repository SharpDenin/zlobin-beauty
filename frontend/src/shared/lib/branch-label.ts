export type BranchLabelInput = {
  id: string
  name: string
  city?: string
  address_line?: string
}

function norm(value?: string) {
  return (value ?? '').trim().toLowerCase()
}

/**
 * Keep the branch name when it is unique.
 * Same city is not the same salon: identical names are disambiguated by address, then city.
 */
export function branchLabel(branch: BranchLabelInput, siblings: BranchLabelInput[]): string {
  const name = branch.name.trim() || 'Филиал'
  const sameName = siblings.filter((item) => item.id !== branch.id && norm(item.name) === norm(name))
  if (sameName.length === 0) return name
  const address = (branch.address_line ?? '').trim()
  const city = (branch.city ?? '').trim()
  const sameAddress = sameName.filter((item) => norm(item.address_line) === norm(address) && norm(item.city) === norm(city))
  if (address && sameAddress.length === 0) {
    return city && !name.toLowerCase().includes(city.toLowerCase()) ? `${name} · ${address}` : `${name} · ${address}`
  }
  if (city && !name.toLowerCase().includes(city.toLowerCase())) return `${name} · ${city}`
  if (address) return `${name} · ${address}`
  return name
}
