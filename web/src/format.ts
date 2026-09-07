import type { EntityCounts } from './api'

export const PAGE_SIZE = 50
export const display = (value: string | number | boolean | null | undefined) =>
  value == null ? 'Unavailable' : String(value)

export const entityCounts = (counts: EntityCounts) => ({
  session: counts.session ?? 0,
  model_call: counts.model_call ?? 0,
  tool_call: counts.tool_call ?? 0,
})
