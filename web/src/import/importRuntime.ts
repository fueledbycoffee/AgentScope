import type { ImportPreview, ImportRequest, Mapping, Upload } from '../api'

export type ImportStep = 1 | 2 | 3 | 4

export interface PreviewState {
  value: ImportPreview
  detailsAvailable: boolean
}

export interface ImportEntry {
  upload: Upload
  mappingId: string | null
  preview: PreviewState | null
}

export interface ImportState {
  entries: ImportEntry[]
}

export type ImportAction =
  | { type: 'add'; entries: ImportEntry[] }
  | { type: 'remove'; uploadId: string }
  | { type: 'mapping'; uploadId: string; mappingId: string }
  | { type: 'previews'; previews: Map<string, ImportPreview> }
  | { type: 'reconcile'; mappings: Mapping[] }
  | { type: 'reset' }

export interface MappingCandidate {
  mapping: Mapping
  superseded: boolean
  recommended: boolean
  reason: string
}

export const EMPTY_IMPORT_STATE: ImportState = { entries: [] }

export function importReducer(state: ImportState, action: ImportAction): ImportState {
  switch (action.type) {
    case 'add':
      return { entries: [...state.entries, ...action.entries] }
    case 'remove':
      return { entries: state.entries.filter(entry => entry.upload.upload_id !== action.uploadId) }
    case 'mapping':
      return {
        entries: state.entries.map(entry => entry.upload.upload_id === action.uploadId
          ? { ...entry, mappingId: action.mappingId, preview: null }
          : entry),
      }
    case 'previews':
      return {
        entries: state.entries.map(entry => {
          const preview = action.previews.get(entry.upload.upload_id)
          return preview ? { ...entry, preview: { value: preview, detailsAvailable: true } } : entry
        }),
      }
    case 'reconcile': {
      const byId = new Map(action.mappings.map(mapping => [mapping.id, mapping]))
      return {
        entries: state.entries.map(entry => {
          if (!entry.mappingId) return entry
          const mapping = byId.get(entry.mappingId)
          return mapping?.input_format === entry.upload.format
            ? entry
            : { ...entry, mappingId: null, preview: null }
        }),
      }
    }
    case 'reset':
      return EMPTY_IMPORT_STATE
  }
}

export function requestedStep(search: URLSearchParams): ImportStep {
  const raw = search.get('step')
  if (!raw || !/^\d+$/.test(raw)) return 1
  return Math.min(4, Math.max(1, Number(raw))) as ImportStep
}

export function highestReachableStep(state: ImportState, mappings: Mapping[]): ImportStep {
  if (state.entries.length === 0) return 1
  const byId = new Map(mappings.map(mapping => [mapping.id, mapping]))
  const resolved = state.entries.every(entry => {
    const mapping = entry.mappingId ? byId.get(entry.mappingId) : undefined
    return mapping?.input_format === entry.upload.format
  })
  if (!resolved) return 2
  if (!state.entries.every(entry => entry.preview !== null)) return 3
  return 4
}

export function clampStep(requested: ImportStep, state: ImportState, mappings: Mapping[]): ImportStep {
  return Math.min(requested, highestReachableStep(state, mappings)) as ImportStep
}

export function mappingCandidates(upload: Upload, mappings: Mapping[]): MappingCandidate[] {
  const compatible = mappings.filter(mapping => mapping.input_format === upload.format)
  const latest = new Map<string, number>()
  for (const mapping of compatible) latest.set(mapping.name, Math.max(latest.get(mapping.name) ?? 0, mapping.revision))
  const ordered = compatible.map(mapping => ({
    mapping,
    superseded: mapping.revision < (latest.get(mapping.name) ?? mapping.revision),
  })).sort((left, right) =>
    Number(left.superseded) - Number(right.superseded)
    || Number(right.mapping.created_by === 'bundled') - Number(left.mapping.created_by === 'bundled')
    || right.mapping.revision - left.mapping.revision
    || left.mapping.name.localeCompare(right.mapping.name)
    || left.mapping.id.localeCompare(right.mapping.id))
  return ordered.map((candidate, index) => ({
    ...candidate,
    recommended: index === 0,
    reason: index === 0
      ? candidate.mapping.created_by === 'bundled'
        ? 'Recommended: bundled mapping for this format.'
        : 'Recommended: latest saved revision for this format.'
      : candidate.superseded
        ? 'Earlier revision retained so existing imports stay reproducible.'
        : 'Compatible saved mapping for this format.',
  }))
}

export function duplicateHashes(entries: ImportEntry[]): boolean {
  return new Set(entries.map(entry => entry.upload.sha256)).size !== entries.length
}

export function selectedMappings(entries: ImportEntry[], mappings: Mapping[]): Mapping[] | null {
  const byId = new Map(mappings.map(mapping => [mapping.id, mapping]))
  const selected = entries.map(entry => entry.mappingId ? byId.get(entry.mappingId) : undefined)
  return selected.every((mapping): mapping is Mapping => mapping !== undefined) ? selected : null
}

export function mixedSources(entries: ImportEntry[], mappings: Mapping[]): boolean {
  const selected = selectedMappings(entries, mappings)
  return selected !== null && new Set(selected.map(mapping => mapping.source)).size > 1
}

export function requestFor(entries: ImportEntry[], mappings: Mapping[]): ImportRequest {
  const selected = selectedMappings(entries, mappings)
  if (!selected || entries.length === 0) throw new Error('Every file needs a compatible mapping.')
  const source = selected[0].source
  if (new Set(selected.map(mapping => mapping.source)).size > 1) throw new Error('Every mapping must use the same source.')
  if (entries.length === 1) {
    return { upload_id: entries[0].upload.upload_id, mapping_id: selected[0].id, source }
  }
  return {
    source,
    files: entries.map((entry, index) => ({ upload_id: entry.upload.upload_id, mapping_id: selected[index].id })),
  }
}

export function totalRecords(entries: ImportEntry[]): number {
  return entries.reduce((total, entry) => total + entry.upload.record_count, 0)
}

export function aggregatePreview(entries: ImportEntry[]): ImportPreview {
  const aggregate: ImportPreview = {
    records: { accepted: 0, partial: 0, rejected: 0, sampled: 0 },
    entities: {},
    rejects: [],
    warnings: {},
    emissions: [],
  }
  for (const entry of entries) {
    if (!entry.preview) continue
    const preview = entry.preview.value
    for (const key of ['accepted', 'partial', 'rejected', 'sampled'] as const) aggregate.records[key] += preview.records[key]
    for (const [key, count] of Object.entries(preview.entities)) {
      const entity = key as keyof typeof aggregate.entities
      aggregate.entities[entity] = (aggregate.entities[entity] ?? 0) + (count ?? 0)
    }
    for (const [key, count] of Object.entries(preview.warnings)) aggregate.warnings[key] = (aggregate.warnings[key] ?? 0) + count
    aggregate.rejects.push(...preview.rejects)
    if (aggregate.emissions.length < 5) aggregate.emissions.push(...preview.emissions.slice(0, 5 - aggregate.emissions.length))
  }
  return aggregate
}

interface PersistedUpload extends Omit<Upload, 'preview'> {}
interface PersistedPreview extends Omit<ImportPreview, 'rejects' | 'emissions'> {}
interface PersistedEntry { upload: PersistedUpload; mappingId: string | null; preview: PersistedPreview | null }
interface PersistedState { version: 2; entries: PersistedEntry[] }

export function serializeImportState(state: ImportState): string {
  const value: PersistedState = {
    version: 2,
    entries: state.entries.map(entry => {
      const { preview: _decodedRecords, ...upload } = entry.upload
      const summary = entry.preview?.value
      return {
        upload,
        mappingId: entry.mappingId,
        preview: summary ? { records: summary.records, entities: summary.entities, warnings: summary.warnings } : null,
      }
    }),
  }
  return JSON.stringify(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function restoreUpload(value: unknown): Upload | null {
  if (!isObject(value) || typeof value.upload_id !== 'string' || typeof value.filename !== 'string'
    || typeof value.sha256 !== 'string' || typeof value.size_bytes !== 'number'
    || (value.format !== 'jsonl' && value.format !== 'parquet') || typeof value.record_count !== 'number') return null
  return {
    upload_id: value.upload_id,
    filename: value.filename,
    sha256: value.sha256,
    size_bytes: value.size_bytes,
    format: value.format,
    record_count: value.record_count,
    preview: Array.isArray(value.preview) ? value.preview as Upload['preview'] : [],
    already_imported: Array.isArray(value.already_imported) ? value.already_imported as Upload['already_imported'] : [],
  }
}

function restorePreview(value: unknown): PreviewState | null {
  if (!isObject(value) || !isObject(value.records) || !isObject(value.entities) || !isObject(value.warnings)) return null
  return {
    value: {
      records: value.records as unknown as ImportPreview['records'],
      entities: value.entities as ImportPreview['entities'],
      warnings: value.warnings as ImportPreview['warnings'],
      rejects: Array.isArray(value.rejects) ? value.rejects as ImportPreview['rejects'] : [],
      emissions: Array.isArray(value.emissions) ? value.emissions as ImportPreview['emissions'] : [],
    },
    detailsAvailable: Array.isArray(value.rejects) || Array.isArray(value.emissions),
  }
}

export function parseStoredImportState(raw: string | null): ImportState {
  if (!raw) return EMPTY_IMPORT_STATE
  try {
    const value: unknown = JSON.parse(raw)
    if (!isObject(value)) return EMPTY_IMPORT_STATE
    if (value.version === 2 && Array.isArray(value.entries)) {
      const entries = value.entries.flatMap(item => {
        if (!isObject(item)) return []
        const upload = restoreUpload(item.upload)
        if (!upload) return []
        return [{ upload, mappingId: typeof item.mappingId === 'string' ? item.mappingId : null, preview: restorePreview(item.preview) }]
      })
      return { entries }
    }

    // v1 was the unversioned page shape: completed pairs plus one current upload.
    const entries: ImportEntry[] = []
    if (Array.isArray(value.batch)) {
      for (const item of value.batch) {
        if (!isObject(item) || !isObject(item.mapping)) continue
        const upload = restoreUpload(item.upload)
        if (!upload || typeof item.mapping.id !== 'string') continue
        entries.push({ upload, mappingId: item.mapping.id, preview: restorePreview(item.preview) })
      }
    }
    const upload = restoreUpload(value.upload)
    if (upload) entries.push({ upload, mappingId: typeof value.mappingId === 'string' && value.mappingId ? value.mappingId : null, preview: null })
    return { entries }
  } catch {
    return EMPTY_IMPORT_STATE
  }
}
