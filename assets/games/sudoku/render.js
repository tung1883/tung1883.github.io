// Vanilla-JS port of Sudoku.jsx (full feature parity: 4 variants, puzzle
// bank picker, undo/notes/hint, per-puzzle progress + best times saved to
// localStorage). generator.js / puzzleBank.js / puzzleProgress.js are the
// same logic modules the original React page used, unmodified apart from
// puzzleBank.js now fetching its JSON banks at runtime (no bundler here).
import { hasConflict, VARIANTS } from "./generator.js";
import { getPuzzleAt, getBankSize, pickRandomIndex, DIFF_LEVELS, loadBanks } from "./puzzleBank.js";
import { loadProgress, saveProgress } from "./puzzleProgress.js";

const BASE = "assets/games/sudoku/";

const DIFFS = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
  { id: "expert", label: "Expert" },
  { id: "extreme", label: "Extreme" }
];

const VARIANT_META = {
  classic: { label: "Classic", accent: "#0059b3" },
  jigsaw: { label: "Jigsaw", accent: "#ff8000" },
  cross: { label: "Cross", accent: "#008040" },
  inequality: { label: "Inequality", accent: "#c23b30" }
};

const ICONS = {
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  erase: '<path d="M20 20H9l-5-5a2 2 0 0 1 0-3l8-8a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8"/><path d="M7 11l6 6"/>',
  pencil: '<path d="M4 20l4-1 11-11a2.8 2.8 0 0 0-4-4L4 15z"/><path d="M13 6l4 4"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>'
};
function icon(name) {
  return '<svg class="sk-i" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + "</svg>";
}

function fmtTime(s) {
  if (s === undefined) return "--";
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

const BEST_KEY = "sudoku_best_times";
function loadBestTimes() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch (e) { return {}; }
}
function recordTime(key, seconds) {
  const times = loadBestTimes();
  if (times[key] === undefined || seconds < times[key]) {
    times[key] = seconds;
    try { localStorage.setItem(BEST_KEY, JSON.stringify(times)); } catch (e) {}
  }
  return times;
}

function loadPuzzle(difficulty, variant, index) {
  const level = DIFF_LEVELS[difficulty] ?? DIFF_LEVELS.medium;
  const data = getPuzzleAt(difficulty, variant, index);
  const entry = loadProgress(variant, level)[index];
  const values = entry && entry.values ? entry.values.slice() : data.puzzle.slice();
  const notes = entry && entry.notes
    ? entry.notes.map(function (arr) { return new Set(arr); })
    : Array.from({ length: 81 }, function () { return new Set(); });
  return {
    game: Object.assign({}, data, { values: values, notes: notes }),
    seconds: (entry && entry.seconds) || 0,
    won: entry ? entry.status === "done" : false
  };
}

function inequalitySymbol(game, a, b) {
  const edges = game.inequalities && game.inequalities.get(a);
  const edge = edges && edges.find(function (e) { return e.other === b; });
  if (!edge) return null;
  return edge.mustBeGreater ? ">" : "<";
}

export async function initSudoku(root) {
  await loadBanks(BASE);

  let difficulty = "medium";
  let variant = "classic";
  let initialLoad = loadPuzzle(difficulty, variant, pickRandomIndex(difficulty, variant));
  let game = initialLoad.game;
  let selected = null;
  let noteMode = false;
  let history = [];
  let seconds = initialLoad.seconds;
  let won = initialLoad.won;
  let best = loadBestTimes();
  let showPicker = false;
  let pickerSize = null; // game panel box, so the picker keeps the same footprint
  let pickerVariant = "classic";
  let pickerDifficulty = "medium";
  let timerInterval = null;

  root.innerHTML =
    '<div class="sk-page">' +
      '<div class="sk-panel">' +
        '<div class="sk-head">' +
          '<div class="sk-head-top">' +
            '<div class="sk-title"><span data-variant></span><span class="sk-sub" data-sub></span></div>' +
            '<div class="sk-head-right">' +
              '<b class="sk-time" data-time></b>' +
              '<button type="button" class="sk-action-btn sk-sm" data-open-picker>Puzzles</button>' +
            "</div>" +
          "</div>" +
          '<div class="sk-bar"><i data-bar></i></div>' +
          '<div class="sk-head-foot"><span><span data-filled></span> / 81 cells filled</span><span>best <span data-best></span></span></div>' +
        "</div>" +
        '<div class="sk-layout">' +
          '<div class="sk-shell"><div class="sk-board" data-board></div></div>' +
          '<div class="sk-controls">' +
            '<div class="sk-keypad" data-keypad></div>' +
            '<div class="sk-actions">' +
              '<button type="button" class="sk-action-btn" data-undo>' + icon("undo") + "undo<kbd>z</kbd></button>" +
              '<button type="button" class="sk-action-btn" data-erase>' + icon("erase") + "erase<kbd>bksp</kbd></button>" +
              '<button type="button" class="sk-action-btn" data-notes>' + icon("pencil") + "notes<kbd>n</kbd></button>" +
              '<button type="button" class="sk-action-btn" data-hint>' + icon("bulb") + "hint<kbd>h</kbd></button>" +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="sk-won" data-won style="display:none">' +
          '<div class="sk-won-ring">' + icon("check") + "</div>" +
          '<div class="sk-won-text"><b>Solved in <span data-won-time></span></b><small>best <span data-won-best></span></small></div>' +
          '<button type="button" class="sk-won-next" data-next>next' + icon("arrow") + "</button>" +
        "</div>" +
      "</div>" +
      '<div class="sk-picker-page" data-picker-overlay style="display:none"></div>' +
    "</div>";

  const page = root.querySelector(".sk-page");
  const gamePanel = root.querySelector(".sk-panel");
  const variantEl = root.querySelector("[data-variant]");
  const subEl = root.querySelector("[data-sub]");
  const timeEl = root.querySelector("[data-time]");
  const barEl = root.querySelector("[data-bar]");
  const filledEl = root.querySelector("[data-filled]");
  const bestEl = root.querySelector("[data-best]");
  const boardEl = root.querySelector("[data-board]");
  const keypadEl = root.querySelector("[data-keypad]");
  const wonEl = root.querySelector("[data-won]");
  const pickerOverlay = root.querySelector("[data-picker-overlay]");
  const undoBtn = root.querySelector("[data-undo]");
  const eraseBtn = root.querySelector("[data-erase]");
  const notesBtn = root.querySelector("[data-notes]");
  const hintBtn = root.querySelector("[data-hint]");
  const keyEls = [];

  for (let n = 1; n <= 9; n++) {
    const key = document.createElement("button");
    key.type = "button";
    key.className = "sk-key";
    key.appendChild(document.createTextNode(n));
    key.appendChild(document.createElement("small"));
    key.addEventListener("click", function () { inputDigit(n); });
    keypadEl.appendChild(key);
    keyEls[n] = key;
  }
  eraseBtn.addEventListener("click", erase);
  hintBtn.addEventListener("click", hint);
  undoBtn.addEventListener("click", undo);
  notesBtn.addEventListener("click", function () { noteMode = !noteMode; renderAll(); });
  root.querySelector("[data-open-picker]").addEventListener("click", openPicker);
  root.querySelector("[data-next]").addEventListener("click", function () {
    selectPuzzle(pickRandomIndex(difficulty, variant), difficulty, variant);
  });

  function bestKey() { return variant + ":" + difficulty; }

  function pushHistory() {
    history.push({ values: game.values.slice(), notes: game.notes.map(function (s) { return new Set(s); }) });
  }

  function isSolved(values) {
    return values.every(function (v, i) { return v === game.solution[i]; });
  }

  function persist(values, notes, secondsValue) {
    const level = DIFF_LEVELS[difficulty] ?? DIFF_LEVELS.medium;
    saveProgress(variant, level, game.index, {
      status: isSolved(values) ? "done" : "inprogress",
      values: values,
      notes: notes.map(function (s) { return Array.from(s); }),
      seconds: secondsValue
    });
  }

  function checkWin(values) {
    if (isSolved(values)) {
      won = true;
      best = recordTime(bestKey(), seconds);
      stopTimer();
    }
  }

  function inputDigit(d) {
    if (selected === null || won) return;
    if (game.puzzle[selected] !== 0) return;
    pushHistory();
    const values = game.values.slice();
    const notes = game.notes.map(function (s) { return new Set(s); });
    if (noteMode) {
      if (values[selected] === 0) {
        const set = notes[selected];
        if (set.has(d)) set.delete(d); else set.add(d);
      }
    } else {
      values[selected] = d;
      notes[selected].clear();
    }
    game = Object.assign({}, game, { values: values, notes: notes });
    checkWin(values);
    persist(values, notes, seconds);
    renderAll();
  }

  function erase() {
    if (selected === null || won) return;
    if (game.puzzle[selected] !== 0) return;
    pushHistory();
    const values = game.values.slice();
    const notes = game.notes.map(function (s) { return new Set(s); });
    values[selected] = 0;
    notes[selected].clear();
    game = Object.assign({}, game, { values: values, notes: notes });
    persist(values, notes, seconds);
    renderAll();
  }

  function hint() {
    if (selected === null || won) return;
    if (game.puzzle[selected] !== 0) return;
    pushHistory();
    const values = game.values.slice();
    const notes = game.notes.map(function (s) { return new Set(s); });
    values[selected] = game.solution[selected];
    notes[selected].clear();
    game = Object.assign({}, game, { values: values, notes: notes });
    checkWin(values);
    persist(values, notes, seconds);
    renderAll();
  }

  function undo() {
    if (!history.length) return;
    const prev = history.pop();
    game = Object.assign({}, game, { values: prev.values, notes: prev.notes });
    persist(prev.values, prev.notes, seconds);
    renderAll();
  }

  function selectCell(i) {
    selected = i;
    renderAll();
  }

  function moveSelection(key) {
    const i = selected ?? 0;
    let r = Math.floor(i / 9), c = i % 9;
    if (key === "ArrowUp") r = Math.max(0, r - 1);
    if (key === "ArrowDown") r = Math.min(8, r + 1);
    if (key === "ArrowLeft") c = Math.max(0, c - 1);
    if (key === "ArrowRight") c = Math.min(8, c + 1);
    selected = r * 9 + c;
    renderAll();
  }

  function onKeyDown(e) {
    if (root.offsetParent === null) return; // panel hidden
    if (showPicker) { if (e.key === "Escape") closePicker(); return; }
    if (e.key >= "1" && e.key <= "9") inputDigit(Number(e.key));
    else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") erase();
    else if (e.key === "z") undo();
    else if (e.key === "n") { noteMode = !noteMode; renderAll(); }
    else if (e.key === "h") hint();
    else if (e.key === "Escape") { selected = null; renderAll(); }
    else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.key) !== -1) {
      e.preventDefault();
      moveSelection(e.key);
    }
  }
  document.addEventListener("keydown", onKeyDown);

  function startTimer() {
    stopTimer();
    timerInterval = setInterval(function () {
      if (won) return;
      seconds++;
      timeEl.textContent = fmtTime(seconds);
    }, 1000);
  }
  function stopTimer() { clearInterval(timerInterval); timerInterval = null; }

  function renderHeader() {
    const bankSize = getBankSize(variant, difficulty);
    const diffLabel = (DIFFS.find(function (d) { return d.id === difficulty; }) || {}).label || difficulty;
    const filled = game.values.filter(Boolean).length;
    variantEl.textContent = VARIANT_META[variant].label + " (" + diffLabel + ")";
    subEl.textContent = "#" + (game.index + 1) + "/" + bankSize;
    timeEl.textContent = fmtTime(seconds);
    barEl.style.width = (filled / 81 * 100) + "%";
    filledEl.textContent = filled;
    bestEl.textContent = fmtTime(best[bestKey()]);
  }

  function renderKeypad() {
    for (let n = 1; n <= 9; n++) {
      const left = 9 - game.values.filter(function (v) { return v === n; }).length;
      keyEls[n].classList.toggle("sk-key-done", left <= 0);
      keyEls[n].lastChild.textContent = left > 0 ? left : "";
    }
  }

  function renderBoard() {
    page.style.setProperty("--sk-accent", VARIANT_META[variant].accent);
    boardEl.innerHTML = "";
    const selRow = selected === null ? null : Math.floor(selected / 9);
    const selCol = selected === null ? null : selected % 9;
    const selVal = selected === null ? null : game.values[selected];
    const ctx = { regions: game.regions, useDiagonals: game.useDiagonals, inequalities: game.inequalities };

    game.values.forEach(function (val, i) {
      const r = Math.floor(i / 9), c = i % 9;
      const isGiven = game.puzzle[i] !== 0;
      const isSelected = i === selected;
      const isPeer = selected !== null && (r === selRow || c === selCol || game.regions[i] === game.regions[selected]);
      const isSameValue = selVal && val === selVal;
      const conflict = val !== 0 && hasConflict(game.values, r, c, ctx);
      const onDiagonal = game.useDiagonals && (r === c || r + c === 8);
      const leftNeighbor = c > 0 ? game.regions[i - 1] : null;
      const topNeighbor = r > 0 ? game.regions[i - 9] : null;
      const rightNeighbor = c < 8 ? i + 1 : null;
      const bottomNeighbor = r < 8 ? i + 9 : null;

      const cls = ["sk-cell"];
      if (isGiven) cls.push("sk-given");
      if (isSelected) cls.push("sk-selected");
      if (!isSelected && isPeer) cls.push("sk-peer");
      if (!isSelected && isSameValue) cls.push("sk-samevalue");
      if (conflict) cls.push("sk-conflict");
      if (onDiagonal) cls.push("sk-diagonal");
      if (c === 0 || leftNeighbor !== game.regions[i]) cls.push("sk-boxleft");
      if (r === 0 || topNeighbor !== game.regions[i]) cls.push("sk-boxtop");

      const cell = document.createElement("div");
      cell.className = cls.join(" ");
      cell.addEventListener("click", function () { selectCell(i); });

      if (val !== 0) {
        cell.textContent = val;
      } else if (game.notes[i].size > 0) {
        const notes = document.createElement("div");
        notes.className = "sk-notes";
        for (let n = 1; n <= 9; n++) {
          const span = document.createElement("span");
          span.textContent = game.notes[i].has(n) ? n : "";
          notes.appendChild(span);
        }
        cell.appendChild(notes);
      }

      if (variant === "inequality") {
        if (rightNeighbor !== null) {
          const sym = inequalitySymbol(game, i, rightNeighbor);
          if (sym) {
            const s = document.createElement("span");
            s.className = "sk-ineq sk-ineq-right";
            s.textContent = sym;
            cell.appendChild(s);
          }
        }
        if (bottomNeighbor !== null) {
          const sym = inequalitySymbol(game, i, bottomNeighbor);
          if (sym) {
            const s = document.createElement("span");
            s.className = "sk-ineq sk-ineq-bottom";
            s.textContent = sym;
            cell.appendChild(s);
          }
        }
      }

      boardEl.appendChild(cell);
    });
  }

  function renderAll() {
    renderHeader();
    renderBoard();
    renderKeypad();
    undoBtn.disabled = history.length === 0;
    notesBtn.classList.toggle("active", noteMode);
    if (won) {
      wonEl.style.display = "flex";
      root.querySelector("[data-won-time]").textContent = fmtTime(seconds);
      root.querySelector("[data-won-best]").textContent = fmtTime(best[bestKey()]);
    } else {
      wonEl.style.display = "none";
    }
  }

  function openPicker() {
    pickerVariant = variant;
    pickerDifficulty = difficulty;
    showPicker = true;
    const gr = gamePanel.getBoundingClientRect();
    pickerSize = gr.width ? { w: gr.width, h: gr.height } : null;
    gamePanel.style.display = "none";
    renderPicker();
  }
  function closePicker() {
    showPicker = false;
    gamePanel.style.display = "";
    pickerOverlay.style.display = "none";
    pickerOverlay.innerHTML = "";
  }

  function selectPuzzle(index, diff, vari) {
    const loaded = loadPuzzle(diff, vari, index);
    difficulty = diff;
    variant = vari;
    game = loaded.game;
    selected = null;
    history = [];
    seconds = loaded.seconds;
    won = loaded.won;
    closePicker();
    if (!won) startTimer(); else stopTimer();
    renderAll();
  }

  function bucketDone(v, d) {
    const progress = loadProgress(v, DIFF_LEVELS[d]);
    const size = getBankSize(v, d);
    let done = 0;
    for (let i = 0; i < size; i++) if (progress[i] && progress[i].status === "done") done++;
    return { done: done, size: size };
  }

  // Left: type list + hardness rows (each with a solved meter).
  // Right: that bucket's puzzle numbers, scrollable.
  function renderPicker() {
    if (!showPicker) { pickerOverlay.style.display = "none"; return; }
    pickerOverlay.style.display = "block";
    const accent = VARIANT_META[pickerVariant].accent;

    const panel = document.createElement("div");
    panel.className = "sk-picker-panel";
    panel.style.setProperty("--sk-accent", accent);
    if (pickerSize) {
      panel.style.width = pickerSize.w + "px";
      panel.style.height = pickerSize.h + "px";
    }

    const header = document.createElement("div");
    header.className = "sk-picker-header";
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "sk-action-btn sk-sm";
    backBtn.innerHTML = icon("back") + "Go back";
    backBtn.addEventListener("click", closePicker);
    header.appendChild(backBtn);
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "Puzzles";
    header.appendChild(title);
    panel.appendChild(header);

    const body = document.createElement("div");
    body.className = "sk-picker-body";
    const left = document.createElement("div");
    left.className = "sk-picker-left";
    const right = document.createElement("div");
    right.className = "sk-picker-right";

    // left: type list, then hardness rows with their own solved meters
    const typeLabel = document.createElement("div");
    typeLabel.className = "sk-picker-label";
    typeLabel.textContent = "type";
    left.appendChild(typeLabel);
    const typeList = document.createElement("div");
    typeList.className = "sk-picker-list";
    VARIANTS.forEach(function (v) {
      let total = 0;
      DIFFS.forEach(function (d) { total += bucketDone(v, d.id).done; });
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sk-picker-vrow" + (v === pickerVariant ? " on" : "");
      row.style.setProperty("--vc", VARIANT_META[v].accent);
      row.innerHTML = '<i></i>' + VARIANT_META[v].label + '<em>' + total + '</em>';
      row.addEventListener("click", function () { pickerVariant = v; renderPicker(); });
      typeList.appendChild(row);
    });
    left.appendChild(typeList);

    const diffLabelEl = document.createElement("div");
    diffLabelEl.className = "sk-picker-label";
    diffLabelEl.textContent = "level";
    left.appendChild(diffLabelEl);
    const diffList = document.createElement("div");
    diffList.className = "sk-picker-list";
    DIFFS.forEach(function (d) {
      const b = bucketDone(pickerVariant, d.id);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sk-picker-drow" + (d.id === pickerDifficulty ? " on" : "");
      row.innerHTML = '<span><b>' + d.label + '</b><small>' + b.done + '/' + b.size + '</small></span>' +
        '<span class="sk-picker-meter"><i style="width:' + (b.size ? b.done / b.size * 100 : 0) + '%"></i></span>';
      row.addEventListener("click", function () { pickerDifficulty = d.id; renderPicker(); });
      diffList.appendChild(row);
    });
    left.appendChild(diffList);

    // numbers
    const level = DIFF_LEVELS[pickerDifficulty];
    const progress = loadProgress(pickerVariant, level);
    const cur = bucketDone(pickerVariant, pickerDifficulty);
    const diffLabel = DIFFS.find(function (d) { return d.id === pickerDifficulty; }).label;
    const rhead = document.createElement("div");
    rhead.className = "sk-picker-rhead";
    rhead.innerHTML = "<b>" + VARIANT_META[pickerVariant].label + " / " + diffLabel + "</b><small>" + cur.done + " / " + cur.size + " solved</small>";
    right.appendChild(rhead);
    const meter = document.createElement("div");
    meter.className = "sk-picker-meter";
    meter.innerHTML = '<i style="width:' + (cur.size ? cur.done / cur.size * 100 : 0) + '%"></i>';
    right.appendChild(meter);

    const grid = document.createElement("div");
    grid.className = "sk-picker-grid";
    for (let i = 0; i < cur.size; i++) {
      const status = progress[i] && progress[i].status;
      const isCurrent = pickerVariant === variant && pickerDifficulty === difficulty && i === game.index;
      const btn = document.createElement("button");
      btn.type = "button";
      const cls = ["sk-picker-item"];
      if (status === "done") cls.push("sk-picker-done");
      if (status === "inprogress") cls.push("sk-picker-inprogress");
      if (isCurrent) cls.push("sk-picker-current");
      btn.className = cls.join(" ");
      btn.textContent = i + 1;
      btn.addEventListener("click", function () { selectPuzzle(i, pickerDifficulty, pickerVariant); });
      grid.appendChild(btn);
    }
    right.appendChild(grid);

    const legend = document.createElement("div");
    legend.className = "sk-picker-legend";
    legend.innerHTML =
      '<span><i class="sk-lg-done"></i>solved</span>' +
      '<span><i class="sk-lg-prog"></i>in progress</span>' +
      '<span><i class="sk-lg-new"></i>new</span>';
    right.appendChild(legend);

    body.appendChild(left);
    body.appendChild(right);
    panel.appendChild(body);

    pickerOverlay.innerHTML = "";
    pickerOverlay.appendChild(panel);
  }

  startTimer();
  renderAll();

  return {
    destroy: function () {
      document.removeEventListener("keydown", onKeyDown);
      stopTimer();
    }
  };
}
