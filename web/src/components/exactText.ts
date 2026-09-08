const EXACT_DECIMAL_TEXT = /^([+-]?)(\d+)(\.\d+)?$/

/** Group an exact decimal string for en-US display without numeric conversion. */
export function groupExactText(valueText: string): string {
  const match = EXACT_DECIMAL_TEXT.exec(valueText)
  if (!match) return valueText
  const [, sign, whole, fraction = ''] = match
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`
}
