// Per-puzzle progress (which of the 100 puzzles in a variant/difficulty
// bucket are done / in progress / untouched), keyed by the puzzle's index
// within its bank list - persisted so the picker and resume-in-place both
// survive a page reload.
const keyFor = (variant, level) => `sudoku_progress:${variant}:${level}`

export function loadProgress(variant, level) {
  try { return JSON.parse(localStorage.getItem(keyFor(variant, level))) || {} }
  catch { return {} }
}

// entry: { status: 'inprogress' | 'done', values, notes, seconds }
// notes must already be plain arrays (Sets aren't JSON-serializable).
export function saveProgress(variant, level, index, entry) {
  const all = loadProgress(variant, level)
  all[index] = entry
  localStorage.setItem(keyFor(variant, level), JSON.stringify(all))
}

export function getEntry(variant, level, index) {
  return loadProgress(variant, level)[index] ?? null
}
