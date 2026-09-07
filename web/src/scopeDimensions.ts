import type { Session } from './api'

/** Suggestions for the scope inputs from the sessions loaded so far (temporary until a facets endpoint). */
export function dimensionsFrom(rows: Session[] | undefined) {
  const values = (pick: (session: Session) => string | null) => Array.from(new Set((rows ?? []).map(pick).filter((value): value is string => !!value))).sort()
  return [
    { key: 'source' as const, label: 'Source', options: values(session => session.source) },
    { key: 'agent' as const, label: 'Agent', options: values(session => session.agent) },
  ]
}
