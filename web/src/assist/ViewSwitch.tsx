import { Icon } from '../components'

export type DocumentView = 'table' | 'json'

export interface ViewSwitchProps {
  view: DocumentView
  onChange: (view: DocumentView) => void
  /** Why the table cannot be opened (a document that is not addressable as rows). */
  tableDisabled?: string
}

/**
 * Table or JSON, as two icon buttons with a pressed state: an icon-only control still says what it
 * is (accessible name) and shows it (tooltip), and the pressed one says which view is open.
 */
export function ViewSwitch({ view, onChange, tableDisabled }: ViewSwitchProps) {
  const button = (value: DocumentView, icon: 'layers' | 'braces', label: string, disabled?: string) => (
    <button
      type="button"
      className={`btn small icon-only has-tip${view === value ? ' selected' : ''}`}
      aria-pressed={view === value}
      aria-label={label}
      data-tip={disabled ?? label}
      disabled={disabled !== undefined}
      onClick={() => onChange(value)}
    >
      <Icon name={icon} />
    </button>
  )
  return (
    <div className="view-switch" role="group" aria-label="Document view">
      {button('table', 'layers', 'Field table', tableDisabled)}
      {button('json', 'braces', 'JSON document')}
    </div>
  )
}
