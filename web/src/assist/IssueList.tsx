import type { MappingIssue } from '../api/types'

export interface IssueListProps {
  issues: MappingIssue[] | null
  /** True when the issues describe the text on screen. */
  current: boolean
  /** Go to the issue: the page picks the table control or the JSON line. */
  onJump: (path: string) => void
  id?: string
}

/**
 * The validation issues, shown under whichever view is open. Severity decides the order and the
 * colour; the path is the way back to the control that owns it.
 */
export function IssueList({ issues, current, onJump, id }: IssueListProps) {
  const errors = issues?.filter(issue => issue.severity === 'error') ?? []
  const warnings = issues?.filter(issue => issue.severity !== 'error') ?? []
  return (
    <div id={id} className="issues">
      {issues === null && <p className="muted">Not validated yet.</p>}
      {issues !== null && !current && <p className="muted">Edited since the last validation.</p>}
      {issues !== null && current && issues.length === 0 && <p className="ok">No issues: the document is executable.</p>}
      {issues !== null && current && issues.length > 0 && (
        <ul aria-label="Validation issues">
          {[...errors, ...warnings].map((issue, index) => (
            <li key={index} className={issue.severity === 'error' ? 'issue error' : 'issue warn'}>
              <button type="button" className="link" onClick={() => onJump(issue.path)} title="Go to this issue">
                <code>{issue.path || '$'}</code>
              </button>
              <span className="mono code">{issue.code}</span> {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
