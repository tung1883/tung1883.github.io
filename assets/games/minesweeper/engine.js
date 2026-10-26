// Original implementation - renders using the classic sprite100.gif sheet
// (sprite positions reverse-engineered from a reference build, see
// minesweeper.css) but the game logic and DOM handling below are our own,
// not vendored/third-party code.

const DIFFICULTIES = {
  beginner:     { rows: 9,  cols: 9,  mines: 10 },
  intermediate: { rows: 16, cols: 16, mines: 40 },
  expert:       { rows: 16, cols: 30, mines: 99 },
}

export function initMinesweeper(root, { onWin } = {}) {
  let state = {
    difficulty: 'expert',
    rows: 16, cols: 30, mines: 99,
    grid: [],
    gameOver: false,
    won: false,
    started: false,
    timerInterval: null,
    seconds: 0,
    leftDown: false,
    rightDown: false,
  }

  const $ = (sel) => root.querySelector(sel)

  // Flat index of cell elements, built once per newGame() - avoids an
  // expensive querySelector('[data-r][data-c]') scan on every single cell
  // repaint (that was the main cause of sluggish reveals on larger boards).
  let cellEls = []

  // ── Board construction (border frame + header + rows), sprite classes only ──

  // Every sprite-rendered piece shares the "ms-sprite" base class (sets
  // background-image once in CSS); the specific class only needs to set
  // background-position/width/height.
  function div(cls) {
    const el = document.createElement('div')
    el.className = 'ms-sprite ' + cls
    return el
  }

  // Plain (non-sprite) layout wrapper, e.g. row containers.
  function plainDiv(cls) {
    const el = document.createElement('div')
    el.className = cls
    return el
  }

  function digitTrio(prefix) {
    const wrap = document.createDocumentFragment()
    for (const suffix of ['h', 't', 'o']) {
      const d = div('time0')
      d.id = prefix + '-' + suffix
      wrap.appendChild(d)
    }
    return wrap
  }

  function buildBoard() {
    const game = $('#game')
    const gameContainer = $('#game-container')
    game.innerHTML = ''
    cellEls = new Array(state.rows * state.cols)
    const { rows, cols } = state

    // Border pieces are 10px (corners/joints) or 16px (top/bottom tiles);
    // side pieces (borderlr) are 10px each - total width matches a board
    // row (10 + cols*16 + 10). Fixing this explicitly is what lets the
    // header row's "space-between" below actually spread across the full
    // board width instead of shrink-wrapping its own small content.
    const boardWidth = cols * 16 + 20
    game.style.width = boardWidth + 'px'
    gameContainer.style.width = boardWidth + 'px'

    const topRow = document.createDocumentFragment()
    topRow.appendChild(div('bordertl'))
    for (let c = 0; c < cols; c++) topRow.appendChild(div('bordertb'))
    topRow.appendChild(div('bordertr'))
    game.appendChild(wrapRow(topRow))

    const headerLeft = plainDiv('ms-header-group')
    headerLeft.appendChild(div('borderlrlong'))
    headerLeft.appendChild(digitTrio('mines'))

    const face = div('facesmile')
    face.id = 'face-btn'

    const headerRight = plainDiv('ms-header-group')
    headerRight.appendChild(digitTrio('secs'))
    headerRight.appendChild(div('borderlrlong'))

    const headerRow = plainDiv('ms-row ms-header-row')
    headerRow.appendChild(headerLeft)
    headerRow.appendChild(face)
    headerRow.appendChild(headerRight)
    game.appendChild(headerRow)

    const jointRow = document.createDocumentFragment()
    jointRow.appendChild(div('borderjointl'))
    for (let c = 0; c < cols; c++) jointRow.appendChild(div('bordertb'))
    jointRow.appendChild(div('borderjointr'))
    game.appendChild(wrapRow(jointRow))

    for (let r = 0; r < rows; r++) {
      const rowFrag = document.createDocumentFragment()
      rowFrag.appendChild(div('borderlr'))
      for (let c = 0; c < cols; c++) {
        const cell = div('blank')
        cell.dataset.r = r
        cell.dataset.c = c
        cellEls[r * cols + c] = cell
        rowFrag.appendChild(cell)
      }
      rowFrag.appendChild(div('borderlr'))
      game.appendChild(wrapRow(rowFrag))
    }

    const bottomRow = document.createDocumentFragment()
    bottomRow.appendChild(div('borderbl'))
    for (let c = 0; c < cols; c++) bottomRow.appendChild(div('bordertb'))
    bottomRow.appendChild(div('borderbr'))
    game.appendChild(wrapRow(bottomRow))
  }

  // Each row of the sprite layout is a horizontal run of same-height pieces;
  // wrapping each run in its own flex row keeps rows stacked vertically.
  function wrapRow(fragment) {
    const row = plainDiv('ms-row')
    row.appendChild(fragment)
    return row
  }

  // ── Digit / face rendering ──────────────────────────────────────────────

  function setDigits(prefix, n) {
    const clamped = Math.max(-99, Math.min(999, n))
    const negative = clamped < 0
    const abs = Math.abs(clamped)
    const str = String(abs).padStart(negative ? 2 : 3, '0')
    const digits = negative ? ['-', ...str.split('')] : str.split('')
    const suffixes = ['h', 't', 'o']
    digits.slice(-3).forEach((d, i) => {
      const el = $('#' + prefix + '-' + suffixes[i])
      if (el) el.className = 'ms-sprite time' + d
    })
  }

  function setFace(cls) {
    const face = $('#face-btn')
    if (face) face.className = 'ms-sprite ' + cls
  }

  function cellClass(cell) {
    if (!cell.revealed) {
      if (cell.wrongFlag) return 'bombmisflagged'
      if (cell.flagged) return 'bombflagged'
      return 'blank'
    }
    if (cell.mine) return cell.exploded ? 'bombdeath' : 'bombrevealed'
    return 'open' + cell.count
  }

  function idx(r, c) { return r * state.cols + c }
  function inBounds(r, c) { return r >= 0 && r < state.rows && c >= 0 && c < state.cols }

  function paintCell(r, c) {
    const el = cellEls[idx(r, c)]
    if (!el) return
    const g = state.grid[idx(r, c)]
    el.className = 'ms-sprite ' + cellClass(g)
  }

  function paintAll() {
    for (let r = 0; r < state.rows; r++)
      for (let c = 0; c < state.cols; c++)
        paintCell(r, c)
  }

  // Repaint only specific cells - reveals/chords normally touch a handful
  // of cells, not the whole board, and repainting all 480 on every click
  // (especially two in a row from a double-click) is exactly what made
  // interaction feel sluggish.
  function paintCells(coords) {
    for (const [r, c] of coords) paintCell(r, c)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function neighbors(r, c) {
    const out = []
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if ((dr || dc) && inBounds(r + dr, c + dc)) out.push([r + dr, c + dc])
    return out
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
  }

  // ── Mine placement ───────────────────────────────────────────────────────

  function placeMines(safeR, safeC) {
    const { rows, cols, mines } = state
    const safe = new Set([idx(safeR, safeC)])
    for (const [nr, nc] of neighbors(safeR, safeC)) safe.add(idx(nr, nc))

    const pool = []
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (!safe.has(idx(r, c))) pool.push(idx(r, c))

    shuffle(pool)
    const mineSet = new Set(pool.slice(0, mines))

    const grid = Array.from({ length: rows * cols }, (_, i) => ({
      mine: mineSet.has(i), revealed: false, flagged: false,
      exploded: false, wrongFlag: false, count: 0,
    }))

    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (!grid[idx(r, c)].mine)
          grid[idx(r, c)].count = neighbors(r, c).filter(([nr, nc]) => grid[idx(nr, nc)].mine).length

    return grid
  }

  // ── Game control ─────────────────────────────────────────────────────────

  function newGame() {
    clearInterval(state.timerInterval)
    const d = DIFFICULTIES[state.difficulty]
    Object.assign(state, { ...d, grid: [], gameOver: false, won: false, started: false, seconds: 0 })
    buildBoard()
    setDigits('mines', d.mines)
    setDigits('secs', 0)
    setFace('facesmile')
  }

  function setDifficulty(d) {
    state.difficulty = d
    newGame()
  }

  function startTimer() {
    state.seconds = 0
    setDigits('secs', 0)
    state.timerInterval = setInterval(() => {
      state.seconds = Math.min(state.seconds + 1, 999)
      setDigits('secs', state.seconds)
    }, 1000)
  }

  function updateMineCount() {
    const flagged = state.grid.filter(c => c.flagged).length
    setDigits('mines', state.mines - flagged)
  }

  function floodReveal(r, c) {
    const touched = []
    const stack = [[r, c]]
    while (stack.length) {
      const [cr, cc] = stack.pop()
      const cell = state.grid[idx(cr, cc)]
      if (cell.revealed || cell.flagged || cell.mine) continue
      cell.revealed = true
      touched.push([cr, cc])
      if (cell.count === 0)
        for (const [nr, nc] of neighbors(cr, cc))
          if (!state.grid[idx(nr, nc)].revealed) stack.push([nr, nc])
    }
    return touched
  }

  function endGame() {
    state.gameOver = true
    clearInterval(state.timerInterval)
    setFace('facedead')
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        const cell = state.grid[idx(r, c)]
        if (cell.mine && !cell.flagged) cell.revealed = true
        if (!cell.mine && cell.flagged) cell.wrongFlag = true
      }
    }
    paintAll()
  }

  function checkWin() {
    if (state.grid.some(c => !c.mine && !c.revealed)) return
    state.won = true
    clearInterval(state.timerInterval)
    setFace('facewin')
    state.grid.forEach(c => { if (c.mine) c.flagged = true })
    setDigits('mines', 0)
    paintAll()
    onWin?.(state.difficulty, state.seconds)
  }

  // ── Events ───────────────────────────────────────────────────────────────

  function targetCell(e) {
    const el = e.target.closest('[data-r]')
    if (!el) return null
    return { r: +el.dataset.r, c: +el.dataset.c, el }
  }

  function onMouseDown(e) {
    if (state.gameOver || state.won) return
    if (e.button === 0) {
      state.leftDown = true
      const t = targetCell(e)
      setFace(t ? 'faceooh' : (e.target.id === 'face-btn' ? 'facepressed' : 'facesmile'))
    }
    if (e.button === 2) state.rightDown = true
  }

  function onMouseUp() {
    state.leftDown = false
    state.rightDown = false
    if (!state.gameOver && !state.won) setFace('facesmile')
  }

  // Reveal fires on mouseup, not click - matching classic Minesweeper (press
  // down, drag to preview, release over whichever cell you want). Native
  // "click" only fires when mousedown and mouseup land on the exact same
  // element, so any fast movement between press and release (very common on
  // small cells) would silently drop the input entirely.
  function onGameMouseUp(e) {
    if (e.button !== 0) return
    if (state.gameOver || state.won) return
    const t = targetCell(e)
    if (!t) return
    reveal(t.r, t.c)
  }

  function onFaceClick() {
    newGame()
  }

  function onContextMenu(e) {
    e.preventDefault()
    if (state.gameOver || state.won) return
    const t = targetCell(e)
    if (!t) return
    const cell = state.grid[idx(t.r, t.c)]
    if (cell.revealed) return
    cell.flagged = !cell.flagged
    updateMineCount()
    paintCell(t.r, t.c)
  }

  function reveal(r, c) {
    if (!state.started) {
      state.grid = placeMines(r, c)
      state.started = true
      startTimer()
    }

    const cell = state.grid[idx(r, c)]

    if (cell.revealed && cell.count > 0) {
      const nbrs = neighbors(r, c)
      const flagCount = nbrs.filter(([nr, nc]) => state.grid[idx(nr, nc)].flagged).length
      if (flagCount !== cell.count) return
      let hitMine = false
      const touched = []
      for (const [nr, nc] of nbrs) {
        const n = state.grid[idx(nr, nc)]
        if (n.revealed || n.flagged) continue
        if (n.mine) { n.revealed = true; n.exploded = true; hitMine = true; touched.push([nr, nc]) }
        else touched.push(...floodReveal(nr, nc))
      }
      if (hitMine) { endGame(); return }
      checkWin()
      if (!state.won) paintCells(touched)
      return
    }

    if (cell.revealed || cell.flagged) return

    if (cell.mine) {
      cell.revealed = true
      cell.exploded = true
      endGame()
      return
    }

    const touched = floodReveal(r, c)
    checkWin()
    if (!state.won) paintCells(touched)
  }

  function onGameClick(e) {
    if (e.target.id === 'face-btn') onFaceClick()
  }

  function onKeyDown(e) {
    if (e.key === 'F2') newGame()
    if (e.key === '1')  setDifficulty('beginner')
    if (e.key === '2')  setDifficulty('intermediate')
    if (e.key === '3')  setDifficulty('expert')
  }

  const game = $('#game')
  game.addEventListener('mousedown', onMouseDown)
  document.addEventListener('mouseup', onMouseUp)
  game.addEventListener('mouseup', onGameMouseUp)
  game.addEventListener('contextmenu', onContextMenu)
  game.addEventListener('click', onGameClick)
  document.addEventListener('keydown', onKeyDown)

  newGame()

  return {
    newGame,
    setDifficulty,
    destroy() {
      clearInterval(state.timerInterval)
      game.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mouseup', onMouseUp)
      game.removeEventListener('mouseup', onGameMouseUp)
      game.removeEventListener('contextmenu', onContextMenu)
      game.removeEventListener('click', onGameClick)
      document.removeEventListener('keydown', onKeyDown)
    },
  }
}
