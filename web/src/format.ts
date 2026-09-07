import type { EntityCounts } from './api'

export const PAGE_SIZE = 50
export const display = (value: string | number | boolean | null | undefined) =>
  value == null ? 'Unavailable' : typeof value === 'number' ? value.toLocaleString('en-US') : String(value)

export const entityCounts = (counts: EntityCounts) => ({
  session: counts.session ?? 0,
  model_call: counts.model_call ?? 0,
  tool_call: counts.tool_call ?? 0,
})

export function abbreviate(value: number): string {
  if (Math.abs(value) < 100_000) return value.toLocaleString('en-US')
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']]
  for (const [size, suffix] of units) {
    if (Math.abs(value) >= size) return `${(value / size).toLocaleString('en-US', { maximumFractionDigits: 1 })}${suffix}`
  }
  return value.toLocaleString('en-US')
}
