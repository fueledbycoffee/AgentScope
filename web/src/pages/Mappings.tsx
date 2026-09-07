import { useCallback, useState } from 'react'
import { getMapping, listMappings } from '../api'
import type { Mapping } from '../api'
import { DataTable, IconButton, JsonText, StateBlock } from '../components'
import type { Column } from '../components'
import { useFileBar } from '../shellHooks'
import { useResource } from '../useResource'

function Document({ id }: { id: string }) {
  const resource = useResource(useCallback(() => getMapping(id), [id]))
  return <StateBlock loading={resource.loading} error={resource.error} retry={resource.retry} lines={4}>
    {resource.data && <>
      {resource.data.issues.length > 0 && <p style={{ color: 'var(--warn)' }}>{resource.data.issues.length} validation issue{resource.data.issues.length > 1 ? 's' : ''}</p>}
      <JsonText text={JSON.stringify(resource.data.document, null, 2)} />
    </>}
  </StateBlock>
}

/** Mapping revisions known to the server; editing and the assistant are #13 to #15. */
export default function MappingsPage() {
  const resource = useResource(useCallback(() => listMappings({ limit: 500 }), []))
  const [open, setOpen] = useState<string>()
  useFileBar('Mappings', [])
  const columns: Column<Mapping>[] = [
    { key: 'name', header: 'Name', render: mapping => mapping.name },
    { key: 'revision', header: 'Revision', align: 'num', render: mapping => mapping.revision },
    { key: 'source', header: 'Source', render: mapping => mapping.source },
    { key: 'format', header: 'Reads', render: mapping => mapping.input_format },
    { key: 'by', header: 'Created by', render: mapping => mapping.created_by },
    { key: 'id', header: 'ID', mono: true, render: mapping => mapping.id },
    { key: 'doc', header: 'Document', render: mapping => <IconButton name={open === mapping.id ? 'chevronUp' : 'chevronDown'} label={open === mapping.id ? `Hide document of ${mapping.name}` : `Show document of ${mapping.name}`} className="btn small icon-only" aria-expanded={open === mapping.id} onClick={() => setOpen(open === mapping.id ? undefined : mapping.id)} /> },
  ]
  return <>
    <div className="page-head"><h1>Mappings</h1></div>
    <section className="panel">
      <StateBlock loading={resource.loading} error={resource.error} retry={resource.retry} lines={4}>
        {resource.data && <DataTable caption="Mapping revisions" hideCaption columns={columns} rows={resource.data} rowKey={mapping => mapping.id} empty="No mappings yet." />}
      </StateBlock>
      {open && <div style={{ marginTop: 12 }}><Document id={open} /></div>}
    </section>
  </>
}
