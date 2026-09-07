import type { ImportPreview, SavedMapping } from '../api/types'
import { entityCounts } from '../format'
import { Counts, Icon } from '../components'

export interface ActionBarProps {
  busy: string
  validateReason: string | null
  saveReason: string | null
  previewReason: string | null
  importReason: string | null
  saved: SavedMapping | null
  preview: ImportPreview | null
  filename: string
  sha256: string | null
  recordCount: number | null
  source: string
  onValidate: () => void
  onSave: () => void
  onPreview: () => void
  onImport: () => void
}

function Gate({ reason, children }: { reason: string | null; children: React.ReactNode }) {
  return (
    <div className="gate">
      {children}
      {reason && <span className="muted gate-reason">{reason}</span>}
    </div>
  )
}

/**
 * The four explicit steps after a proposal: validate (free), save a revision (needs a current
 * executable validation), preview (needs the saved text on screen), import (needs a preview of
 * that revision, then a confirmation naming file, hash, source and revision). The chat cannot
 * trigger any of them.
 */
export function ActionBar(props: ActionBarProps) {
  const { busy, saved, preview } = props
  const disabled = busy !== ''
  return (
    <section className="assist-actions" aria-label="Next steps">
      <div className="actions">
        <Gate reason={props.validateReason}>
          <button type="button" className="btn has-tip" data-tip="Validate" aria-label="Validate the document" disabled={disabled || props.validateReason !== null} onClick={props.onValidate}><Icon name="check" /></button>
        </Gate>
        <Gate reason={props.saveReason}>
          <button type="button" className="btn has-tip" data-tip="Save revision" aria-label="Save a mapping revision" disabled={disabled || props.saveReason !== null} onClick={props.onSave}><Icon name="file" /></button>
        </Gate>
        <Gate reason={props.previewReason}>
          <button type="button" className="btn has-tip" data-tip="Preview" aria-label="Preview the import" disabled={disabled || props.previewReason !== null} onClick={props.onPreview}><Icon name="eye" /></button>
        </Gate>
        <Gate reason={props.importReason}>
          <button type="button" className="btn primary has-tip" data-tip="Import" aria-label="Import with this revision" disabled={disabled || props.importReason !== null} onClick={props.onImport}><Icon name="upload" /></button>
        </Gate>
        {busy && <span role="status" className="muted">{busy}</span>}
      </div>
      {saved && (
        <p className="receipt">
          Saved as <strong>{saved.name}</strong> revision {saved.revision} ({saved.created ? 'new' : 'already existed'}) · id <span className="mono">{saved.id}</span>
        </p>
      )}
      {preview && saved && (
        <div className="preview-summary">
          <h3>Preview of revision {saved.revision}</h3>
          <Counts title="Source records sampled" counts={preview.records} />
          <Counts title="Entity observations" counts={entityCounts(preview.entities)} />
          <Counts title="Warnings" counts={preview.warnings} />
          <p className="muted">{preview.rejects.length} reject{preview.rejects.length === 1 ? '' : 's'} in the sample of {preview.records.sampled}. The full import can differ.</p>
          <ul className="emissions" aria-label="First emission of each entity">
            {['session', 'model_call', 'tool_call'].map(entity => {
              const first = preview.emissions.find(e => e.entity === entity)
              return first ? <li key={entity} className="muted mono">first {entity}: {JSON.stringify(first.fields).slice(0, 200)}</li> : null
            })}
          </ul>
          {props.importReason === null && (
            <p>
              Import all {props.recordCount?.toLocaleString('en-US') ?? '?'} records of <strong>{props.filename}</strong>
              {props.sha256 && <> (SHA-256 <span className="mono">{props.sha256.slice(0, 12)}…</span>)</>} into source <strong>{props.source}</strong> with {saved.name} revision {saved.revision}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
