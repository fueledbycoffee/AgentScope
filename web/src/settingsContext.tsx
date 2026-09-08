import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { DEFAULTS, readSettings, subscribe } from './settings'
import type { Settings } from './settings'

/**
 * One subscription for the whole application. `App` reads it, and because
 * `ShellProvider` passes its children through, only a consumer re-renders on a
 * change: having `App` consume the settings recreates the routed element tree,
 * so a number or a date rendered by a component that holds no subscription is
 * recomputed too.
 */
const SettingsContext = createContext<Settings | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useSyncExternalStore(subscribe, readSettings, () => DEFAULTS)
  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>
}

/**
 * The current settings. Both hooks run unconditionally, so a component works
 * with or without a provider (tests and the dev gallery render without one)
 * without breaking the rules of hooks.
 */
export function useSettings(): Settings {
  const fromContext = useContext(SettingsContext)
  const fromStore = useSyncExternalStore(subscribe, readSettings, () => DEFAULTS)
  return fromContext ?? fromStore
}
