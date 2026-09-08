import { useEffect, useState } from 'react'

/**
 * Whether a CSS media query matches, for the few decisions that must be real (a disclosure with
 * an `aria-expanded` button, not content hidden by CSS a screen reader still reads).
 *
 * Environments without `matchMedia` (jsdom, an old browser) report no match, which keeps the wide
 * layout: a missing capability must never collapse the page.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return matches
}
