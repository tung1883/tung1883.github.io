// Tile-identity model (each tile is an object with a stable id), not a
// flat value array - this is what the classic 2048 algorithm uses, and
// it's required for smooth sliding animation: React needs a stable key
// per tile to animate its position across a move, which a flat array of
// values can't give you (there's no way to tell "this 4 that was at (0,0)
// slid to (0,2)" apart from "a new 4 appeared at (0,2)").

const SIZE = 4
export const WIN_VALUE = 2048

let nextId = 1

function makeTile(row, col, value) {
  return { id: nextId++, row, col, value, isNew: false, mergedFrom: null }
}

const VECTORS = {
  up:    { dr: -1, dc: 0 },
  down:  { dr: 1, dc: 0 },
  left:  { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
}

// Traversal order matters: tiles closest to the target edge must be
// finalized before tiles behind them are processed, so slides/merges
// cascade correctly in one pass.
function traversalOrder(direction) {
  const rows = [0, 1, 2, 3]
  const cols = [0, 1, 2, 3]
  const { dr, dc } = VECTORS[direction]
  if (dr === 1) rows.reverse()
  if (dc === 1) cols.reverse()
  return { rows, cols }
}

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE
}

function buildGrid(tiles) {
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null))
  for (const t of tiles) grid[t.row][t.col] = t
  return grid
}

export function emptyCells(tiles) {
  const grid = buildGrid(tiles)
  const empties = []
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!grid[r][c]) empties.push(r * SIZE + c)
  return empties
}

export function spawnTile(tiles) {
  const empties = emptyCells(tiles)
  if (!empties.length) return tiles
  const cell = empties[Math.floor(Math.random() * empties.length)]
  const tile = makeTile(Math.floor(cell / SIZE), cell % SIZE, Math.random() < 0.9 ? 2 : 4)
  tile.isNew = true
  return [...tiles, tile]
}

// Rebuilds a saved board ([row, col, value] triples) with fresh tile ids.
export function restoreTiles(list) {
  nextId = 1
  return list.map(([row, col, value]) => makeTile(row, col, value))
}

export function newGame() {
  nextId = 1
  return spawnTile(spawnTile([]))
}

// Ports the standard 2048 move algorithm (find-farthest-then-maybe-merge)
// onto row/col tile objects. Returns fresh tile objects - never mutates
// the input array or its tiles.
export function move(tiles, direction) {
  const { dr, dc } = VECTORS[direction]
  const { rows, cols } = traversalOrder(direction)
  const grid = buildGrid(tiles.map(t => ({ ...t, isNew: false, mergedFrom: null })))
  let moved = false
  let scoreGain = 0
  // Tiles absorbed into a merge, repositioned to the survivor's cell so the
  // caller can render them sliding into place for one frame before dropping
  // them - otherwise the absorbed tile just vanishes instantly instead of
  // visibly sliding, while the survivor (if it also moved) animates for the
  // full transition duration, making the two look out of sync.
  const vanished = []

  for (const r0 of rows) {
    for (const c0 of cols) {
      const tile = grid[r0][c0]
      if (!tile) continue
      grid[r0][c0] = null

      let r = r0, c = c0
      while (inBounds(r + dr, c + dc) && grid[r + dr][c + dc] === null) {
        r += dr; c += dc
      }

      const nr = r + dr, nc = c + dc
      const next = inBounds(nr, nc) ? grid[nr][nc] : null
      if (next && next.value === tile.value && !next.mergedFrom) {
        // Tile merges into `next` (already finalized, closer to the edge)
        // and disappears - the survivor doubles and gets a pop animation.
        next.value *= 2
        next.mergedFrom = [tile.id, next.id]
        scoreGain += next.value
        moved = true
        vanished.push({ ...tile, row: next.row, col: next.col })
      } else {
        tile.row = r
        tile.col = c
        grid[r][c] = tile
        if (r !== r0 || c !== c0) moved = true
      }
    }
  }

  const result = []
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (grid[r][c]) result.push(grid[r][c])
  return { tiles: result, vanished, moved, scoreGain }
}

export function isGameOver(tiles) {
  if (tiles.length < SIZE * SIZE) return false
  const grid = buildGrid(tiles)
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = grid[r][c].value
      if (c < SIZE - 1 && grid[r][c + 1].value === v) return false
      if (r < SIZE - 1 && grid[r + 1][c].value === v) return false
    }
  }
  return true
}
