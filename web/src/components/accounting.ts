/** Product-facing name for a raw token accounting semantics tag. */
export function accountingGroupLabel(semantics: string): string {
  const value = semantics.toLowerCase()
  if (value === 'unknown') return 'Unknown'
  if (value.includes('claude')) return 'Claude'
  if (value.includes('codex')) return 'Codex'
  return 'Other'
}
