import { useCallback } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import type { To } from 'react-router-dom'
import { SCOPE_KEYS } from '../../scope'
import type { ScopeKey } from '../../scope'

/**
 * The scope operations a table cell and a chip need, composed over the URL
 * rather than added to `scope.ts` (which #11 owns while both issues run).
 *
 * Everything mutates through one pure function, so encoding, trimming, the
 * offset reset and the preservation of other parameters cannot drift between
 * the scope bar, a cell link and a chip's remove button.
 */

/**
 * Parameters that ARE the scope and therefore travel to another route.
 *
 * `drill` is #11's versioned drill envelope. It does not exist on main yet, so
 * it is named here: a Session cell that targets /sessions must not silently
 * drop a tool, quality, day or accounting drill. After #11 merges this becomes
 * `SCOPE_PARAMS` imported from `scope.ts`, and the constant below goes away.
 */
const EXTRA_SCOPE_PARAMS = ['drill'] as const
export const scopeParams = (): string[] => [...SCOPE_KEYS, ...EXTRA_SCOPE_PARAMS]

export const scopeLabel = (key: ScopeKey): string => key.charAt(0).toUpperCase() + key.slice(1)

/**
 * One pure URL edit. Copies `search`, writes each value **exactly** as given,
 * drops `offset` because a scope edit starts from the first page, and leaves
 * every other parameter alone — other scope keys, the drill envelope, and
 * anything the page owns.
 *
 * Nothing is trimmed between a cell and the URL: the backend stores and
 * compares source and agent exactly, so an agent recorded as `"codex "` is not
 * the agent `"codex"`, and trimming would filter for an identifier nobody
 * clicked. Only an absent or empty value removes a key.
 */
export function patchScope(search: URLSearchParams, patch: Record<string, string | undefined>): URLSearchParams {
  const next = new URLSearchParams(search)
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value); else next.delete(key)
  }
  next.delete('offset')
  return next
}

const searchOf = (params: URLSearchParams) => (params.size ? `?${params}` : '')

export function useScopeUrl() {
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()

  // Exactly what the URL carries: the active-value comparison must match the
  // backend's, which is exact.
  const valueOf = useCallback((key: ScopeKey) => params.get(key) ?? '', [params])

  /**
   * A link, so a scoped view opens in a new tab on middle-click. On the current
   * route every parameter is preserved; on another route only the scope travels,
   * because a page's own parameters belong to the page being left.
   */
  const scopeHref = useCallback((key: ScopeKey, value: string, target?: string): To => {
    const sameRoute = !target || target === pathname
    const base = sameRoute ? params : new URLSearchParams(
      scopeParams().flatMap(name => {
        const carried = params.get(name)
        return carried ? [[name, carried] as [string, string]] : []
      }),
    )
    const cleared = valueOf(key) === value
    return { pathname: target ?? pathname, search: searchOf(patchScope(base, { [key]: cleared ? '' : value })) }
  }, [params, pathname, valueOf])

  const remove = useCallback((key: ScopeKey) => {
    setParams(previous => patchScope(previous, { [key]: '' }))
  }, [setParams])

  const clearAll = useCallback(() => {
    setParams(previous => {
      const next = patchScope(previous, {})
      for (const name of scopeParams()) next.delete(name)
      return next
    })
  }, [setParams])

  const active = SCOPE_KEYS.filter(key => valueOf(key))

  return { params, valueOf, scopeHref, remove, clearAll, active }
}
