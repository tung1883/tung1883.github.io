// Puzzles themselves come from the curated bank (puzzleBank.js, extracted
// from the reference app) - this module just keeps the shared bits that
// still apply at runtime regardless of where a puzzle came from: the
// variant list and live conflict checking for the UI.

const SIZE = 9
const CELLS = SIZE * SIZE

function idx(r, c) { return r * SIZE + c }

export const VARIANTS = ['classic', 'jigsaw', 'cross', 'inequality']

// For live conflict highlighting in the UI.
export function hasConflict(values, r, c, ctx) {
  const i = idx(r, c)
  const val = values[i]
  if (!val) return false
  for (let k = 0; k < 9; k++) {
    if (k !== c && values[idx(r, k)] === val) return true
    if (k !== r && values[idx(k, c)] === val) return true
  }
  const region = ctx.regions[i]
  for (let k = 0; k < CELLS; k++) {
    if (k !== i && ctx.regions[k] === region && values[k] === val) return true
  }
  if (ctx.useDiagonals) {
    if (r === c) {
      for (let k = 0; k < 9; k++) if (k !== r && values[idx(k, k)] === val) return true
    }
    if (r + c === 8) {
      for (let k = 0; k < 9; k++) if (k !== r && values[idx(k, 8 - k)] === val) return true
    }
  }
  if (ctx.inequalities) {
    const edges = ctx.inequalities.get(i)
    if (edges) {
      for (const { other, mustBeGreater } of edges) {
        const otherVal = values[other]
        if (!otherVal) continue
        if (mustBeGreater && !(val > otherVal)) return true
        if (!mustBeGreater && !(val < otherVal)) return true
      }
    }
  }
  return false
}
