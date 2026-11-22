export type BranchLabelInput = {
  id: string
  name: string
  city?: string
  address_line?: string
  active?: boolean
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
  let label = name
  if (sameName.length > 0) {
    const address = (branch.address_line ?? '').trim()
    const city = (branch.city ?? '').trim()
    const sameAddress = sameName.filter((item) => norm(item.address_line) === norm(address) && norm(item.city) === norm(city))
    if (address && sameAddress.length === 0) {
      label = `${name} · ${address}`
    } else if (city && !name.toLowerCase().includes(city.toLowerCase())) {
      label = `${name} · ${city}`
    } else if (address) {
      label = `${name} · ${address}`
    }
  }
  if (branch.active === false) {
    return `${label} · Закрыт`
  }
  return label
}
