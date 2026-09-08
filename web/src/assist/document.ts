/**
 * The mapping document as addressable *text*: spans over the canonical JSON, and an edit planner
 * that rewrites only the containers an edit touches.
 *
 * Two invariants carry the whole feature:
 *  - a member the user did not edit is copied from the original text character for character, so
 *    `1.0`, `9007199254740993` and an escaped key `"x"` survive any number of edits;
 *  - a batch of edits either applies completely or changes nothing. Sorting splices right to left
 *    is not enough: in `{"a":1,"b":2,"c":3}` the member spans of `b` and `c` both claim the comma
 *    between them. Containers are therefore *rendered* from their member list, innermost first,
 *    with the renderer owning every separator.
 *
 * Offsets are UTF-16 code units (see `jsonGrammar.ts`).
 */
import {
  decodeJsonString,
  isOneJsonValue,
  parseJson,
  validateJsonText,
  type Failure,
  type JsonNode,
} from './jsonGrammar'

/** `['rules', 0, 'fields', 'started_at', 'unit', 'from']`. */
export type DocPath = (string | number)[]

export interface Span {
  start: number
  end: number
}

export interface DocTree {
  text: string
  root: JsonNode
  /** Objects with two members of the same decoded key: unaddressable, sent to the repair view. */
  duplicates: DocPath[]
}

export type DocEdit =
  /** Replace the value at `path`, or create it when only that one member is missing. */
  | { op: 'set'; path: DocPath; raw: string }
  /** Delete the member or element at `path`. */
  | { op: 'remove'; path: DocPath }
  /** Rename the key at `path`; its value is untouched. */
  | { op: 'rename'; path: DocPath; key: string }
  /** Insert a new element into the array at `path`, at `index` of the resulting order. */
  | { op: 'insert'; path: DocPath; index: number; raw: string }
  /** Move the element at `path` to `index` of the resulting order. */
  | { op: 'move'; path: DocPath; index: number }

const samePath = (a: DocPath, b: DocPath) => a.length === b.length && a.every((s, i) => s === b[i])
const under = (path: DocPath, prefix: DocPath) =>
  path.length > prefix.length && prefix.every((s, i) => s === path[i])
const show = (path: DocPath) =>
  path.reduce<string>(
    (out, s) => (typeof s === 'number' ? `${out}[${s}]` : out ? `${out}.${s}` : String(s)),
    '',
  ) || '$'

/** The container an edit rewrites: an insert rewrites its array, everything else its parent. */
const containerOf = (edit: DocEdit): DocPath => (edit.op === 'insert' ? edit.path : edit.path.slice(0, -1))

function collectDuplicates(node: JsonNode, path: DocPath, into: DocPath[]): void {
  if (node.kind === 'object') {
    if (node.duplicateKeys.length > 0) into.push(path)
    for (const member of node.members) collectDuplicates(member.value, [...path, member.key], into)
  } else if (node.kind === 'array') {
    node.elements.forEach((element, index) => collectDuplicates(element, [...path, index], into))
  }
}

/** The span tree of a document, or the first place it stops being one JSON value. */
export function scanDocument(text: string): DocTree | Failure {
  const parsed = parseJson(text)
  if ('problem' in parsed) return parsed
  const duplicates: DocPath[] = []
  collectDuplicates(parsed.root, [], duplicates)
  return { text, root: parsed.root, duplicates }
}

/** True when `path` is, or descends through, an object whose duplicate keys make it unaddressable. */
function underDuplicate(tree: DocTree, path: DocPath): boolean {
  return tree.duplicates.some(duplicate => samePath(duplicate, path) || under(path, duplicate))
}

/** The node at `path`, or null when it is absent or below an unaddressable container. */
export function nodeAt(tree: DocTree, path: DocPath): JsonNode | null {
  if (underDuplicate(tree, path)) return null
  let node: JsonNode = tree.root
  for (const segment of path) {
    if (typeof segment === 'string') {
      if (node.kind !== 'object') return null
      const member = node.members.find(candidate => candidate.key === segment)
      if (member === undefined) return null
      node = member.value
    } else {
      if (node.kind !== 'array') return null
      const element = node.elements[segment]
      if (element === undefined) return null
      node = element
    }
  }
  return node
}

export function valueSpanAt(tree: DocTree, path: DocPath): Span | null {
  const node = nodeAt(tree, path)
  return node === null ? null : { start: node.start, end: node.end }
}

/** The exact source text of the value at `path`. */
export function rawAt(tree: DocTree, path: DocPath): string | null {
  const span = valueSpanAt(tree, path)
  return span === null ? null : tree.text.slice(span.start, span.end)
}

/** The keys of the object at `path`, decoded and as written. */
export function keysAt(
  tree: DocTree,
  path: DocPath,
): { decoded: string; raw: string; span: Span }[] | null {
  const node = nodeAt(tree, path)
  if (node === null || node.kind !== 'object') return null
  return node.members.map(member => ({
    decoded: member.key,
    raw: member.keyRaw,
    span: { start: member.keyStart, end: member.keyEnd },
  }))
}

/** The raw text of the value at `path` inside any raw JSON text (a response envelope), or null. */
export function rawValueOf(rawJson: string, path: DocPath): string | null {
  const tree = scanDocument(rawJson)
  if ('problem' in tree) return null
  return rawAt(tree, path)
}

// --- the edit planner -----------------------------------------------------------------------

interface Layout {
  /** Text between the opening bracket and the first member. */
  opening: string
  /** Text between two members, comma included. */
  separator: string
  /** Text between the last member and the closing bracket. */
  closing: string
}

function layoutOf(text: string, node: JsonNode, depth: number): Layout {
  const spans: Span[] =
    node.kind === 'object'
      ? node.members.map(member => ({ start: member.start, end: member.end }))
      : node.kind === 'array'
        ? node.elements.map(element => ({ start: element.start, end: element.end }))
        : []
  if (spans.length > 0) {
    const opening = text.slice(node.start + 1, spans[0].start)
    const closing = text.slice(spans[spans.length - 1].end, node.end - 1)
    const observed = spans.length > 1 ? text.slice(spans[0].end, spans[1].start) : null
    // one member gives no observed separator: reuse the opening's line break and indent
    return { opening, closing, separator: observed ?? (opening.includes('\n') ? `,${opening}` : ', ') }
  }
  // an empty container about to receive members: the document's own two-space indent
  const indent = '  '.repeat(depth + 1)
  return { opening: `\n${indent}`, separator: `,\n${indent}`, closing: `\n${'  '.repeat(depth)}` }
}

type Rendered = { text: string } | { problem: string }

/** An edit routed to the container it rewrites, with the path of that container. */
interface Routed {
  edit: DocEdit
  container: DocPath
}

function routeDeeper(routed: Routed[], path: DocPath): Map<string | number, Routed[]> {
  const deeper = new Map<string | number, Routed[]>()
  for (const item of routed) {
    if (samePath(item.container, path)) continue
    const next = item.container[path.length]
    deeper.set(next, [...(deeper.get(next) ?? []), item])
  }
  return deeper
}

function renderNode(text: string, node: JsonNode, path: DocPath, routed: Routed[], depth: number): Rendered {
  if (routed.length === 0) return { text: text.slice(node.start, node.end) }
  if (node.kind === 'object') return renderObject(text, node, path, routed, depth)
  if (node.kind === 'array') return renderArray(text, node, path, routed, depth)
  return { problem: `${show(path)} is a value, not a container` }
}

function renderObject(
  text: string,
  node: JsonNode & { kind: 'object' },
  path: DocPath,
  routed: Routed[],
  depth: number,
): Rendered {
  if (node.duplicateKeys.length > 0) {
    return {
      problem: `${show(path)} has two members named ${JSON.stringify(node.duplicateKeys[0])}; repair it in the JSON view first`,
    }
  }
  const layout = layoutOf(text, node, depth)
  const direct = new Map<string, DocEdit[]>()
  for (const item of routed) {
    if (!samePath(item.container, path)) continue
    const key = item.edit.path[path.length]
    if (typeof key !== 'string') {
      return { problem: `${show(path)} is an object; ${JSON.stringify(key)} is not a key` }
    }
    direct.set(key, [...(direct.get(key) ?? []), item.edit])
  }
  const deeper = routeDeeper(routed, path)

  interface Rendition { key: string; verbatim: string | null; keyRaw: string; separator: string; value: string }
  const kept: Rendition[] = []
  for (const member of node.members) {
    const edits = direct.get(member.key) ?? []
    const nested = deeper.get(member.key) ?? []
    for (const edit of edits) {
      if (edit.op === 'insert' || edit.op === 'move') {
        return { problem: `${show([...path, member.key])} is a member, not an array element` }
      }
    }
    if (edits.some(edit => edit.op === 'remove')) continue
    const set = edits.find((edit): edit is Extract<DocEdit, { op: 'set' }> => edit.op === 'set')
    const rename = edits.find((edit): edit is Extract<DocEdit, { op: 'rename' }> => edit.op === 'rename')
    let value: string
    if (set !== undefined) {
      value = set.raw
    } else if (nested.length > 0) {
      const child = renderNode(text, member.value, [...path, member.key], nested, depth + 1)
      if ('problem' in child) return child
      value = child.text
    } else {
      value = text.slice(member.value.start, member.value.end)
    }
    const untouched = set === undefined && rename === undefined && nested.length === 0
    kept.push({
      key: rename !== undefined ? rename.key : member.key,
      keyRaw: rename !== undefined ? JSON.stringify(rename.key) : member.keyRaw,
      separator: text.slice(member.keyEnd, member.value.start),
      value,
      verbatim: untouched ? text.slice(member.start, member.end) : null,
    })
  }

  // a set on a member that does not exist yet creates exactly that one level
  const existing = new Set(node.members.map(member => member.key))
  for (const [key, edits] of direct) {
    if (existing.has(key)) continue
    for (const edit of edits) {
      if (edit.op !== 'set') {
        return { problem: `${show([...path, key])} does not exist, so it cannot be ${edit.op}d` }
      }
      kept.push({ key, keyRaw: JSON.stringify(key), separator: ': ', value: edit.raw, verbatim: null })
    }
  }
  for (const key of deeper.keys()) {
    if (typeof key === 'string' && !existing.has(key)) {
      return { problem: `${show([...path, key])} does not exist; create it in one change, with its value` }
    }
  }

  // a batch must never produce the duplicate-key state we refuse to edit
  const seen = new Set<string>()
  for (const rendition of kept) {
    if (seen.has(rendition.key)) {
      return {
        problem: `this change would leave two members named ${JSON.stringify(rendition.key)} in ${show(path)}`,
      }
    }
    seen.add(rendition.key)
  }

  if (kept.length === 0) return { text: '{}' }
  const body = kept
    .map(rendition => rendition.verbatim ?? `${rendition.keyRaw}${rendition.separator}${rendition.value}`)
    .join(layout.separator)
  return { text: `{${layout.opening}${body}${layout.closing}}` }
}

function renderArray(
  text: string,
  node: JsonNode & { kind: 'array' },
  path: DocPath,
  routed: Routed[],
  depth: number,
): Rendered {
  const layout = layoutOf(text, node, depth)
  const direct = new Map<number, DocEdit[]>()
  const inserts: { index: number; raw: string }[] = []
  for (const item of routed) {
    if (!samePath(item.container, path)) continue
    if (item.edit.op === 'insert') {
      inserts.push({ index: item.edit.index, raw: item.edit.raw })
      continue
    }
    const index = item.edit.path[path.length]
    if (typeof index !== 'number') {
      return { problem: `${show(path)} is an array; ${JSON.stringify(index)} is not an index` }
    }
    if (index < 0 || index >= node.elements.length) {
      return { problem: `${show(path)} has ${node.elements.length} elements; ${index} is out of range` }
    }
    direct.set(index, [...(direct.get(index) ?? []), item.edit])
  }
  const deeper = routeDeeper(routed, path)

  interface Element { text: string; move: number | null }
  const survivors: Element[] = []
  for (let index = 0; index < node.elements.length; index += 1) {
    const element = node.elements[index]
    const edits = direct.get(index) ?? []
    const nested = deeper.get(index) ?? []
    if (edits.some(edit => edit.op === 'rename')) {
      return { problem: `${show([...path, index])} is an array element; it has no key` }
    }
    if (edits.some(edit => edit.op === 'remove')) continue
    const set = edits.find((edit): edit is Extract<DocEdit, { op: 'set' }> => edit.op === 'set')
    const move = edits.find((edit): edit is Extract<DocEdit, { op: 'move' }> => edit.op === 'move')
    let rendered: string
    if (set !== undefined) {
      rendered = set.raw
    } else if (nested.length > 0) {
      const child = renderNode(text, element, [...path, index], nested, depth + 1)
      if ('problem' in child) return child
      rendered = child.text
    } else {
      rendered = text.slice(element.start, element.end)
    }
    survivors.push({ text: rendered, move: move !== undefined ? move.index : null })
  }
  for (const key of deeper.keys()) {
    if (typeof key !== 'number' || key < 0 || key >= node.elements.length) {
      return { problem: `${show(path)} has no element ${JSON.stringify(key)}` }
    }
  }

  // remove → move → insert, all against the resulting order; a contested index aborts the batch
  const ordered = survivors.filter(element => element.move === null)
  const claimed = new Set<number>()
  for (const element of survivors) {
    if (element.move === null) continue
    if (element.move < 0 || element.move > ordered.length) {
      return { problem: `${show(path)} cannot move an element to index ${element.move}` }
    }
    if (claimed.has(element.move)) return { problem: `${show(path)}: two changes claim index ${element.move}` }
    claimed.add(element.move)
    ordered.splice(element.move, 0, element)
  }
  for (const insert of inserts) {
    if (insert.index < 0 || insert.index > ordered.length) {
      return { problem: `${show(path)} cannot insert at index ${insert.index}` }
    }
    if (claimed.has(insert.index)) return { problem: `${show(path)}: two changes claim index ${insert.index}` }
    claimed.add(insert.index)
    ordered.splice(insert.index, 0, { text: insert.raw, move: null })
  }

  if (ordered.length === 0) return { text: '[]' }
  const body = ordered.map(element => element.text).join(layout.separator)
  return { text: `[${layout.opening}${body}${layout.closing}]` }
}

/**
 * Apply a batch as one operation: every path addresses the input snapshot, conflicting edits abort
 * the whole batch, and the result is re-validated before it is returned. On a problem the caller
 * keeps the document it had — nothing is partially applied.
 */
export function planEdits(text: string, edits: DocEdit[]): { text: string } | { problem: string } {
  if (edits.length === 0) return { text }
  const tree = scanDocument(text)
  if ('problem' in tree) return { problem: `the document is not valid JSON: ${tree.problem}` }

  for (const edit of edits) {
    if (edit.path.length === 0 && edit.op !== 'insert') {
      return { problem: 'the whole document cannot be replaced this way' }
    }
    if (underDuplicate(tree, edit.path)) {
      return {
        problem: `${show(edit.path)} is inside a section with duplicate keys; repair it in the JSON view first`,
      }
    }
    if ((edit.op === 'set' || edit.op === 'insert') && !isOneJsonValue(edit.raw)) {
      return { problem: `${show(edit.path)}: ${JSON.stringify(edit.raw)} is not one JSON value` }
    }
  }
  for (let i = 0; i < edits.length; i += 1) {
    for (let j = i + 1; j < edits.length; j += 1) {
      const both = edits[i].op === 'insert' && edits[j].op === 'insert'
      if (!both && samePath(edits[i].path, edits[j].path)) {
        return { problem: `${show(edits[i].path)} is changed twice in one batch` }
      }
    }
  }
  // an edit inside a value this batch replaces or removes would be discarded by its ancestor
  for (const ancestor of edits) {
    if (ancestor.op !== 'set' && ancestor.op !== 'remove') continue
    for (const edit of edits) {
      if (edit === ancestor) continue
      const container = containerOf(edit)
      if (samePath(container, ancestor.path) || under(container, ancestor.path)) {
        return {
          problem: `${show(edit.path)} is inside ${show(ancestor.path)}, which this batch replaces or removes`,
        }
      }
    }
  }

  const routed: Routed[] = edits.map(edit => ({ edit, container: containerOf(edit) }))
  const rendered = renderNode(text, tree.root, [], routed, 0)
  if ('problem' in rendered) return rendered
  const next = text.slice(0, tree.root.start) + rendered.text + text.slice(tree.root.end)
  const valid = validateJsonText(next)
  if ('problem' in valid) return { problem: `the change would not produce valid JSON (${valid.problem})` }
  return { text: next }
}

/** One line a person can read before a suggestion is applied. */
export function describeEdits(edits: DocEdit[]): string {
  return edits
    .map(edit => {
      if (edit.op === 'set') return `set ${show(edit.path)} to ${edit.raw}`
      if (edit.op === 'remove') return `remove ${show(edit.path)}`
      if (edit.op === 'rename') return `rename ${show(edit.path)} to ${JSON.stringify(edit.key)}`
      if (edit.op === 'insert') return `insert ${edit.raw} into ${show(edit.path)} at ${edit.index}`
      return `move ${show(edit.path)} to ${edit.index}`
    })
    .join('; ')
}

export { decodeJsonString, showPath }

function showPath(path: DocPath): string {
  return show(path)
}
