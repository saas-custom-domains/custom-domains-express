import { timingSafeEqual } from 'node:crypto'

// Constant-time comparison, so response timing doesn't reveal how
// close a guess was. An unset secret never matches: otherwise
// String(undefined) would make "undefined" a valid token.
export function safeEqual(given, expected) {
  if (!expected) return false
  const a = Buffer.from(String(given ?? ''))
  const b = Buffer.from(String(expected))
  return a.length === b.length && timingSafeEqual(a, b)
}
