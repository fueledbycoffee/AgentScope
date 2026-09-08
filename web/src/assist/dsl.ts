/**
 * The DSL's closed domains, as `mapping-dsl-v1.schema.json` declares them, plus the two lookups
 * the table needs over an indexed document. Kept out of the component files so that editing a
 * domain is a data change, not a change to a rendered surface.
 */
import { asString, type DocIndex, type Member, type RuleView } from './documentIndex'

export const OPTION_DOMAINS = {
  type: ['string', 'integer', 'number', 'boolean', 'timestamp'],
  timestamp_format: ['iso8601', 'epoch_s', 'epoch_ms'],
  bounds: ['min', 'max'],
  empty_as_missing: ['true', 'false'],
  on_missing: ['null', 'default', 'reject'],
  on_invalid: ['null', 'reject'],
} as const
export type EnumOption = keyof typeof OPTION_DOMAINS

export const UNITS = ['ns', 'us', 'ms', 's', 'min'] as const
export const ENUM_MAP_POLICIES = ['keep', 'null', 'reject'] as const
export const ENTITIES = ['session', 'model_call', 'tool_call'] as const
export const CONDITION_OPS = ['eq', 'ne', 'in', 'not_in', 'exists', 'not_exists'] as const
export const INPUT_FORMATS = ['jsonl', 'parquet'] as const
/** `exists` and `not_exists` ignore a value; the member is removed rather than disabled. */
export const VALUELESS_OPS = new Set<string>(['exists', 'not_exists'])

/** `"epoch_s"` → `epoch_s`; a boolean or a number stays exactly as written. */
export function plain(member: Member): string {
  if (member.raw === null) return ''
  return member.raw.startsWith('"') ? (JSON.parse(member.raw) as string) : member.raw
}

/** Rules that name this one as their parent; a rename or a delete has to account for them. */
export function referrers(index: DocIndex, ruleId: string | null): RuleView[] {
  if (ruleId === null) return []
  return index.rules.filter(other => asString(other.parent) === ruleId)
}

/**
 * The rules the parser accepts as a parent of *this* rule: only a `tool_call` may declare one, and
 * it must be a `model_call` rule whose `select` is exactly `$`, declared before the rule that uses
 * it (`domain/mapping/parser.py:304-333`). A rule of any other entity is offered nothing, rather
 * than a pairing the parser answers with `parent_not_allowed`.
 */
export function parentChoices(index: DocIndex, rule: RuleView): RuleView[] {
  if (asString(rule.entity) !== 'tool_call') return []
  return index.rules.filter(
    other =>
      other.index < rule.index &&
      asString(other.entity) === 'model_call' &&
      (asString(other.select) ?? '$') === '$' &&
      asString(other.id) !== null,
  )
}
