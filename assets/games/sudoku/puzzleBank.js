// Curated puzzle sets extracted from the reference app (sudoku.xapk) - 100
// puzzles per variant per difficulty level, replacing the old runtime
// backtracking generator entirely (real puzzles, generated instantly).
import { loadProgress } from './puzzleProgress.js'

const BANKS = {}
let banksReady = null

// No bundler here, so JSON banks are fetched at runtime instead of
// statically imported - call this once (awaited) before using anything
// else in this module.
export function loadBanks(baseUrl) {
  if (banksReady) return banksReady
  const names = ['classic', 'cross', 'jigsaw', 'inequality']
  banksReady = Promise.all(names.map(n =>
    fetch(baseUrl + 'puzzles/' + n + '.json').then(r => r.json()).then(data => { BANKS[n] = data })
  ))
  return banksReady
}

export const DIFF_LEVELS = { easy: 1, medium: 2, hard: 3, expert: 4, extreme: 5 }

const SIZE = 9
const CELLS = SIZE * SIZE

function toDigits(str) {
  return str.split('').map(Number)
}

function boxRegions() {
  const regions = new Array(CELLS)
  for (let i = 0; i < CELLS; i++) {
    const r = Math.floor(i / SIZE), c = i % SIZE
    regions[i] = Math.floor(r / 3) * 3 + Math.floor(c / 3)
  }
  return regions
}

// Encoding (verified against the reference app's solved grids): '1' at
// (r,c) means the cell must be greater than its right/bottom neighbor,
// '2' means less than. Every adjacent pair is marked (no '0' gaps within
// the meaningful range) - only the padding column/row is '0'.
function decodeInequalities(hStr, vStr) {
  const h = toDigits(hStr)
  const v = toDigits(vStr)
  const edges = new Map()
  function addEdge(a, b, aGreater) {
    if (!edges.has(a)) edges.set(a, [])
    if (!edges.has(b)) edges.set(b, [])
    edges.get(a).push({ other: b, mustBeGreater: aGreater })
    edges.get(b).push({ other: a, mustBeGreater: !aGreater })
  }
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 8; c++) {
      const code = h[r * 9 + c]
      if (code) addEdge(r * 9 + c, r * 9 + c + 1, code === 1)
    }
  }
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 9; c++) {
      const code = v[r * 9 + c]
      if (code) addEdge(r * 9 + c, (r + 1) * 9 + c, code === 1)
    }
  }
  return edges
}

function buildPuzzle(variant, entry) {
  const [questionStr, answerStr, extra1, extra2] = entry
  const puzzle = toDigits(questionStr)
  const solution = toDigits(answerStr)

  if (variant === 'jigsaw') {
    return { puzzle, solution, regions: toDigits(extra1), useDiagonals: false, inequalities: null }
  }
  if (variant === 'inequality') {
    return { puzzle, solution, regions: boxRegions(), useDiagonals: false, inequalities: decodeInequalities(extra1, extra2) }
  }
  return { puzzle, solution, regions: boxRegions(), useDiagonals: variant === 'cross', inequalities: null }
}

export function getBankSize(variant, difficulty) {
  const level = DIFF_LEVELS[difficulty] ?? DIFF_LEVELS.medium
  return BANKS[variant][level].length
}

export function getPuzzleAt(difficulty, variant, index) {
  const level = DIFF_LEVELS[difficulty] ?? DIFF_LEVELS.medium
  return { index, ...buildPuzzle(variant, BANKS[variant][level][index]) }
}

// "New game" picks a random puzzle that hasn't been played yet (status
// undefined in the saved progress map) so working through a difficulty
// naturally covers the full set before anything repeats; once every puzzle
// has at least been started, it falls back to picking among all of them.
export function pickRandomIndex(difficulty, variant) {
  const level = DIFF_LEVELS[difficulty] ?? DIFF_LEVELS.medium
  const size = BANKS[variant][level].length
  const progress = loadProgress(variant, level)
  const unplayed = []
  for (let i = 0; i < size; i++) if (!progress[i]) unplayed.push(i)
  const pool = unplayed.length ? unplayed : Array.from({ length: size }, (_, i) => i)
  return pool[Math.floor(Math.random() * pool.length)]
}

export function getPuzzle(difficulty, variant) {
  return getPuzzleAt(difficulty, variant, pickRandomIndex(difficulty, variant))
}
