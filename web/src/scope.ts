import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { To } from 'react-router-dom'

/**
 * The scope lives in the URL so a screen can be shared, reloaded and walked
 * back with the browser. Only parameters the API applies are scope keys
 * (source and agent today; model, period and the drill chips arrive with #11
 * together with their endpoints), so a pasted URL can never narrow the
 * display without narrowing the numbers.
 */
export const SCOPE_KEYS = ['source', 'agent'] as const
export type ScopeKey = (typeof SCOPE_KEYS)[number]
export type ScopeValues = Partial<Record<ScopeKey, string>>

export function readScope(params: URLSearchParams): ScopeValues {
  const scope: ScopeValues = {}
  for (const key of SCOPE_KEYS) {
    const value = params.get(key)?.trim()
    if (value) scope[key] = value
  }
  return scope
}

/** Stable string identity of a scope, for callback dependencies. */
export const scopeKey = (scope: ScopeValues) => {
  const params = new URLSearchParams()
  for (const key of SCOPE_KEYS) params.set(key, scope[key] ?? '')
  return params.toString() // encoded, so values containing & or = survive the round trip
}

/** The query string that carries the scope (and nothing else) to another route. */
export const scopeSearch = (scope: ScopeValues) => {
  const params = new URLSearchParams()
  for (const key of SCOPE_KEYS) if (scope[key]) params.set(key, scope[key]!)
  return params.size ? `?${params}` : ''
}

export function useScope() {
  const [params, setParams] = useSearchParams()
  const key = scopeKey(readScope(params))
  const scope = useMemo(() => readScope(new URLSearchParams(key)), [key])
  const offset = Math.max(0, Number(params.get('offset')) || 0)
  const set = useCallback((patch: ScopeValues) => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      for (const [name, value] of Object.entries(patch)) {
        if (value && value.trim()) next.set(name, value.trim()); else next.delete(name)
      }
      next.delete('offset') // a scope edit starts from the first page
      return next
    })
  }, [setParams])
  const clear = useCallback(() => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      for (const name of SCOPE_KEYS) next.delete(name)
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
  /** A link to another route that keeps the current scope. */
  const link = useCallback((pathname: string): To => ({ pathname, search: scopeSearch(scope) }), [scope])
  return { scope, key, offset, set, clear, setOffset, link }
}
