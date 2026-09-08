import { createContext, useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Dimension, FileItem } from './components'

/**
 * Pages describe what the bar above them should show (scope dimensions and the
 * receipt on data routes, file identity elsewhere); the shell renders it. The
 * bar slot keeps its height either way, so the frame never jumps.
 */
export interface ReceiptValues {
  sessionsText?: string | null
  modelCallsText?: string | null
  importsText?: string | null
  resolvedPeriodText?: string | null
  /** Compatibility for #46-owned pages until its post-merge migration. */
  sessions?: number | null
  modelCalls?: number | null
  imports?: number | null
}
interface ShellState {
  dimensions: Dimension[]
  receipt?: ReceiptValues
  receiptLoading: boolean
  file: { title?: string; items: FileItem[] }
}
export interface ShellApi extends ShellState {
  setScopeBar: (state: { dimensions?: Dimension[]; receipt?: ReceiptValues; loading?: boolean }) => void
  setFileBar: (state: { title?: string; items: FileItem[] }) => void
}

const EMPTY: ShellState = { dimensions: [], receiptLoading: false, file: { items: [] } }
export const ShellContext = createContext<ShellApi | undefined>(undefined)

export function ShellProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ShellState>(EMPTY)
  // Stable setters that ignore no-op updates: pages call them from effects, so a
  // fresh object on every call would re-render the provider forever.
  const setScopeBar = useCallback((patch: { dimensions?: Dimension[]; receipt?: ReceiptValues; loading?: boolean }) => setState(previous => {
    const next = { ...previous, dimensions: patch.dimensions ?? previous.dimensions, receipt: 'receipt' in patch ? patch.receipt : previous.receipt, receiptLoading: patch.loading ?? previous.receiptLoading }
    return same(previous, next) ? previous : next
  }), [])
  const setFileBar = useCallback((file: { title?: string; items: FileItem[] }) => setState(previous => {
    const next = { ...previous, file }
    return same(previous, next) ? previous : next
  }), [])
  const api = useMemo<ShellApi>(() => ({ ...state, setScopeBar, setFileBar }), [state, setScopeBar, setFileBar])
  return <ShellContext.Provider value={api}>{children}</ShellContext.Provider>
}

function same(a: ShellState, b: ShellState) {
  return JSON.stringify(a, replacer) === JSON.stringify(b, replacer)
}
function replacer(_key: string, value: unknown) {
  return typeof value === 'object' && value !== null && '$$typeof' in (value as object) ? String((value as { key?: unknown }).key ?? 'node') : value
}
