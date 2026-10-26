// Vanilla-JS render layer around engine.js's pure game-logic functions
// (the original is a React component; engine.js itself has no DOM code).
import { newGame, move, spawnTile, isGameOver, WIN_VALUE } from "./engine.js";

const GAP_PCT = 2.5;
const CELL_PCT = (100 - 5 * GAP_PCT) / 4;

function cellRect(row, col) {
  const top = GAP_PCT + row * (CELL_PCT + GAP_PCT);
  const left = GAP_PCT + col * (CELL_PCT + GAP_PCT);
  return { top: top + "%", left: left + "%", width: CELL_PCT + "%", height: CELL_PCT + "%" };
}

function tilePosStyle(row, col) {
  const topPct = GAP_PCT + row * (CELL_PCT + GAP_PCT);
  const leftPct = GAP_PCT + col * (CELL_PCT + GAP_PCT);
  const ty = (topPct / CELL_PCT) * 100;
  const tx = (leftPct / CELL_PCT) * 100;
  return "width:" + CELL_PCT + "%;height:" + CELL_PCT + "%;transform:translate(" + tx + "%," + ty + "%);";
}

function tileClass(value) {
  return "g2048-tile-" + (value <= WIN_VALUE ? value : "super");
}

const KEY_DIRS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
const BEST_KEY = "2048_best_score";

function loadBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; }
}
function recordBest(score) {
  const best = loadBest();
  if (score > best) { try { localStorage.setItem(BEST_KEY, String(score)); } catch (e) {} return score; }
  return best;
}

export function init2048(root) {
  root.innerHTML =
    '<div class="g2048-container">' +
      '<div class="g2048-game" tabindex="-1">' +
        '<div class="g2048-grid"></div>' +
        '<div class="g2048-tiles"></div>' +
      "</div>" +
      '<div class="g2048-side">' +
        '<div class="g2048-score-box"><span class="g2048-score-label">score</span><span data-score>0</span></div>' +
        '<div class="g2048-score-box"><span class="g2048-score-label">best</span><span data-best>0</span></div>' +
        '<button type="button" class="g2048-restart" data-restart title="New game" aria-label="New game"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 4v16M4 12h16"/></svg></button>' +
      "</div>" +
    "</div>";

  const grid = root.querySelector(".g2048-grid");
  const tilesEl = root.querySelector(".g2048-tiles");
  const gameEl = root.querySelector(".g2048-game");
  const scoreEl = root.querySelector("[data-score]");
  const bestEl = root.querySelector("[data-best]");

  for (let i = 0; i < 16; i++) {
    const cell = document.createElement("div");
    cell.className = "g2048-cell";
    const r = cellRect(Math.floor(i / 4), i % 4);
    cell.style.cssText = "top:" + r.top + ";left:" + r.left + ";width:" + r.width + ";height:" + r.height + ";";
    grid.appendChild(cell);
  }

  let tiles = newGame();
  let score = 0;
  let best = loadBest();
  let won = false, keepPlaying = false, gameOver = false;
  let settleTimer = null, pendingSettle = null;

  bestEl.textContent = best;

  // One DOM node per tile id, kept across moves: updating its transform lets
  // the CSS transition slide it, and nothing is rebuilt per move.
  const nodes = new Map();

  function paint(list) {
    const live = new Set();
    list.forEach(function (t) {
      live.add(t.id);
      let pos = nodes.get(t.id);
      let tile;
      if (!pos) {
        pos = document.createElement("div");
        pos.className = "g2048-tile-pos";
        tile = document.createElement("div");
        pos.appendChild(tile);
        tilesEl.appendChild(pos);
        nodes.set(t.id, pos);
      } else {
        tile = pos.firstChild;
      }
      pos.style.cssText = tilePosStyle(t.row, t.col);
      const cls = "g2048-tile " + tileClass(t.value) +
        (t.isNew ? " g2048-tile-new" : "") + (t.mergedFrom ? " g2048-tile-merged" : "");
      if (tile.className !== cls) tile.className = cls;
      const text = String(t.value);
      if (tile.textContent !== text) tile.textContent = text;
    });
    nodes.forEach(function (pos, id) {
      if (!live.has(id)) { pos.remove(); nodes.delete(id); }
    });
  }

  function clearOverlay() {
    const existing = root.querySelector(".g2048-message");
    if (existing) existing.remove();
  }

  function showMessage(text, won_) {
    clearOverlay();
    const msg = document.createElement("div");
    msg.className = "g2048-message" + (won_ ? " g2048-won" : "");
    const p = document.createElement("p");
    p.textContent = text;
    msg.appendChild(p);
    const lower = document.createElement("div");
    lower.className = "g2048-message-lower";
    if (won_) {
      const keepBtn = document.createElement("button");
      keepBtn.textContent = "Keep going";
      keepBtn.addEventListener("click", function () { keepPlaying = true; clearOverlay(); });
      lower.appendChild(keepBtn);
    }
    const retryBtn = document.createElement("button");
    retryBtn.textContent = "Try again";
    retryBtn.addEventListener("click", restart);
    lower.appendChild(retryBtn);
    msg.appendChild(lower);
    gameEl.appendChild(msg);
  }

  function restart() {
    tiles = newGame();
    score = 0;
    won = false; keepPlaying = false; gameOver = false; pendingSettle = null;
    scoreEl.textContent = "0";
    clearOverlay();
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    nodes.clear();
    tilesEl.innerHTML = "";
    paint(tiles);
  }

  function handleMove(direction) {
    // A move during the slide finishes the previous one instantly instead of
    // being dropped, so fast input never feels ignored.
    if (pendingSettle) pendingSettle();
    if (gameOver || (won && !keepPlaying)) return;
    const res = move(tiles, direction);
    if (!res.moved) return;

    function settle() {
      const withSpawn = spawnTile(res.tiles);
      if (res.scoreGain > 0) {
        score += res.scoreGain;
        scoreEl.textContent = score;
        best = recordBest(score);
        bestEl.textContent = best;
      }
      if (!won && withSpawn.some(function (t) { return t.value >= WIN_VALUE; })) {
        won = true;
        showMessage("You win!", true);
      }
      if (isGameOver(withSpawn)) {
        gameOver = true;
        showMessage("Game over!", false);
      }
      tiles = withSpawn;
      paint(tiles);
    }

    if (res.vanished.length === 0) { settle(); return; }
    const transitional = res.tiles.map(function (t) { return t.mergedFrom ? Object.assign({}, t, { mergedFrom: null }) : t; });
    paint(transitional.concat(res.vanished));
    pendingSettle = function () {
      clearTimeout(settleTimer);
      settleTimer = null;
      pendingSettle = null;
      settle();
    };
    settleTimer = setTimeout(pendingSettle, 100);
  }

  function onKeyDown(e) {
    if (root.style.display === "none" || !document.body.contains(root)) return;
    const dir = KEY_DIRS[e.key];
    if (!dir) return;
    e.preventDefault();
    handleMove(dir);
  }
  document.addEventListener("keydown", onKeyDown);

  root.querySelector("[data-restart]").addEventListener("click", restart);

  paint(tiles);

  return {
    restart: restart,
    destroy: function () { document.removeEventListener("keydown", onKeyDown); }
  };
}
