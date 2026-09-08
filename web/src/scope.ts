import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { To } from 'react-router-dom'
import type { ApiTraceScope, MetricDrillScope, PublicMetricDrillScope } from './api'

export const SCOPE_KEYS = ['source', 'agent', 'model', 'period'] as const
export const SCOPE_PARAMS = [...SCOPE_KEYS, 'drill'] as const
export type ScopeKey = (typeof SCOPE_KEYS)[number]
export type ScopeValues = Partial<Record<ScopeKey, string>>
export type DrillLabel = 'day' | 'tool' | 'quality' | 'accounting'

export interface DrillEnvelopeV1 {
  version: 1
  label: DrillLabel
  value: string
  scope: PublicMetricDrillScope
}

export interface UrlScope extends ScopeValues { drill?: DrillEnvelopeV1 }

export const SCOPE_LABELS: Record<ScopeKey, string> = {
  source: 'Source',
  agent: 'Agent',
  model: 'Model',
  period: 'Period (UTC)',
}

const DRILL_LABELS = new Set<DrillLabel>(['day', 'tool', 'quality', 'accounting'])
const DRILL_TEXT_FIELDS = new Set([
  'source', 'agent', 'model', 'tool', 'started_from', 'started_before', 'started_through',
  'import_id', 'token_semantics', 'witness_started_from', 'witness_started_before',
  'witness_started_through',
])
const DRILL_BOOLEAN_FIELDS = new Set([
  'model_is_unknown', 'agent_is_unknown', 'timestamp_missing', 'tool_is_unlinked',
  'usage_missing', 'tool_is_linked', 'witness_time_override', 'witness_required',
  'witness_timestamp_missing',
])
const MAX_DRILL_LENGTH = 8_192

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function awareInstant(value: string): number | undefined {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined
  const instant = Date.parse(value)
  return Number.isFinite(instant) ? instant : undefined
}

function increasing(scope: PublicMetricDrillScope, prefix: '' | 'witness_') {
  const startText = scope[`${prefix}started_from`]
  const beforeText = scope[`${prefix}started_before`]
  const throughText = scope[`${prefix}started_through`]
  const start = startText ? awareInstant(startText) : undefined
  const before = beforeText ? awareInstant(beforeText) : undefined
  const through = throughText ? awareInstant(throughText) : undefined
  if ((startText && start === undefined) || (beforeText && before === undefined) || (throughText && through === undefined)) return false
  if (start !== undefined && before !== undefined && start >= before) return false
  if (start !== undefined && through !== undefined && start > through) return false
  return true
}

function normalizeDrillScope(value: unknown): PublicMetricDrillScope | undefined {
  if (!object(value) || 'session_ids' in value) return undefined
  const normalized: Record<string, string | boolean> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === false) continue
    if (DRILL_TEXT_FIELDS.has(key)) {
      if (typeof item !== 'string' || !item) return undefined
      normalized[key] = item
    } else if (DRILL_BOOLEAN_FIELDS.has(key)) {
      if (item !== true) return undefined
      normalized[key] = true
    } else if (key === 'activity_grain') {
      if (item !== 'model_call' && item !== 'tool_call') return undefined
      normalized[key] = item
    } else {
      return undefined
    }
  }
  const scope = normalized as PublicMetricDrillScope
  const hasDates = Boolean(scope.started_from || scope.started_before || scope.started_through)
  const hasWitnessDates = Boolean(scope.witness_started_from || scope.witness_started_before || scope.witness_started_through)
  if (!increasing(scope, '') || !increasing(scope, 'witness_')) return undefined
  if ((scope.model && scope.model_is_unknown) || (scope.agent && scope.agent_is_unknown)) return undefined
  if (scope.tool_is_linked && scope.tool_is_unlinked) return undefined
  if (scope.timestamp_missing && (hasDates || !scope.activity_grain)) return undefined
  if (scope.witness_time_override && !scope.activity_grain) return undefined
  if ((hasWitnessDates || scope.witness_timestamp_missing || scope.witness_required) && !scope.witness_time_override) return undefined
  if (scope.witness_timestamp_missing && hasWitnessDates) return undefined
  return scope
}

export function parseDrill(value: string | null): DrillEnvelopeV1 | undefined {
  if (!value || value.length > MAX_DRILL_LENGTH) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!object(parsed) || parsed.version !== 1 || typeof parsed.value !== 'string'
      || parsed.value.length > 240 || !DRILL_LABELS.has(parsed.label as DrillLabel)) return undefined
    const scope = normalizeDrillScope(parsed.scope)
    return scope ? { version: 1, label: parsed.label as DrillLabel, value: parsed.value, scope } : undefined
  } catch {
    return undefined
  }
}

export function createDrillEnvelope(label: DrillLabel, value: string, scope: MetricDrillScope): DrillEnvelopeV1 | undefined {
  if (scope.session_ids !== null) return undefined
  const publicScope = { ...scope } as Partial<MetricDrillScope>
  delete publicScope.session_ids
  return parseDrill(JSON.stringify({ version: 1, label, value, scope: publicScope }))
}

const drillText = (drill: DrillEnvelopeV1) => canonical(drill)

export function readScope(params: URLSearchParams): UrlScope {
  const scope: UrlScope = {}
  for (const key of SCOPE_KEYS) {
    const value = params.get(key)?.trim()
    if (value && (key !== 'period' || ['7d', '30d', '90d'].includes(value))) scope[key] = value
  }
  const drill = parseDrill(params.get('drill'))
  if (drill) scope.drill = drill
  return scope
}

/** Stable, complete serialization; useScope reconstructs state from this string. */
export const scopeKey = (scope: UrlScope) => {
  const params = new URLSearchParams()
  for (const key of SCOPE_KEYS) params.set(key, scope[key] ?? '')
  params.set('drill', scope.drill ? drillText(scope.drill) : '')
  return params.toString()
}

/** Scope-only query string for navigation to another data route. */
export const scopeSearch = (scope: UrlScope) => {
  const params = new URLSearchParams()
  for (const key of SCOPE_PARAMS) {
    const value = key === 'drill' ? (scope.drill ? drillText(scope.drill) : undefined) : scope[key]
    if (value) params.set(key, value)
  }
  return params.size ? `?${params}` : ''
}

type ScopePatch = Partial<Record<ScopeKey, string | null | undefined>> & {
  drill?: DrillEnvelopeV1 | null
}

function reconcileDrill(drill: DrillEnvelopeV1, key: ScopeKey, value: string | undefined) {
  if (key === 'period') return undefined
  const nextScope = { ...drill.scope }
  if (value) nextScope[key] = value
  else delete nextScope[key]
  if (key === 'agent') delete nextScope.agent_is_unknown
  if (key === 'model') delete nextScope.model_is_unknown
  return { ...drill, scope: nextScope }
}

/** Pure same-route patch: preserve unrelated params, canonicalize scope, reset pagination. */
export function patchScope(search: URLSearchParams, changes: ScopePatch): URLSearchParams {
  const next = new URLSearchParams(search)
  const current = readScope(search)
  let drill = 'drill' in changes ? changes.drill ?? undefined : current.drill
  for (const key of SCOPE_KEYS) {
    if (!(key in changes)) continue
    const raw = changes[key]
    const value = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
    if (value) next.set(key, value)
    else next.delete(key)
    if (drill) drill = reconcileDrill(drill, key, value)
  }
  if (drill) next.set('drill', drillText(drill))
  else next.delete('drill')
  next.delete('offset')
  return next
}

export function scopeHref(scope: UrlScope, key: ScopeKey, value: string | undefined, pathname = '/sessions'): To {
  const next = patchScope(new URLSearchParams(scopeSearch(scope)), { [key]: value })
  return { pathname, search: next.size ? `?${next}` : '' }
}

export interface ResolvedPeriod {
  started_from: string
  started_before: string
  text: string
}

export function resolvePeriod(period: string | undefined, now = new Date()): ResolvedPeriod | undefined {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : undefined
  if (!days) return undefined
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const start = new Date(today - (days - 1) * 86_400_000)
  const before = new Date(today + 86_400_000)
  const day = (value: Date) => value.toISOString().slice(0, 10)
  return {
    started_from: `${day(start)}T00:00:00.000Z`,
    started_before: `${day(before)}T00:00:00.000Z`,
    text: `${day(start)} → ${day(before)} UTC`,
  }
}

export function resolveApiScope(scope: UrlScope, now = new Date()): ApiTraceScope {
  const result: ApiTraceScope = { ...(scope.drill?.scope as ApiTraceScope | undefined) }
  delete (result as ApiTraceScope & { session_ids?: unknown }).session_ids
  for (const key of ['source', 'agent', 'model'] as const) {
    const value = scope[key]
    if (value) {
      result[key] = value
      if (key === 'agent') delete result.agent_is_unknown
      if (key === 'model') delete result.model_is_unknown
    }
  }
  if (!scope.drill) {
    const resolved = resolvePeriod(scope.period, now)
    if (resolved) {
      result.started_from = resolved.started_from
      result.started_before = resolved.started_before
    }
  }
  return result
}

export function formatScopeValue(key: ScopeKey, value: string) {
  if (key !== 'period') return value
  return value === '7d' ? '7 days' : value === '30d' ? '30 days' : value === '90d' ? '90 days' : value
}

export function useScope() {
  const [params, setParams] = useSearchParams()
  const key = scopeKey(readScope(params))
  const scope = useMemo(() => readScope(new URLSearchParams(key)), [key])
  const apiScope = useMemo(() => resolveApiScope(scope), [scope])
  const offset = Math.max(0, Number(params.get('offset')) || 0)
  const update = useCallback((changes: ScopePatch) => {
    setParams(previous => patchScope(previous, changes))
  }, [setParams])
  const set = useCallback((changes: ScopeValues) => update(changes), [update])
  const remove = useCallback((name: ScopeKey) => update({ [name]: undefined }), [update])
  const toggle = useCallback((name: ScopeKey, value: string) => {
    update({ [name]: scope[name] === value ? undefined : value })
  }, [scope, update])
  const setDrill = useCallback((drill: DrillEnvelopeV1) => update({ drill }), [update])
  const removeDrill = useCallback(() => update({ drill: null }), [update])
  const clear = useCallback(() => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      for (const name of SCOPE_PARAMS) next.delete(name)
      next.delete('offset')
      return next
    })
  }, [setParams])
  const setOffset = useCallback((value: number) => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      if (value > 0) next.set('offset', String(value)); else next.delete('offset')
      return next
    })
  }, [setParams])
  const link = useCallback((pathname: string): To => ({ pathname, search: scopeSearch(scope) }), [scope])
  const href = useCallback((name: ScopeKey, value: string | undefined, pathname = '/sessions') => (
    scopeHref(scope, name, value, pathname)
  ), [scope])
  return { scope, apiScope, key, drill: scope.drill, offset, set, remove, toggle, clear, setDrill, removeDrill, setOffset, link, scopeHref: href }
}
