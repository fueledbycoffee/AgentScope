/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')

/**
 * WCAG contrast over an explicit pairing matrix, resolved separately for the
 * light block, the system-dark media block and the explicit dark block, so a
 * broken selector or a token missing from one block fails here.
 */

function block(selector: RegExp): Record<string, string> {
  const match = css.match(selector)
  if (!match) throw new Error(`block not found: ${selector}`)
  const tokens: Record<string, string> = {}
  for (const [, name, value] of match[1].matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) tokens[name] = value
  return tokens
}
const light = block(/:root \{([\s\S]*?)\n\}/)
const systemDark = block(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n\s*\}/)
const explicitDark = block(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)

function luminance(hex: string) {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

// Supported pairings: text token on the surfaces it is used on (base.css), status text on
// its soft background, chip and button text, series fills as graphics against the surface.
const TEXT_PAIRS: [string, string, number][] = [
  ['--ink', '--surface', 4.5], ['--ink', '--surface-2', 4.5], ['--ink', '--surface-3', 4.5], ['--ink', '--bg', 4.5],
  ['--ink-2', '--surface', 4.5], ['--ink-2', '--surface-2', 4.5], ['--ink-2', '--surface-3', 4.5],
  ['--ink-3', '--surface', 4.5], ['--ink-3', '--surface-2', 4.5], ['--ink-3', '--bg', 4.5],
  ['--ink-4', '--surface', 4.5], ['--ink-4', '--bg', 4.5],
  ['--accent', '--surface', 4.5], ['--accent-ink', '--surface', 4.5], ['--accent-ink', '--accent-soft', 4.5],
  ['--ok', '--ok-soft', 4.5], ['--warn', '--warn-soft', 4.5], ['--bad', '--bad-soft', 4.5],
  ['--ok', '--surface', 4.5], ['--warn', '--surface', 4.5], ['--bad', '--surface', 4.5],
]
const GRAPHIC_PAIRS: [string, string, number][] = ['--s1', '--s2', '--s3', '--s4', '--s5'].map(series => [series, '--surface', 3])

describe.each([['light', light], ['system dark', systemDark], ['explicit dark', explicitDark]] as const)('%s theme', (_, tokens) => {
  it('defines every token the pairings use', () => {
    for (const [a, b] of [...TEXT_PAIRS, ...GRAPHIC_PAIRS]) {
      expect(tokens[a], a).toMatch(/^#/)
      expect(tokens[b], b).toMatch(/^#/)
    }
  })
  it.each(TEXT_PAIRS)('%s on %s reads at least %s:1', (fg, bg, minimum) => {
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(minimum)
  })
  it.each(GRAPHIC_PAIRS)('%s on %s reads at least %s:1 as a graphic', (fg, bg, minimum) => {
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(minimum)
  })
  it('the page ground as text on the primary button reads', () => {
    expect(contrast(tokens['--bg'], tokens['--accent'])).toBeGreaterThanOrEqual(4.5)
  })
})

it('the two dark blocks are identical', () => {
  expect(systemDark).toEqual(explicitDark)
})
