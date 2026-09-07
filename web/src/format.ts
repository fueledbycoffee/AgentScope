export const PAGE_SIZE = 50
export const display = (value: string | number | boolean | null | undefined) =>
  value == null ? 'Unavailable' : String(value)
