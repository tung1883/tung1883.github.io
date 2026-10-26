import { initFlappyBird } from "./engine.js";

const BASE = "assets/games/flappybird/";
const BASE_SPRITE_URLS = {
  bgDay: "sprites/background-day.png",
  bgNight: "sprites/background-night.png",
  base: "sprites/base.png",
  pipeGreen: "sprites/pipe-green.png",
  pipeRed: "sprites/pipe-red.png",
  message: "sprites/message.png",
  gameover: "sprites/gameover.png",
  medalGold: "sprites/medal-gold.png",
  medalSilver: "sprites/medal-silver.png",
  gear: "sprites/gear.png",
  d0: "sprites/0.png", d1: "sprites/1.png", d2: "sprites/2.png", d3: "sprites/3.png", d4: "sprites/4.png",
  d5: "sprites/5.png", d6: "sprites/6.png", d7: "sprites/7.png", d8: "sprites/8.png", d9: "sprites/9.png"
};
const AUDIO_URLS = {
  wing: "audio/wing.ogg", hit: "audio/hit.ogg", die: "audio/die.ogg", point: "audio/point.ogg"
};

// Both characters are preloaded up front - the in-canvas picker/settings
// UI (engine.js) switches between them instantly, with no re-fetch, by
// swapping to already-loaded frames. Pepe's "flap" is its propeller
// beanie spinning (frames 1-4 are the same source art with just the hub+
// blades - not the fixed mast - rotated 0/45/90/135 degrees, plus the hand
// flippers nudged up/down each frame) - the beanie is symmetric so that
// covers a full visual spin; the art isn't native pixel-scale, so it still
// uses bilinear smoothing to avoid nearest-neighbor shimmer.
const CHARACTER_DEFS = {
  classic: { label: "BIRD", frameUrls: ["sprites/bluebird-upflap.png", "sprites/bluebird-midflap.png", "sprites/bluebird-downflap.png"] },
  // Source art is 80x94 (extra transparent headroom above the propeller so
  // the spinning blade has room to swing upright without clipping against
  // the image edge) - size keeps that aspect ratio so the frog isn't
  // stretched/squashed.
  pepe: { label: "PEPE", frameUrls: ["sprites/pepe-frame1.png", "sprites/pepe-frame2.png", "sprites/pepe-frame3.png", "sprites/pepe-frame4.png"], size: { w: 40, h: 47 }, hitbox: { x: 6, y: 17, w: 28, h: 27 }, smooth: true }
};
const CHARACTER_KEY = "fb_character";
function loadCharacter() {
  try {
    var saved = localStorage.getItem(CHARACTER_KEY);
    return saved && CHARACTER_DEFS[saved] ? saved : "classic";
  } catch (e) { return "classic"; }
}
function saveCharacter(id) {
  try { localStorage.setItem(CHARACTER_KEY, id); } catch (e) {}
}

const BEST_KEY = "fb_best_score";
function loadBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; }
}
function recordBest(score) {
  const best = loadBest();
  if (score > best) { try { localStorage.setItem(BEST_KEY, String(score)); } catch (e) {} return score; }
  return best;
}

function loadImage(src) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error("failed to load " + src)); };
    img.src = src;
  });
}

async function loadImages(urlMap) {
  const entries = await Promise.all(Object.entries(urlMap).map(async function (pair) {
    return [pair[0], await loadImage(BASE + pair[1])];
  }));
  return Object.fromEntries(entries);
}

function fetchArrayBuffer(url) {
  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "arraybuffer";
    xhr.onload = function () { resolve(xhr.response); };
    xhr.onerror = function () { reject(new Error("failed to fetch " + url)); };
    xhr.send();
  });
}

const MUTED_KEY = "fb_muted";
function loadMuted() {
  try { return localStorage.getItem(MUTED_KEY) === "1"; } catch (e) { return false; }
}
function saveMuted(muted) {
  try { localStorage.setItem(MUTED_KEY, muted ? "1" : "0"); } catch (e) {}
}

function loadAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  function resume() { if (ctx.state === "suspended") ctx.resume().catch(function () {}); }
  document.addEventListener("pointerdown", resume, { once: true });
  var muted = loadMuted();

  return Promise.all(Object.entries(AUDIO_URLS).map(async function (pair) {
    const buf = await fetchArrayBuffer(BASE + pair[1]);
    const decoded = await ctx.decodeAudioData(buf);
    return [pair[0], decoded];
  })).then(function (entries) {
    const buffers = Object.fromEntries(entries);
    return {
      play: function (name) {
        if (muted) return;
        const buffer = buffers[name];
        if (!buffer) return;
        resume();
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      },
      setMuted: function (v) { muted = v; saveMuted(v); },
      isMuted: function () { return muted; }
    };
  });
}

// Audio doesn't vary by character, and decoding is the slowest part of a
// (re)start - cached once so reopening the panel doesn't redecode or pile
// up extra AudioContexts.
var audioPromise = null;
function getAudio() {
  if (!audioPromise) audioPromise = loadAudio();
  return audioPromise;
}

// Canvas text can't use a webfont until it's actually loaded.
function loadUiFont() {
  if (!document.getElementById("fb-pixel-font")) {
    const link = document.createElement("link");
    link.id = "fb-pixel-font";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap";
    document.head.appendChild(link);
  }
  return document.fonts.load('8px "Press Start 2P"').catch(function () {});
}

export async function startFlappyBird(canvas) {
  const urlMap = Object.assign({}, BASE_SPRITE_URLS);
  Object.keys(CHARACTER_DEFS).forEach(function (id) {
    CHARACTER_DEFS[id].frameUrls.forEach(function (url, i) { urlMap[id + "_" + i] = url; });
  });
  await loadUiFont();
  const images = await loadImages(urlMap);
  const audio = await getAudio();

  const characters = {};
  Object.keys(CHARACTER_DEFS).forEach(function (id) {
    const def = CHARACTER_DEFS[id];
    const frames = def.frameUrls.map(function (_, i) { return images[id + "_" + i]; });
    characters[id] = {
      label: def.label,
      frames: frames,
      size: def.size,
      hitbox: def.hitbox,
      smooth: def.smooth
    };
  });

  const engine = initFlappyBird(canvas, images, audio, {
    characters: characters,
    initialCharacter: loadCharacter(),
    onCharacterChange: function (id) { saveCharacter(id); },
    onGameOver: function (finalScore) { recordBest(finalScore); }
  });
  return engine;
}

export { loadBest };
