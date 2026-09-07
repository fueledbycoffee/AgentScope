import { useEffect, useState } from 'react'

// Associate results with the exact request so obsolete responses never replace
// a newer filter/page, and stale data is hidden immediately while loading.
export function useResource<T>(load: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ load: typeof load; attempt: number; data?: T; error?: unknown }>()
  useEffect(() => {
    let active = true
    load().then(
      data => { if (active) setState({ load, attempt, data }) },
      error => { if (active) setState({ load, attempt, error }) },
    )
    return () => { active = false }
  }, [load, attempt])
  const current = state?.load === load && state.attempt === attempt ? state : undefined
  return { data: current?.data, error: current?.error, loading: !current, retry: () => setAttempt(value => value + 1) }
}
