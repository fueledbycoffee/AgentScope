import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The class behind one bug, not just the bug.
 *
 * A formatter returns a string, so seeding a reducer with one turns every
 * addition into concatenation: two uploads of 1,024 and 2,048 bytes printed
 * `010242048 B` instead of `3,072 B`. That slipped in through a mechanical
 * `toLocaleString` → `num` migration, and a scan is the only thing that keeps
 * the next mechanical edit honest — types cannot, because `string + number` is
 * legal JavaScript.
 */

const FORMATTERS = 'num|display|abbreviate|decimal|formatExactText'
/** `reduce(…, num(0))` — a formatted seed. */
const SEED = new RegExp(`\\.reduce\\([^;]*?,\\s*(?:${FORMATTERS})\\(`, 's')
/** `num(a) - b`, `n * display(x)`, `total += num(x)` — arithmetic on a string. */
const ARITHMETIC = new RegExp(
  `(?:${FORMATTERS})\\([^()]*\\)[ \\t]*(?:[-*%]|\\+=|/(?![/*]))|(?:[-*%]|/(?![/*]))[ \\t]*(?:${FORMATTERS})\\(`,
)

/** Comments mention these functions and use `*` and `/`; only code is scanned. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function sourceFiles(): string[] {
  // Vitest runs from web/, and under jsdom import.meta.url is not a file URL.
  const root = join(process.cwd(), 'src')
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(path)
    }
  }
  walk(root)
  return found
}

const relative = (path: string) => path.replace(/.*\/src\//, 'src/')

describe('a formatted value is never used as a number', () => {
  it('finds the files it is meant to scan', () => {
    const files = sourceFiles().map(relative)
    expect(files).toContain('src/format.ts')
    expect(files).toContain('src/pages/Import.tsx')
    expect(files.length).toBeGreaterThan(20)
  })

  it.each([
    ['as a reduce seed', SEED],
    ['as an arithmetic operand', ARITHMETIC],
  ])('is not used %s', (_label, pattern) => {
    const offenders = sourceFiles().filter(path => pattern.test(withoutComments(readFileSync(path, 'utf8'))))
    expect(offenders.map(relative)).toEqual([])
  })

  it('would have caught the bug it exists for', () => {
    expect(SEED.test('const bytes = entries.reduce((total, e) => total + e.size, num(0))')).toBe(true)
    expect(ARITHMETIC.test('const ms = num(end) - num(start)')).toBe(true)
    // and does not fire on the legitimate shapes
    expect(SEED.test('const bytes = num(entries.reduce((total, e) => total + e.size, 0))')).toBe(false)
    expect(ARITHMETIC.test('`${num(count)} of ${num(total)} records`')).toBe(false)
    // and not on a formatter that merely ends a line before a comment block
    expect(ARITHMETIC.test(withoutComments('const n = (v: number) => num(v)\n\n/* next */'))).toBe(false)
  })
})
