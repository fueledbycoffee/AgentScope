import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark' | 'system'
const KEY = 'agentscope-theme'
const listeners = new Set<() => void>()

let chosen: Theme | undefined // the last choice made in this page, for when storage is unavailable

function read(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : chosen ?? 'system'
  } catch { return chosen ?? 'system' }
}

/** Stamp the root element; "system" removes the attribute so the OS decides. */
export function applyTheme(theme: Theme = read()) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function setTheme(theme: Theme) {
  chosen = theme
  try { if (theme === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, theme) } catch { /* private mode: the in-memory choice still applies */ }
  applyTheme(theme)
  listeners.forEach(listener => listener())
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const subscribe = useCallback((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }, [])
  const theme = useSyncExternalStore(subscribe, read, () => 'system' as Theme)
  return [theme, setTheme]
}
