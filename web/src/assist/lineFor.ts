/** Best-effort: the line that holds the last segment of an issue path, so "jump" lands near it. */
export function lineFor(text: string, path: string): number | null {
  const segment = path.split(/[.[\]]/).filter(Boolean).at(-1)
  if (!segment || /^\d+$/.test(segment)) return null
  const lines = text.split('\n')
  const index = lines.findIndex(line => line.includes(`"${segment}"`))
  return index === -1 ? null : index + 1
}

