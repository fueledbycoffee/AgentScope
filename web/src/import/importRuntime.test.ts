import { describe, expect, it } from 'vitest'
import type { ImportPreview, Mapping, Upload } from '../api'
import {
  aggregatePreview, clampStep, duplicateHashes, highestReachableStep, importReducer, mappingCandidates, mixedSources,
  parseStoredImportState, requestFor, requestedStep, serializeImportState,
} from './importRuntime'

const upload = (id = 'upl_1', sha256 = 'a'.repeat(64)): Upload => ({
  upload_id: id,
  filename: `${id}.jsonl`,
  sha256,
  size_bytes: 12,
  format: 'jsonl',
  record_count: 3,
  preview: [{ locator: 'line:1', payload: { secret: 'not persisted' } }],
  already_imported: [],
})
const mapping = (id = 'map_1', revision = 1, created_by = 'bundled'): Mapping => ({
  id,
  name: 'trace-v1',
  source: 'trace',
  revision,
  created_by,
  input_format: 'jsonl',
})
const preview: ImportPreview = {
  records: { accepted: 2, partial: 0, rejected: 1, ignored: 0, sampled: 3 },
  entities: { session: 2 },
  rejects: [{ locator: 'line:3', rule_id: 'session', path: '$', code: 'bad', field: null, message: 'bad' }],
  warnings: { absent: 1 },
  emissions: [{ entity: 'session', path: '$', locator: 'line:1', fields: { private: 'not persisted' } }],
}

describe('guided import runtime', () => {
  it('clamps query steps to prerequisites', () => {
    expect(requestedStep(new URLSearchParams('step=9'))).toBe(4)
    expect(requestedStep(new URLSearchParams('step=nope'))).toBe(1)
    const one = { entries: [{ upload: upload(), mappingId: null, preview: null }] }
    expect(highestReachableStep(one, [mapping()])).toBe(2)
    expect(clampStep(4, one, [mapping()])).toBe(2)
  })

  it('clamps duplicate file bytes to File so the batch can be corrected', () => {
    const state = { entries: [
      { upload: upload(), mappingId: 'map_1', preview: { value: preview, detailsAvailable: true } },
      { upload: upload('upl_2'), mappingId: 'map_1', preview: { value: preview, detailsAvailable: true } },
    ] }

    expect(highestReachableStep(state, [mapping()])).toBe(1)
    expect(clampStep(4, state, [mapping()])).toBe(1)
  })

  it('clamps mixed mapping sources to Mapping so the batch can be corrected', () => {
    const otherSource = { ...mapping('map_other'), name: 'other', source: 'other' }
    const state = { entries: [
      { upload: upload(), mappingId: 'map_1', preview: { value: preview, detailsAvailable: true } },
      { upload: upload('upl_2', 'b'.repeat(64)), mappingId: 'map_other', preview: null },
    ] }

    expect(highestReachableStep(state, [mapping(), otherSource])).toBe(2)
    expect(clampStep(3, state, [mapping(), otherSource])).toBe(2)
  })

  it('a stored mapping id that no longer resolves drops the entry to Mapping', () => {
    const state = { entries: [{ upload: upload(), mappingId: 'deleted', preview: { value: preview, detailsAvailable: true } }] }
    const reconciled = importReducer(state, { type: 'reconcile', mappings: [mapping()] })
    expect(reconciled.entries[0]).toMatchObject({ mappingId: null, preview: null })
    expect(highestReachableStep(reconciled, [mapping()])).toBe(2)
  })

  it('changing one mapping invalidates only that file preview', () => {
    const state = { entries: [
      { upload: upload(), mappingId: 'map_1', preview: { value: preview, detailsAvailable: true } },
      { upload: upload('upl_2', 'b'.repeat(64)), mappingId: 'map_1', preview: { value: preview, detailsAvailable: true } },
    ] }
    const changed = importReducer(state, { type: 'mapping', uploadId: 'upl_2', mappingId: 'map_2' })
    expect(changed.entries[0].preview).not.toBeNull()
    expect(changed.entries[1].preview).toBeNull()
  })

  it('adding or removing a file invalidates the aggregate preview gate', () => {
    const first = { upload: upload(), mappingId: 'map_1', preview: { value: preview, detailsAvailable: true } }
    const second = { upload: upload('upl_2', 'b'.repeat(64)), mappingId: 'map_1', preview: { value: preview, detailsAvailable: true } }
    const added = importReducer({ entries: [first] }, { type: 'add', entries: [second] })
    expect(added.entries.every(entry => entry.preview === null)).toBe(true)
    const removed = importReducer({ entries: [first, second] }, { type: 'remove', uploadId: 'upl_2' })
    expect(removed.entries).toHaveLength(1)
    expect(removed.entries[0].preview).toBeNull()
  })

  it('orders current bundled mappings first and badges superseded revisions', () => {
    const candidates = mappingCandidates(upload(), [mapping('old', 1), mapping('current', 2), { ...mapping('user', 3, 'user'), name: 'other' }])
    expect(candidates.map(candidate => [candidate.mapping.id, candidate.recommended, candidate.superseded])).toEqual([
      ['current', true, false], ['user', false, false], ['old', false, true],
    ])
  })

  it('blocks repeated bytes and builds the unchanged request bodies', () => {
    const mappings = [mapping(), { ...mapping('map_2'), name: 'trace-v2' }]
    const first = { upload: upload(), mappingId: 'map_1', preview: null }
    const second = { upload: upload('upl_2'), mappingId: 'map_2', preview: null }
    expect(duplicateHashes([first, second])).toBe(true)
    expect(requestFor([first], mappings)).toEqual({ upload_id: 'upl_1', mapping_id: 'map_1', source: 'trace' })
    expect(requestFor([first, { ...second, upload: upload('upl_2', 'b'.repeat(64)) }], mappings)).toEqual({
      source: 'trace', files: [{ upload_id: 'upl_1', mapping_id: 'map_1' }, { upload_id: 'upl_2', mapping_id: 'map_2' }],
    })
    const otherSource = { ...mapping('map_other'), name: 'other', source: 'other' }
    expect(mixedSources([first, { ...second, upload: upload('upl_2', 'b'.repeat(64)), mappingId: 'map_other' }], [...mappings, otherSource])).toBe(true)
    expect(() => requestFor([first, { ...second, upload: upload('upl_2', 'b'.repeat(64)), mappingId: 'map_other' }], [...mappings, otherSource])).toThrow('same source')
  })

  it('persists only receipt and count data, not decoded records or sample rows', () => {
    const state = { entries: [{ upload: upload(), mappingId: 'map_1', preview: { value: preview, detailsAvailable: true } }] }
    const raw = serializeImportState(state)
    expect(raw).not.toContain('not persisted')
    expect(raw).not.toContain('rejects')
    expect(raw).not.toContain('emissions')
    const restored = parseStoredImportState(raw)
    expect(restored.entries[0].upload.preview).toEqual([])
    expect(restored.entries[0].preview).toMatchObject({ detailsAvailable: false, value: { records: preview.records } })
  })

  it('aggregates exact counts and keeps only the first five emissions', () => {
    const many = {
      ...preview,
      records: { ...preview.records, ignored: 1 },
      emissions: Array.from({ length: 4 }, (_, index) => ({ entity: 'session', path: '$', locator: `line:${index}`, fields: {} })),
    }
    const result = aggregatePreview([])
    expect(result.records.sampled).toBe(0)
    const aggregate = aggregatePreview([
      { upload: upload(), mappingId: 'map_1', preview: { value: many, detailsAvailable: true } },
      { upload: upload('upl_2'), mappingId: 'map_1', preview: { value: many, detailsAvailable: true } },
    ])
    expect(aggregate.records).toEqual({ accepted: 4, partial: 0, rejected: 2, ignored: 2, sampled: 6 })
    expect(aggregate.entities.session).toBe(4)
    expect(aggregate.emissions).toHaveLength(5)
  })
})
