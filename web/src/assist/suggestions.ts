/**
 * Ambiguity options turned into edits the user can apply — without ever inferring which edit was
 * meant.
 *
 * The contract the API gives us is thin: `{target, options: string[], what_settles_it}`
 * (`api/types.ts`). An option string alone cannot establish an operation: `reject` is a legal
 * value of both `on_missing` and `on_invalid`, `null` of both and of a literal, `min` of both
 * `bounds` and a unit, `true` of `empty_as_missing` and of a boolean literal. So:
 *
 * - a target that names an option (`rules[0].fields.x.on_invalid`) keeps it, and the value is
 *   matched against that option's domain only;
 * - a target that names only a field always asks the user to pick a named operation, even when
 *   exactly one domain contains the value;
 * - anything else stays prose.
 *
 * Applicability stays the parser's: `bounds` needs a timestamp target and a `[*]` path,
 * `unit.to` must be the target's canonical unit, `type` must equal the target's type
 * (`domain/mapping/parser.py:439-473,498-556`). The browser has no target schema, so a suggestion
 * never claims a change is valid: where the document already contradicts the parser, the entry
 * says so and the server's validation remains the authority.
 */
import type { Ambiguity } from '../api/types'
import type { DocEdit } from './document'
import { asString, type DocIndex, type FieldOption, type FieldView, type RuleView } from './documentIndex'
import { OPTION_DOMAINS, UNITS, type EnumOption } from './dsl'
import { FIELD_OPTIONS } from './documentIndex'
import { resolveIssue } from './issuePaths'

export interface Suggestion {
  id: string
  /** The named operation, so the menu says what it will do. */
  operation: string
  /** `set rules[1].fields.started_at.timestamp_format to "epoch_s"`. */
  description: string
  edits: DocEdit[]
  /** What the parser will say about this document if it is applied; never a refusal. */
  warning: string | null
  /** Why it cannot be offered at all (a missing companion member). */
  blocked: string | null
}

export interface TargetChoice {
  label: string
  ruleIndex: number
  field: string
}

export type Resolution =
  /** `option` is any option the DSL names, not only the ones with a closed domain. */
  | { kind: 'field'; ruleIndex: number; field: string; option: FieldOption | null }
  | { kind: 'choose-rule'; choices: TargetChoice[]; option: FieldOption | null }
  | { kind: 'none' }

/** Every option the DSL names — including the two with no closed domain, `unit` and `default`. */
const OPTION_NAMES = new Set<string>(FIELD_OPTIONS)

function findFields(index: DocIndex, entity: string | null, field: string): TargetChoice[] {
  const found: TargetChoice[] = []
  for (const rule of index.rules) {
    if (entity !== null && asString(rule.entity) !== entity) continue
    if (!rule.fields.some(candidate => candidate.name === field)) continue
    found.push({ label: `${asString(rule.id) ?? `rule ${rule.index + 1}`} · ${field}`, ruleIndex: rule.index, field })
  }
  return found
}

/** Resolve an ambiguity's target to one field (and its option, when the target names one). */
export function resolveTarget(index: DocIndex, target: string): Resolution {
  const trimmed = target.trim()
  if (trimmed === '') return { kind: 'none' }

  if (trimmed.startsWith('rules[')) {
    const control = resolveIssue(trimmed, index)
    if (control.kind !== 'field-option' && control.kind !== 'field-source') return { kind: 'none' }
    // a path is not a promise: the rule and the field have to be in this document
    const rule = index.rules[control.ruleIndex]
    if (rule === undefined || !rule.fields.some(field => field.name === control.field)) return { kind: 'none' }
    return {
      kind: 'field',
      ruleIndex: control.ruleIndex,
      field: control.field,
      option: control.kind === 'field-option' ? control.option : null,
    }
  }

  const parts = trimmed.split('.')
  // `model_call.started_at.timestamp_format`, `model_call.started_at`, or a bare field name
  let option: FieldOption | null = null
  if (parts.length > 1 && OPTION_NAMES.has(parts[parts.length - 1])) {
    option = parts.pop() as FieldOption
  }
  const field = parts.pop()
  if (field === undefined || field === '') return { kind: 'none' }
  const entity = parts.length > 0 ? parts.join('.') : null

  const choices = findFields(index, entity, field)
  if (choices.length === 0) return { kind: 'none' }
  if (choices.length === 1) return { kind: 'field', ruleIndex: choices[0].ruleIndex, field, option }
  return { kind: 'choose-rule', choices, option }
}

const UNIT_PAIR = /^([a-z]+)\s*(?:→|->|to)\s*([a-z]+)$/i

function warningFor(option: EnumOption | 'unit', field: FieldView): string | null {
  if (option === 'bounds') {
    const path = field.source.members.path.raw
    if (path === null) return 'the parser needs a single `path` for bounds; this field has none'
    if (!path.includes('[*]')) return 'the parser will refuse this: bounds needs a path containing [*]'
    return null
  }
  if (option === 'timestamp_format') {
    const declared = asString(field.options.type)
    if (declared !== null && declared !== 'timestamp') return `the parser ignores timestamp_format on a ${declared} field`
    return null
  }
  if (option === 'unit') return 'the parser requires unit.to to be the target field’s canonical unit'
  return null
}

/**
 * Every operation one option string could name on this field. One entry means one click is still
 * required; several mean the user picks which operation was meant. An empty list is prose.
 */
export function suggestionsFor(
  rule: RuleView,
  field: FieldView,
  option: FieldOption | null,
  optionText: string,
): Suggestion[] {
  const text = optionText.trim()
  const ruleName = asString(rule.id) ?? `rule ${rule.index + 1}`
  const at = `${ruleName} · ${field.name}`
  const found: Suggestion[] = []

  const add = (name: EnumOption | 'unit', raw: string, edits: DocEdit[], blocked: string | null = null) => {
    found.push({
      id: `${rule.index}-${field.name}-${name}-${text}`,
      operation: name,
      description: `set ${name} of ${at} to ${raw}`,
      edits,
      warning: warningFor(name, field),
      blocked,
    })
  }

  // `unit` and `default` have no closed domain: a value can only be matched against options that
  // enumerate their legal values, and anything else falls through to the unit pair below or to prose
  const domainsToTry: EnumOption[] =
    option === null
      ? (Object.keys(OPTION_DOMAINS) as EnumOption[])
      : option in OPTION_DOMAINS
        ? [option as EnumOption]
        : [] // `unit` and `default` enumerate nothing: there is no value to match against
  for (const candidate of domainsToTry) {
    const domain = OPTION_DOMAINS[candidate] as readonly string[]
    if (!domain.includes(text)) continue
    const raw = candidate === 'empty_as_missing' ? text : JSON.stringify(text)
    // on_missing: default only means something with a default beside it
    const blocked =
      candidate === 'on_missing' && text === 'default' && field.options.default.raw === null
        ? 'set a default for this field first; on_missing: default has nothing to fall back to'
        : null
    add(candidate, raw, [{ op: 'set', path: field.options[candidate].path, raw }], blocked)
  }

  // a unit needs an ordered pair, so only an explicit one is executable: a bare `min` never is
  const pair = UNIT_PAIR.exec(text)
  if (pair !== null && (option === null || option === 'unit')) {
    const [, from, to] = pair
    if ((UNITS as readonly string[]).includes(from) && (UNITS as readonly string[]).includes(to)) {
      // an existing unit is edited at its members, exactly as the dropdown does: replacing the
      // object would drop anything else it carries, which the parser accepts
      const exists = field.unit.from.raw !== null && field.unit.to.raw !== null
      add(
        'unit',
        JSON.stringify({ from, to }),
        exists
          ? [
              { op: 'set', path: field.unit.from.path, raw: JSON.stringify(from) },
              { op: 'set', path: field.unit.to.path, raw: JSON.stringify(to) },
            ]
          : [{ op: 'set', path: field.options.unit.path, raw: JSON.stringify({ from, to }) }],
      )
    }
  }
  return found
}

/** What an ambiguity offers: chips to apply, a rule to pick first, or prose. */
export type Offer =
  | { kind: 'operations'; ruleIndex: number; field: string; options: { text: string; suggestions: Suggestion[] }[] }
  | { kind: 'choose-rule'; choices: TargetChoice[] }
  | { kind: 'prose' }

export function offerFor(index: DocIndex, ambiguity: Ambiguity, pickedRule?: number): Offer {
  const resolved = resolveTarget(index, ambiguity.target)
  if (resolved.kind === 'none') return { kind: 'prose' }
  if (resolved.kind === 'choose-rule') {
    const picked = pickedRule === undefined ? undefined : resolved.choices.find(choice => choice.ruleIndex === pickedRule)
    if (picked === undefined) return { kind: 'choose-rule', choices: resolved.choices }
    return offerAt(index, ambiguity, picked.ruleIndex, picked.field, resolved.option)
  }
  return offerAt(index, ambiguity, resolved.ruleIndex, resolved.field, resolved.option)
}

function offerAt(index: DocIndex, ambiguity: Ambiguity, ruleIndex: number, fieldName: string, option: FieldOption | null): Offer {
  const rule = index.rules[ruleIndex]
  const field = rule?.fields.find(candidate => candidate.name === fieldName)
  if (rule === undefined || field === undefined) return { kind: 'prose' }
  const options = ambiguity.options
    .map(text => ({ text, suggestions: suggestionsFor(rule, field, option, text) }))
    .filter(entry => entry.suggestions.length > 0)
  if (options.length === 0) return { kind: 'prose' }
  return { kind: 'operations', ruleIndex, field: fieldName, options }
}
