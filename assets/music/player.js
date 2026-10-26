// Terminal-style audio player. Tracks come from tracks.json next to this
// file: [{ "title": "...", "file": "name.mp3" }, ...].

function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

const VOL_KEY = "music_volume";
const ICON_ON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';

function loadVolume() {
  try {
    const v = Number(localStorage.getItem(VOL_KEY));
    if (localStorage.getItem(VOL_KEY) !== null && v >= 0 && v <= 1) return v;
  } catch (e) {}
  return 0.7;
}

// listRoot gets the numbered track list, playerRoot the controls.
// opts.echo(cmd) prints a command line to the shell when a UI action runs;
// opts.out(text, cls) prints the player's output line. Both are optional.
// The returned exec(args, echo) runs a "vlc <args>" command (typed in the
// shell, or from the UI with echo = true).
export function initMusic(listRoot, playerRoot, opts) {
  opts = opts || {};
  const say = function (text, cls) { if (opts.out) opts.out(text, cls); };
  const audio = new Audio();
  audio.preload = "none";
  let tracks = [];
  let cur = -1;
  let shuffle = false;
  let failed = false;

  listRoot.innerHTML = '<ol class="mp-list"></ol>';
  playerRoot.innerHTML =
    '<div class="mp-term">' +
      '<div class="mp-top"><div class="mp-np"></div>' +
        '<span class="mp-vol"><button type="button" class="mp-mute" data-a="mute" title="Mute" aria-label="Mute"></button>' +
        '<input type="range" min="0" max="100" step="1" aria-label="Volume"></span></div>' +
      '<div class="mp-bar"><span>[</span><div class="mp-track" data-seek>' +
        '<div class="mp-back"></div><div class="mp-fill"></div></div><span>]</span>' +
        '<span class="mp-tm"><span data-cur>0:00</span>/<span data-dur>0:00</span></span></div>' +
      '<div class="mp-cmds">' +
        '<button type="button" data-a="prev">prev</button>' +
        '<button type="button" data-a="play">play</button>' +
        '<button type="button" data-a="next">next</button>' +
        '<button type="button" data-a="shuffle">shuffle</button>' +
        '<button type="button" data-a="stop">stop</button>' +
      "</div>" +
    "</div>";

  const listEl = listRoot.querySelector(".mp-list");
  const term = playerRoot.querySelector(".mp-term");
  const npEl = playerRoot.querySelector(".mp-np");
  const fillEl = playerRoot.querySelector(".mp-fill");
  const backEl = playerRoot.querySelector(".mp-back");
  const curEl = playerRoot.querySelector("[data-cur]");
  const durEl = playerRoot.querySelector("[data-dur]");
  const playBtn = playerRoot.querySelector('[data-a="play"]');
  const shuffleBtn = playerRoot.querySelector('[data-a="shuffle"]');
  // Long runs of characters, clipped by the track's width, so the bar fills
  // whatever space the panel has.
  const muteBtn = playerRoot.querySelector(".mp-mute");
  const volEl = playerRoot.querySelector(".mp-vol input");
  let volume = loadVolume();
  let muted = false;

  function drawVolume() {
    audio.volume = muted ? 0 : volume;
    volEl.value = muted ? 0 : Math.round(volume * 100);
    muteBtn.innerHTML = (muted || volume === 0) ? ICON_OFF : ICON_ON;
    volEl.style.setProperty("--v", volEl.value + "%");
  }
  volEl.addEventListener("input", function () {
    volume = Number(volEl.value) / 100;
    muted = false;
    try { localStorage.setItem(VOL_KEY, String(volume)); } catch (e) {}
    drawVolume();
  });
  volEl.addEventListener("change", function () { exec("volume " + volEl.value, true); });
  drawVolume();

  const run = new Array(400).join("-");
  backEl.textContent = run;
  fillEl.textContent = run.replace(/-/g, "#");

  function drawNow() {
    const t = tracks[cur];
    if (failed) npEl.innerHTML = "error: cannot load <b>" + esc(t ? t.file : "") + "</b>";
    else if (!t) npEl.textContent = "pick a track";
    else npEl.innerHTML = (audio.paused ? "paused" : "playing") + ": <b>" + esc(t.title) + "</b>";
    playBtn.textContent = audio.paused ? "play" : "pause";
    shuffleBtn.classList.toggle("on", shuffle);
    listEl.querySelectorAll("li").forEach(function (li, i) { li.classList.toggle("on", i === cur); });
  }

  function drawTime() {
    const d = audio.duration;
    fillEl.style.width = (d ? audio.currentTime / d * 100 : 0) + "%";
    curEl.textContent = fmt(audio.currentTime);
    durEl.textContent = fmt(d);
  }

  function load(i) {
    cur = (i + tracks.length) % tracks.length;
    failed = false;
    audio.src = "assets/music/" + encodeURI(tracks[cur].file);
    audio.play().catch(function () {});
    say("playing: " + tracks[cur].title, "ok");
    drawNow();
    drawTime();
  }

  function step(dir) {
    if (!tracks.length) return;
    if (shuffle && tracks.length > 1) {
      let n;
      do { n = Math.floor(Math.random() * tracks.length); } while (n === cur);
      load(n);
    } else {
      load(cur < 0 ? 0 : cur + dir);
    }
  }

  function stop() {
    if (cur >= 0) say("stopped");
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    cur = -1;
    failed = false;
    drawNow();
    drawTime();
  }

  audio.addEventListener("timeupdate", drawTime);
  audio.addEventListener("loadedmetadata", drawTime);
  audio.addEventListener("play", drawNow);
  audio.addEventListener("pause", drawNow);
  audio.addEventListener("ended", function () { step(1); });
  audio.addEventListener("error", function () {
    if (audio.getAttribute("src")) { failed = true; drawNow(); }
  });

  function seekTo(sec) {
    if (!audio.duration) { say("nothing playing", "err"); return; }
    audio.currentTime = Math.max(0, Math.min(audio.duration - 1, sec));
    say("seek " + fmt(audio.currentTime));
  }

  function exec(arg, echo) {
    arg = String(arg || "").trim();
    if (echo && opts.echo) opts.echo(("vlc " + arg).trim());
    const w = arg.replace(/^(\.\/)?(music\/)?/, "").split(/\s+/);
    const k = w[0];
    if (!tracks.length) { say("no tracks", "err"); return; }
    if (!k) {
      if (cur < 0) say("pick a track: vlc <n>");
      else say((audio.paused ? "paused: " : "playing: ") + tracks[cur].title + " " + fmt(audio.currentTime) + "/" + fmt(audio.duration));
      return;
    }
    const n = parseInt(k, 10);
    const byFile = tracks.findIndex(function (x) { return x.file === k; });
    if (!isNaN(n) && tracks[n - 1]) load(n - 1);
    else if (byFile > -1) load(byFile);
    else if (k === "play") {
      if (cur < 0) step(1);
      else { audio.play().catch(function () {}); say("resumed"); }
    } else if (k === "pause") { audio.pause(); say("paused"); }
    else if (k === "next") step(1);
    else if (k === "prev") step(-1);
    else if (k === "stop") stop();
    else if (k === "shuffle") { shuffle = !shuffle; say("shuffle " + (shuffle ? "on" : "off")); drawNow(); }
    else if (k === "mute") { muted = !muted; say(muted ? "muted" : "unmuted"); drawVolume(); }
    else if (k === "volume") {
      const v = parseInt(w[1], 10);
      if (isNaN(v) || v < 0 || v > 100) { say("usage: vlc volume 0-100", "err"); return; }
      volume = v / 100;
      muted = false;
      try { localStorage.setItem(VOL_KEY, String(volume)); } catch (e) {}
      say("volume " + v + "%");
      drawVolume();
    } else if (k === "seek") {
      const m = (w[1] || "").split(":");
      seekTo((Number(m[0]) || 0) * 60 + (Number(m[1]) || 0));
    } else say("unknown: " + arg, "err");
  }

  function onClick(e) {
    const li = e.target.closest("li[data-i]");
    if (li) { exec(tracks[Number(li.dataset.i)].file, true); return; }
    const seek = e.target.closest("[data-seek]");
    if (seek) {
      if (audio.duration) {
        const r = seek.getBoundingClientRect();
        const s = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration);
        exec("seek " + fmt(s), true);
      }
      return;
    }
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const a = b.dataset.a;
    if (a === "play") exec(cur >= 0 && !audio.paused ? "pause" : "play", true);
    else exec(a, true);
  }
  listRoot.addEventListener("click", onClick);
  playerRoot.addEventListener("click", onClick);

  function empty() {
    listEl.innerHTML = '<li class="mp-empty">no tracks yet</li>';
    term.style.display = "none";
  }

  fetch("assets/music/tracks.json")
    .then(function (r) { return r.json(); })
    .then(function (list) {
      tracks = Array.isArray(list) ? list : [];
      if (!tracks.length) { empty(); return; }
      listEl.innerHTML = tracks.map(function (t, i) {
        return '<li data-i="' + i + '"><span class="mp-n">' + (i + 1) + ".</span> " + esc(t.title) + "</li>";
      }).join("");
      drawNow();
      drawTime();
    })
    .catch(empty);

  return {
    destroy: stop,
    exec: exec,
    files: function () { return tracks.map(function (x) { return x.file; }); }
  };
}
