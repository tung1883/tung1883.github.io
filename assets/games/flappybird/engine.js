// Flappy Bird - original implementation, using the classic sprite/audio
// asset pack (standard dimensions: 288x512 canvas, 34x24 bird, 52-wide
// pipes). Renders on a single <canvas>, so unlike the DOM-sprite-based
// Minesweeper, responsive scaling is just CSS sizing the canvas element -
// no sub-pixel gaps between separate elements to worry about.
//
// Character picker + settings (gear icon, sound toggle) are drawn on this
// same canvas rather than as HTML overlays - all UI chrome here is drawn
// procedurally (rects/arcs/text), and the character previews reuse the
// already-loaded bird sprites, so no extra art assets are needed.

const LOGICAL_W = 288
const LOGICAL_H = 512

const GRAVITY = 1400          // px/s^2
const FLAP_VELOCITY = -380    // px/s
const MAX_FALL_SPEED = 450    // px/s
const PIPE_GAP = 120          // px, vertical gap the bird flies through
const PIPE_WIDTH = 52
const PIPE_SPACING = 190      // px between pipe pairs
const SCROLL_SPEED = 130      // px/s, pipes + ground
const BASE_HEIGHT = 112
const GROUND_Y = LOGICAL_H - BASE_HEIGHT
const BASE_TILE_W = 336
const BIRD_X = 60
const FLAP_FRAME_MS = 120
const RESTART_DELAY_MS = 400

// Palette pulled from the game's own sprites - ground tan/brown (base.png)
// and the green/white "Get Ready!" message text - so the picker/settings
// chrome reads as part of Flappy Bird rather than a generic dark overlay.
const THEME = {
  dim: 'rgba(0,0,0,0.35)',
  panelBg: '#f4e7ae',
  panelBorder: '#5d4126',
  swatchBg: '#efe3ad',
  swatchActiveBg: '#dff0d8',
  textDark: '#5d4126',
  green: '#4cc252',
  greenDark: '#2f9e3f',
}
const UI_FONT = '"Press Start 2P", monospace'

const GEAR = { x: LOGICAL_W - 40, y: 8, w: 32, h: 32 }
// Card geometry (outer box incl. 4px border); inner content is laid out
// relative to these in drawPicker/drawSettings.
const PICKER_PANEL = { x: 24, y: 132, w: 240, h: 236 }
const START_BTN = { x: LOGICAL_W / 2 - 56, y: 300, w: 112, h: 36 }
const SETTINGS_PANEL = { x: 24, y: 62, w: 240, h: 356 }
const SOUND_BTN = { x: LOGICAL_W / 2 - 60, y: 244, w: 120, h: 32 }
const CLOSE_BTN = { x: LOGICAL_W / 2 - 50, y: 292, w: 100, h: 34 }
const BACKING_SCALE = 2

export function initFlappyBird(canvas, images, audio, { onScore, onGameOver, onCharacterChange, characters, initialCharacter } = {}) {
  // alpha:false - the background image fully covers the canvas every frame,
  // so there's nothing beneath it to blend against; letting the browser
  // skip alpha compositing on an otherwise-opaque canvas is a well-known
  // win on mobile GPUs. desynchronized:true removes a frame or so of
  // display latency by letting this canvas bypass the usual compositor
  // sync - safe here since nothing else draws over it.
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })

  const charIds = Object.keys(characters)
  let currentId = initialCharacter && characters[initialCharacter] ? initialCharacter : charIds[0]
  // Some skins (e.g. Pepe) aren't cropped to the classic bird's 34x24
  // aspect ratio - stretching them into that box squashes/stretches the
  // art. Letting each skin specify its own draw+hitbox size keeps the
  // sprite's proportions intact instead of forcing every skin into one
  // fixed box. These are `let`, not `const` - switching character in the
  // picker/settings UI reassigns them in place rather than recreating the
  // whole engine.
  let BIRD_W, BIRD_H, HIT, frames, birdSmooth
  function setCharacterVars(id) {
    const c = characters[id]
    BIRD_W = c.size?.w ?? 34
    BIRD_H = c.size?.h ?? 24
    // Collision box is separate from the draw box: skins have transparent
    // padding (Pepe: headroom + thin propeller), so the full sprite rect
    // hits pipes that visually miss.
    HIT = c.hitbox ?? { x: 0, y: 0, w: BIRD_W, h: BIRD_H }
    frames = c.frames
    birdSmooth = c.smooth
  }
  setCharacterVars(currentId)

  // 'pick': first-run character picker, shown over the ready screen before
  // any flap. settingsOpen is independent of game state - it's a gear-icon
  // overlay reachable any time once past the initial picker.
  let uiState = 'pick'
  let settingsOpen = false
  let pickerSwatches = []
  let settingsSwatches = []

  let state = 'ready' // 'ready' | 'playing' | 'gameover'
  let bird = { y: LOGICAL_H / 2 - BIRD_H / 2, vy: 0, frame: 0, frameTimer: 0 }
  let pipes = []
  let groundOffset = 0
  let score = 0
  let bobTimer = 0
  let gameOverAt = 0
  let isDay = Math.random() < 0.5
  let bg = isDay ? images.bgDay : images.bgNight
  let pipeImg = isDay ? images.pipeGreen : images.pipeRed
  let lastTime = null
  let rafId = null
  // Drives the character-picker/settings swatch previews - ticks regardless
  // of game state (unlike bird.frameTimer, which only advances the ACTIVE
  // character's frame) so every swatch animates even for characters that
  // aren't currently selected.
  let previewFrameIdx = 0
  let previewTimer = 0

  // Web Audio (decoded buffers via AudioContext), not HTMLAudioElement -
  // re-triggering an <audio> element's .play() every flap is a known
  // mobile-jank source (the media pipeline re-primes synchronously on the
  // main thread), which shows up as a stutter right at the moment you tap -
  // the worst possible time for it to happen in a reaction game.
  function play(name) {
    audio.play?.(name)
  }

  function applyCharacter(id) {
    if (id === currentId || !characters[id]) return
    currentId = id
    setCharacterVars(id)
    bird.frame = 0
    if (state !== 'playing') bird.y = LOGICAL_H / 2 - BIRD_H / 2
    onCharacterChange?.(id)
  }

  function reset() {
    bird = { y: LOGICAL_H / 2 - BIRD_H / 2, vy: 0, frame: 0, frameTimer: 0 }
    pipes = []
    groundOffset = 0
    score = 0
    bobTimer = 0
    isDay = Math.random() < 0.5
    bg = isDay ? images.bgDay : images.bgNight
    pipeImg = isDay ? images.pipeGreen : images.pipeRed
    state = 'ready'
    onScore?.(0)
  }

  function spawnPipe(x) {
    const margin = 50
    const gapY = margin + Math.random() * (GROUND_Y - margin * 2 - PIPE_GAP) + PIPE_GAP / 2
    pipes.push({ x, gapY, passed: false })
  }

  function flap() {
    if (state === 'ready') {
      state = 'playing'
      spawnPipe(LOGICAL_W + 40)
      bird.vy = FLAP_VELOCITY
      play('wing')
    } else if (state === 'playing') {
      bird.vy = FLAP_VELOCITY
      play('wing')
    } else if (state === 'gameover') {
      if (performance.now() - gameOverAt > RESTART_DELAY_MS) reset()
    }
  }

  function startFromPicker() {
    uiState = null
    flap()
  }

  // Plain numeric AABB checks, no per-frame object allocation - this ran
  // once per frame while playing (birdRect() + two rect objects per pipe),
  // which was frequent enough small garbage to trigger periodic GC pauses.
  // Average FPS looked fine (GC pauses are brief) but it was exactly the
  // kind of jitter that shows up as the bird's otherwise-continuous motion
  // stuttering slightly, since it's the one thing constantly moving smoothly
  // on screen and any hitch there is very visible.
  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
  }

  function checkCollision() {
    const hx = BIRD_X + HIT.x, hy = bird.y + HIT.y
    if (hy + HIT.h >= GROUND_Y) return true
    for (const p of pipes) {
      const topH = p.gapY - PIPE_GAP / 2
      if (rectsOverlap(hx, hy, HIT.w, HIT.h, p.x, 0, PIPE_WIDTH, topH)) return true
      const bottomY = p.gapY + PIPE_GAP / 2
      if (rectsOverlap(hx, hy, HIT.w, HIT.h, p.x, bottomY, PIPE_WIDTH, LOGICAL_H - bottomY)) return true
    }
    return false
  }

  function update(dt) {
    previewTimer += dt * 1000
    if (previewTimer > FLAP_FRAME_MS) { previewTimer = 0; previewFrameIdx++ }

    if (state === 'ready') {
      bobTimer += dt
      bird.y = LOGICAL_H / 2 - BIRD_H / 2 + Math.sin(bobTimer * 3) * 6
      bird.frameTimer += dt * 1000
      if (bird.frameTimer > FLAP_FRAME_MS) { bird.frameTimer = 0; bird.frame = (bird.frame + 1) % frames.length }
      return
    }

    if (state === 'playing') {
      bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL_SPEED)
      bird.y += bird.vy * dt
      if (bird.y < 0) { bird.y = 0; bird.vy = 0 } // ceiling: clamp, don't kill
      bird.frameTimer += dt * 1000
      if (bird.frameTimer > FLAP_FRAME_MS) { bird.frameTimer = 0; bird.frame = (bird.frame + 1) % frames.length }

      groundOffset = (groundOffset + SCROLL_SPEED * dt) % BASE_TILE_W

      for (const p of pipes) p.x -= SCROLL_SPEED * dt
      if (pipes.length && pipes[0].x < -PIPE_WIDTH) pipes.shift()
      if (!pipes.length || pipes[pipes.length - 1].x < LOGICAL_W - PIPE_SPACING) {
        spawnPipe((pipes[pipes.length - 1]?.x ?? LOGICAL_W) + PIPE_SPACING)
      }

      for (const p of pipes) {
        if (!p.passed && p.x + PIPE_WIDTH < BIRD_X) {
          p.passed = true
          score++
          onScore?.(score)
          play('point')
        }
      }

      if (checkCollision()) {
        state = 'gameover'
        gameOverAt = performance.now()
        bird.y = Math.min(bird.y, GROUND_Y - BIRD_H)
        bird.vy = 0
        play('hit')
        setTimeout(() => play('die'), 150)
        onGameOver?.(score)
      }
      return
    }

    // gameover: let the bird settle if it died mid-air
    if (bird.y + BIRD_H < GROUND_Y) {
      bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL_SPEED)
      bird.y = Math.min(bird.y + bird.vy * dt, GROUND_Y - BIRD_H)
    }
  }

  function drawGround() {
    let x = -groundOffset
    while (x < LOGICAL_W) {
      ctx.drawImage(images.base, x, GROUND_Y, BASE_TILE_W, BASE_HEIGHT)
      x += BASE_TILE_W
    }
  }

  function drawPipes() {
    for (const p of pipes) {
      const topH = p.gapY - PIPE_GAP / 2
      ctx.save()
      ctx.translate(p.x + PIPE_WIDTH / 2, topH)
      ctx.scale(1, -1)
      ctx.drawImage(pipeImg, -PIPE_WIDTH / 2, 0, PIPE_WIDTH, 320)
      ctx.restore()

      ctx.drawImage(pipeImg, p.x, p.gapY + PIPE_GAP / 2, PIPE_WIDTH, 320)
    }
  }

  function drawBird() {
    const img = frames[bird.frame]
    const rotation = Math.max(-25, Math.min(90, bird.vy * 0.1)) * Math.PI / 180
    ctx.save()
    ctx.translate(BIRD_X + BIRD_W / 2, bird.y + BIRD_H / 2)
    ctx.rotate(rotation)
    // Every other sprite is genuine native-resolution pixel art, where
    // nearest-neighbor is both stylistically correct and artifact-free
    // (this game's canvas is deliberately scaled up/down through several
    // non-integer ratios - the CSS layer alone is responsive and can land
    // on almost any size). A skin whose source art isn't actually pixel
    // art (birdSmooth: true) shimmers under nearest-neighbor as those
    // ratios shift with the bird's continuous position, because which
    // source pixel gets picked changes frame to frame - bilinear
    // interpolation blends instead of picking, so it doesn't "pop".
    if (birdSmooth) ctx.imageSmoothingEnabled = true
    ctx.drawImage(img, -BIRD_W / 2, -BIRD_H / 2, BIRD_W, BIRD_H)
    if (birdSmooth) ctx.imageSmoothingEnabled = false
    ctx.restore()
  }

  function drawScore() {
    const str = String(score)
    const w = 24, h = 36
    let x = LOGICAL_W / 2 - (str.length * w) / 2
    for (let i = 0; i < str.length; i++) {
      ctx.drawImage(images['d' + str[i]], x, 20, w, h)
      x += w
    }
  }

  function medalFor(finalScore) {
    if (finalScore >= 20) return images.medalGold
    if (finalScore >= 10) return images.medalSilver
    return null
  }

  function drawMedal() {
    const medal = medalFor(score)
    if (!medal) return
    ctx.drawImage(medal, LOGICAL_W / 2 - images.gameover.width / 2 - medal.width - 10, 160 + 4, medal.width, medal.height)
  }

  // ---- in-canvas UI chrome: gear icon, character picker, settings panel ----
  // Drawn procedurally (no extra image assets) - character previews reuse
  // each skin's own already-loaded sprite.

  function pointIn(r, p) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
  }

  function toLogical(e) {
    const rect = canvas.getBoundingClientRect()
    const t = e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e
    return {
      x: (t.clientX - rect.left) * LOGICAL_W / rect.width,
      y: (t.clientY - rect.top) * LOGICAL_H / rect.height,
    }
  }

  function charSwatchRects(y, size) {
    const gap = 16
    const total = charIds.length * size + (charIds.length - 1) * gap
    let x = (LOGICAL_W - total) / 2
    return charIds.map(id => {
      const r = { id, x, y, w: size, h: size }
      x += size + gap
      return r
    })
  }

  // Stepped-corner "pixel dialog" polygon (n = notch size in px).
  function pixelPath(x, y, w, h, n) {
    ctx.beginPath()
    ctx.moveTo(x + n, y)
    ctx.lineTo(x + w - n, y)
    ctx.lineTo(x + w, y + n)
    ctx.lineTo(x + w, y + h - n)
    ctx.lineTo(x + w - n, y + h)
    ctx.lineTo(x + n, y + h)
    ctx.lineTo(x, y + h - n)
    ctx.lineTo(x, y + n)
    ctx.closePath()
  }

  function pixelBox(x, y, w, h, n, pad, border, fill) {
    pixelPath(x, y, w, h, n)
    ctx.fillStyle = border
    ctx.fill()
    pixelPath(x + pad, y + pad, w - pad * 2, h - pad * 2, n)
    ctx.fillStyle = fill
    ctx.fill()
  }

  function pixelText(text, x, y, size, fill, stroke) {
    ctx.font = size + 'px ' + UI_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (stroke) {
      ctx.lineJoin = 'round'
      ctx.lineWidth = stroke
      ctx.strokeStyle = '#fff'
      ctx.strokeText(text, x, y)
    }
    ctx.fillStyle = fill
    ctx.fillText(text, x, y)
  }

  function drawPanel(p) {
    ctx.fillStyle = THEME.dim
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H)
    pixelBox(p.x, p.y, p.w, p.h, 8, 4, THEME.panelBorder, THEME.panelBg)
  }

  function drawSwatch(r) {
    const c = characters[r.id]
    const active = r.id === currentId
    pixelBox(r.x, r.y, r.w, r.h, 5, 3, active ? THEME.greenDark : THEME.panelBorder,
      active ? THEME.swatchActiveBg : THEME.swatchBg)
    const img = c.frames[previewFrameIdx % c.frames.length]
    const iw = r.w >= 80 ? 40 : 34
    const ih = iw * img.height / img.width
    // Center every skin vertically in a shared preview area so differently
    // sized sprites (bird vs taller pepe) line up.
    const areaH = r.w >= 80 ? 47 : 40
    const top = r.y + 3 + (r.w >= 80 ? 6 : 4) + (areaH - ih) / 2
    if (c.smooth) ctx.imageSmoothingEnabled = true
    ctx.drawImage(img, r.x + (r.w - iw) / 2, top, iw, ih)
    if (c.smooth) ctx.imageSmoothingEnabled = false
    pixelText(c.label, r.x + r.w / 2, r.y + r.h - 9 - 3.5, 7, THEME.textDark)
  }

  // Hard pixel bevel (light top/left, dark bottom/right), clipped to the
  // stepped-corner shape.
  function drawButton(r, label, variant) {
    const green = variant === 'green'
    ctx.save()
    pixelPath(r.x, r.y, r.w, r.h, 5)
    ctx.fillStyle = green ? THEME.green : THEME.swatchBg
    ctx.fill()
    ctx.clip()
    ctx.fillStyle = 'rgba(255,255,255,' + (green ? 0.4 : 0.6) + ')'
    ctx.fillRect(r.x, r.y, r.w, 2)
    ctx.fillRect(r.x, r.y, 2, r.h)
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.fillRect(r.x, r.y + r.h - 2, r.w, 2)
    ctx.fillRect(r.x + r.w - 2, r.y, 2, r.h)
    ctx.restore()
    pixelText(label, r.x + r.w / 2, r.y + r.h / 2 + 1, 11, green ? '#fff' : THEME.textDark)
  }

  // Gear art is traced from a 1254x1254 source - rasterized once here (not
  // per frame) into a backing-scale-sized offscreen canvas with real
  // smoothing, so the result is a clean downscale rather than the noisy
  // speckling a single nearest-neighbor pass from that source would give at
  // this icon's tiny on-screen size. The in-game canvas itself stays
  // nearest-neighbor (ctx.imageSmoothingEnabled=false, set in setupCanvas)
  // so drawing this pre-downscaled bitmap at 1:1 backing pixels stays crisp.
  let gearIcon = null
  if (images.gear) {
    const size = GEAR.w * BACKING_SCALE
    const off = document.createElement('canvas')
    off.width = size; off.height = size
    const octx = off.getContext('2d')
    octx.imageSmoothingEnabled = true
    octx.imageSmoothingQuality = 'high'
    octx.drawImage(images.gear, 0, 0, size, size)
    gearIcon = off
  }

  function drawGear() {
    if (settingsOpen) {
      ctx.save()
      ctx.translate(GEAR.x + GEAR.w / 2, GEAR.y + GEAR.h / 2)
      ctx.fillStyle = THEME.green
      ctx.globalAlpha = 0.35
      ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
    if (gearIcon) {
      ctx.drawImage(gearIcon, GEAR.x, GEAR.y, GEAR.w, GEAR.h)
    }
  }

  function drawPicker() {
    const p = PICKER_PANEL
    drawPanel(p)
    pixelText('CHOOSE', LOGICAL_W / 2, p.y + 29, 13, THEME.green, 2)
    pixelText('CHARACTER', LOGICAL_W / 2, p.y + 47.5, 13, THEME.green, 2)
    pickerSwatches = charSwatchRects(p.y + 70, 80)
    pickerSwatches.forEach(drawSwatch)
    drawButton(START_BTN, 'START', 'green')
    pixelText('OR PRESS SPACE', LOGICAL_W / 2, p.y + 220.5, 8, THEME.textDark)
  }

  function drawSettings() {
    const p = SETTINGS_PANEL
    drawPanel(p)
    pixelText('SETTINGS', LOGICAL_W / 2, p.y + 29, 13, THEME.green, 2)
    pixelText('CHARACTER', LOGICAL_W / 2, p.y + 56, 8, THEME.textDark)
    settingsSwatches = charSwatchRects(p.y + 74, 70)
    settingsSwatches.forEach(drawSwatch)
    pixelText('SOUND', LOGICAL_W / 2, SOUND_BTN.y - 14, 8, THEME.textDark)
    const muted = audio.isMuted?.()
    drawButton(SOUND_BTN, muted ? 'OFF' : 'ON', muted ? 'neutral' : 'green')
    drawButton(CLOSE_BTN, 'CLOSE', 'neutral')
  }

  function handlePickerClick(pt) {
    for (const r of pickerSwatches) { if (pointIn(r, pt)) { applyCharacter(r.id); return } }
    if (pointIn(START_BTN, pt)) startFromPicker()
  }

  function handleSettingsClick(pt) {
    for (const r of settingsSwatches) { if (pointIn(r, pt)) { applyCharacter(r.id); return } }
    if (pointIn(SOUND_BTN, pt)) { audio.setMuted?.(!audio.isMuted?.()); return }
    if (pointIn(CLOSE_BTN, pt) || !pointIn(SETTINGS_PANEL, pt)) { settingsOpen = false }
  }

  function render() {
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H)
    ctx.drawImage(bg, 0, 0, LOGICAL_W, LOGICAL_H)
    drawPipes()
    drawGround()
    drawBird()
    if (state === 'ready' && uiState !== 'pick') {
      ctx.drawImage(images.message, LOGICAL_W / 2 - images.message.width / 2, 80)
    } else if (state !== 'ready') {
      drawScore()
      if (state === 'gameover') {
        ctx.drawImage(images.gameover, LOGICAL_W / 2 - images.gameover.width / 2, 160)
        drawMedal()
      }
    }
    if (uiState === 'pick') {
      drawPicker()
    } else {
      drawGear()
      if (settingsOpen) drawSettings()
    }
  }

  function loop(time) {
    if (lastTime === null) lastTime = time
    const dtRaw = (time - lastTime) / 1000
    const dt = Math.min(dtRaw, 1 / 30)
    lastTime = time

    update(dt)
    render()
    rafId = requestAnimationFrame(loop)
  }

  function onPointerDown(e) {
    e.preventDefault()
    const pt = toLogical(e)
    if (uiState !== 'pick' && pointIn(GEAR, pt)) { settingsOpen = !settingsOpen; return }
    if (settingsOpen) { handleSettingsClick(pt); return }
    if (uiState === 'pick') { handlePickerClick(pt); return }
    flap()
  }

  function onKeyDown(e) {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault()
      if (settingsOpen) return
      if (uiState === 'pick') { startFromPicker(); return }
      flap()
    } else if (e.code === 'Escape' && settingsOpen) {
      settingsOpen = false
    }
  }

  // Fixed backing-buffer resolution, deliberately NOT tied to CSS display
  // size or devicePixelRatio. This is pixel art rendered with
  // image-rendering:pixelated - drawing at native DPR (2-3x on most phones)
  // just makes the canvas 2D rasterizer redo several times the work every
  // single frame for zero visual benefit (blocky pixels don't get "sharper"
  // at higher resolution). Rendering at a small fixed resolution and letting
  // the browser's compositor do the (GPU, nearest-neighbor, essentially
  // free) upscale to whatever CSS size the canvas ends up displayed at was
  // the main cause of the mobile slowdown.
  function setupCanvas() {
    canvas.width = LOGICAL_W * BACKING_SCALE
    canvas.height = LOGICAL_H * BACKING_SCALE
    ctx.setTransform(BACKING_SCALE, 0, 0, BACKING_SCALE, 0, 0)
    ctx.imageSmoothingEnabled = false
  }

  canvas.addEventListener('mousedown', onPointerDown)
  canvas.addEventListener('touchstart', onPointerDown, { passive: false })
  document.addEventListener('keydown', onKeyDown)

  setupCanvas()
  rafId = requestAnimationFrame(loop)

  return {
    destroy() {
      cancelAnimationFrame(rafId)
      canvas.removeEventListener('mousedown', onPointerDown)
      canvas.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    },
  }
}
