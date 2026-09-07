import { useContext, useEffect } from 'react'
import type { Dimension, FileItem } from './components'
import { ShellContext } from './shellContext'
import type { ReceiptValues, ShellApi } from './shellContext'

export function useShellContext(): ShellApi {
  const value = useContext(ShellContext)
  if (!value) throw new Error('useShellContext needs a ShellProvider')
  return value
}

/** Declare the file bar for this route; cleared when the route unmounts. */
export function useFileBar(title: string | undefined, items: FileItem[]) {
  const { setFileBar } = useShellContext()
  const key = JSON.stringify(items.map(item => [item.label, typeof item.value === 'string' ? item.value : '']))
  useEffect(() => { setFileBar({ title, items }); return () => setFileBar({ items: [] }) }, [setFileBar, title, key]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Declare the scope bar for this route. */
export function useScopeBar(dimensions: Dimension[], receipt: ReceiptValues | undefined, loading: boolean) {
  const { setScopeBar } = useShellContext()
  const dimensionsKey = JSON.stringify(dimensions)
  const receiptKey = JSON.stringify(receipt ?? null)
  useEffect(() => { setScopeBar({ dimensions, receipt, loading }) }, [setScopeBar, dimensionsKey, receiptKey, loading]) // eslint-disable-line react-hooks/exhaustive-deps
}
