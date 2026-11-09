// Snake Uncoil in the browser. The rules are the app's own, compiled from Kotlin
// (engine/snake-uncoil-engine.mjs, built by snake-uncoil-web-engine in the Android repo); this file
// is the page: input, HUD, level flow, saves, sound and analytics. render.js draws the board.

import { WebGame } from "./engine/snake-uncoil-engine.mjs";
import { createRenderer, loadPicture } from "./render.js";
import { platform } from "./platform-site.js";

const LAST_LEVEL = 63;
const HINTS_START = 3;
const HINTS_CAP = 5;
const TAP_SNAP_PX = 10; // a near miss snaps onto an escapable snake this close (TAP_FORGIVENESS_DP)
const TAP_BUMP_PX = 4; // and onto a blocked one only this close, since that is a mistake

const ANDROID = "https://play.google.com/store/apps/details?id=com.datgames.snakeuncoil&utm_source=website&utm_medium=web_game&utm_campaign=play_snake-uncoil&utm_content=";
const IOS = "https://apps.apple.com/app/id6826481395?ct=web_game_";

const INTROS = {
  SLEEPERS: {
    title: "Sleepy snakes",
    body: "A snake with closed eyes is asleep. Tapping it does nothing. The number on it says how many other snakes must leave before it wakes up.",
  },
  GATES: {
    title: "Gates and keys",
    body: "A golden gate blocks every snake that runs into it. Free the snake carrying the key and the gate opens.",
  },
  GRASS: {
    title: "Tall grass",
    body: "Snakes hide under grass. You can still tap them, if you can guess where they are. Free the snake with the star and the grass is cut.",
  },
};

const $ = (sel) => document.querySelector(sel);
const ui = {
  board: $("[data-board]"),
  stage: $("[data-stage]"),
  level: $("[data-level]"),
  stars: $("[data-stars]"),
  left: $("[data-left]"),
  hint: $("[data-hint]"),
  hintCount: $("[data-hint-count]"),
  restart: $("[data-restart]"),
  levels: $("[data-levels]"),
  sound: $("[data-sound]"),
  toast: $("[data-toast]"),
  preview: $("[data-preview]"),
  coach: $("[data-coach]"),
  overlay: $("[data-overlay]"),
};

// ---------- Saves ----------
const progress = Object.assign(
  { furthest: 0, current: 1, stars: {}, hints: HINTS_START, intro: {}, muted: false },
  (await platform.load()) || {},
);
const save = () => platform.save(progress);

// ---------- Sound ----------
const sound = (() => {
  let ctx = null;
  const buffers = new Map();
  const load = (name) => {
    if (!buffers.has(name)) {
      buffers.set(name, fetch(new URL(`audio/${name}.mp3`, import.meta.url))
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null));
    }
    return buffers.get(name);
  };
  return {
    unlock() {
      if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      ["escape", "escape_long", "bump", "ui_select"].forEach(load);
    },
    async play(name, { rate = 1, gain = 0.8 } = {}) {
      if (!ctx || progress.muted || !platform.audioAllowed()) return;
      const buffer = await load(name);
      if (!buffer) return;
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      g.gain.value = gain;
      src.connect(g).connect(ctx.destination);
      src.start();
    },
    pause() { ctx?.suspend(); },
    resume() { ctx?.resume(); },
  };
})();

// ---------- Engine and board ----------
const packText = await (await fetch(new URL("levels/pack.txt", import.meta.url))).text();
const game = new WebGame(packText);
const renderer = createRenderer(ui.board);

let level = 1;
let snap = null;
let movable = null;
let attempt = null; // { engaged, finished, mistakes, hints }
let finishing = false;
let toastTimer = 0;

const snakesById = () => new Map(snap.snakes.map((s) => [s.id, s]));
const pictureFor = (n, s) => (s.shape && n % 5 === 0 ? s.shape : null);
const titleCase = (slug) => slug.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

function toast(text, ms = 2600) {
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  ui.toast.classList.remove("is-in");
  void ui.toast.offsetWidth;
  ui.toast.classList.add("is-in");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, ms);
}

function renderHud() {
  ui.level.textContent = `Level ${level}`;
  const possible = game.starsStillPossible();
  ui.stars.innerHTML = [0, 1, 2].map((i) => `<span class="${i < possible ? "on" : ""}">★</span>`).join("");
  ui.stars.setAttribute("aria-label", `${possible} of 3 stars still possible`);
  const left = game.snakesLeft();
  ui.left.innerHTML = `<span class="wide-only">${left} left</span><span class="su-narrow" aria-label="${left} snakes left">🐍 ${left}</span>`;
  ui.hintCount.textContent = String(progress.hints);
  ui.hint.disabled = progress.hints <= 0 || finishing || snap.status === "COMPLETED";
  ui.hint.title = progress.hints > 0 ? "Show a snake that can move" : "Clear a level to earn a hint";
  ui.sound.setAttribute("aria-pressed", String(!progress.muted));
  ui.sound.textContent = progress.muted ? "🔇" : "🔊";
}

async function startLevel(n, action) {
  if (attempt && attempt.engaged && !attempt.finished) platform.track("match_restart", { level_number: level });
  level = Math.max(1, Math.min(LAST_LEVEL, n));
  progress.current = level;
  save();
  if (action === "restart") game.restart(); else game.startLevel(level);
  snap = JSON.parse(game.snapshot());
  movable = null;
  attempt = { engaged: false, finished: false, mistakes: 0, hints: 0 };
  finishing = false;
  closeOverlay();

  const slug = pictureFor(level, snap);
  let img = null;
  if (slug) {
    try { img = await loadPicture(new URL(`pictures/${slug}.svg`, import.meta.url)); } catch (_) { img = null; }
  }
  ui.stage.style.setProperty("--su-ar", `${snap.cols + 1} / ${snap.rows + 1}`);
  renderer.setLevel(snap, level, img);
  if (img && action === "restart") renderer.startPlay();
  ui.preview.hidden = !renderer.previewing;
  if (renderer.previewing) {
    ui.preview.querySelector("[data-preview-name]").textContent = `Level ${level} · ${titleCase(slug)}`;
    sound.play("picture_cover", { gain: 0.5 });
  }
  renderHud();
  platform.track("game_start", { action, level_number: level });

  const coachOn = level === 1 && !progress.furthest;
  ui.coach.hidden = !coachOn;
  if (coachOn) renderer.coach(JSON.parse(game.movable())[0] ?? null);

  const fresh = snap.kinds.filter((k) => INTROS[k] && !progress.intro[k]);
  if (fresh.length) showIntro(fresh[0]);
}

function currentMovable() {
  if (!movable) movable = new Set(JSON.parse(game.movable()));
  return movable;
}

/** The snake a tap at (x, y) means. Forgiving, with one rule: a tap that already works is never
 * overridden (SnakeGameView.pickSnakeAt). */
function pickSnake(x, y) {
  const cell = renderer.cellAt(x, y);
  const snakes = snap.snakes;
  const under = cell ? snakes.find((s) => s.cells.some(([r, c]) => r === cell[0] && c === cell[1])) : null;
  const free = currentMovable();
  if (under && free.has(under.id)) return under;
  let best = null, bestD = TAP_SNAP_PX;
  for (const s of snakes) {
    if (!free.has(s.id)) continue;
    const d = renderer.distanceTo(s, x, y);
    if (d <= bestD) { best = s; bestD = d; }
  }
  if (best) return best;
  if (under) return under;
  bestD = TAP_BUMP_PX;
  for (const s of snakes) {
    const d = renderer.distanceTo(s, x, y);
    if (d <= bestD) { best = s; bestD = d; }
  }
  return best;
}

function handleTap(x, y) {
  sound.unlock();
  if (finishing || !snap || snap.status === "COMPLETED") return;
  if (renderer.previewing) {
    renderer.startPlay();
    ui.preview.hidden = true;
    return;
  }
  const snake = pickSnake(x, y);
  renderer.ripple(x, y);
  if (!snake) return;

  if (!ui.coach.hidden) { ui.coach.hidden = true; renderer.coach(null); }
  const before = snakesById();
  const beforeMech = snap.mech;
  const out = JSON.parse(game.tap(snake.id));
  snap = JSON.parse(game.snapshot());
  movable = null;
  renderer.update(snap);

  if (out.type === "escaped") {
    for (const id of out.ids) {
      const s = before.get(id);
      renderer.escape(s, out.paths[id] || []);
      sound.play(s.cells.length >= 8 ? "escape_long" : "escape", { rate: 0.94 + Math.random() * 0.12 });
    }
    for (const id of out.woke) {
      renderer.wake(before.get(id));
      sound.play("sleeper_wake", { gain: 0.6 });
    }
    if (out.woke.length) toast(out.woke.length > 1 ? "Sleepy snakes woke up!" : "A sleepy snake woke up!", 1800);
    for (const id of out.opened) {
      renderer.fadeOut("gate", beforeMech.gates.find((g) => g.id === id));
      sound.play("gate_unlock");
    }
    for (const id of out.cleared) {
      renderer.fadeOut("grass", beforeMech.grass.find((p) => p.id === id));
      sound.play("grass_clear");
    }
    if (!attempt.engaged) {
      attempt.engaged = true;
      platform.track("game_engaged", { level_number: level });
    }
  } else if (out.type === "asleep") {
    renderer.bump(before.get(out.id), 0, true);
    sound.play("bump", { gain: 0.4 });
    toast(`😴 Asleep. It wakes after ${out.remaining} more snake${out.remaining === 1 ? "" : "s"} leave${out.remaining === 1 ? "s" : ""}.`);
  } else {
    attempt.mistakes++;
    renderer.bump(before.get(out.id), out.run ?? 0);
    sound.play("bump", { gain: 0.7 });
    navigator.vibrate?.(25);
  }
  renderHud();
  if (snap.status === "COMPLETED") finishLevel();
}

async function finishLevel() {
  finishing = true;
  renderHud();
  await renderer.settled();
  if (pictureFor(level, snap)) {
    sound.play("picture_complete");
    await renderer.finale();
  }
  const stars = game.stars();
  const firstClear = level > progress.furthest;
  const best = Math.max(stars, progress.stars[level] || 0);
  progress.stars[level] = best;
  const hintsBefore = progress.hints;
  if (firstClear) {
    progress.furthest = level;
    progress.hints = Math.min(HINTS_CAP, progress.hints + 1);
  }
  const gainedHint = progress.hints > hintsBefore;
  progress.current = Math.min(LAST_LEVEL, level + 1);
  save();
  attempt.finished = true;
  platform.track("match_finish", { level_number: level, result: `stars_${stars}`, moves: game.moveCount() });
  sound.play(stars === 3 ? "level_perfect" : "level_clear");
  showCleared(stars, best, firstClear, gainedHint);
}

// ---------- Overlays ----------
function storeRow(where) {
  if (!platform.showsStoreLinks) return "";
  return `<div class="store-row">
    <a class="store-btn" href="${ANDROID}${where}" rel="noopener" aria-label="Snake Uncoil on Google Play"><svg aria-hidden="true"><use href="#i-play"/></svg><span><small>Get it on</small>Google Play</span></a>
    <a class="store-btn" href="${IOS}${where}" rel="noopener" aria-label="Snake Uncoil on the App Store"><svg aria-hidden="true"><use href="#i-apple"/></svg><span><small>Download on the</small>App Store</span></a>
  </div>`;
}

function openOverlay(html) {
  ui.overlay.innerHTML = html;
  ui.overlay.hidden = false;
  ui.overlay.querySelector("button")?.focus({ preventScroll: true });
}

function closeOverlay() {
  ui.overlay.hidden = true;
  ui.overlay.innerHTML = "";
}

const starRow = (n) => `<div class="su-stars" aria-label="${n} of 3 stars">${[0, 1, 2]
  .map((i) => `<span class="${i < n ? "on" : ""}" style="--i:${i}">★</span>`).join("")}</div>`;

function showCleared(stars, best, firstClear, gainedHint) {
  const moves = game.moveCount();
  if (level >= LAST_LEVEL) {
    openOverlay(`<div class="dialog su-dialog" role="dialog" aria-modal="true" aria-labelledby="su-done">
      <p class="dlg-eyebrow">Level ${level}</p>
      <h2 id="su-done" class="good">You cleared every web level!</h2>
      ${starRow(stars)}
      <p class="dlg-note">Levels 64 to 600 are in the free app, with tunnels, mongooses, ice, caravans, ghosts and a daily puzzle.</p>
      ${storeRow("final")}
      <button type="button" class="su-link" data-choose>Choose a level</button>
    </div>`);
    ui.overlay.querySelector("[data-choose]").addEventListener("click", showLevels);
    return;
  }
  const perfect = stars === 3;
  openOverlay(`<div class="dialog su-dialog" role="dialog" aria-modal="true" aria-labelledby="su-cleared">
    <p class="dlg-eyebrow">Level ${level}${firstClear ? "" : ` · best ${"★".repeat(best)}`}</p>
    <h2 id="su-cleared" class="good">${perfect ? "Perfect!" : "Cleared!"}</h2>
    ${starRow(stars)}
    <p class="dlg-score">${moves} move${moves === 1 ? "" : "s"} · ${attempt.mistakes} bump${attempt.mistakes === 1 ? "" : "s"}${gainedHint ? " · +1 hint 💡" : ""}<br>
      <small>${perfect ? "Barely a wasted tap." : "Fewer bumps earn more stars."}</small></p>
    <button type="button" class="dlg-btn" data-next>Next level</button>
    <button type="button" class="su-link" data-again>Play again</button>
    ${platform.showsStoreLinks ? `<div class="dlg-promo"><p><strong>600 levels, daily puzzles and sticker worlds</strong> in the free app.</p>${storeRow("cleared")}</div>` : ""}
  </div>`);
  ui.overlay.querySelector("[data-next]").addEventListener("click", () => startLevel(level + 1, "next_level"));
  ui.overlay.querySelector("[data-again]").addEventListener("click", () => startLevel(level, "play_again"));
}

function showLevels() {
  platform.track("game_control", { action: "levels" });
  const open = Math.min(LAST_LEVEL, progress.furthest + 1);
  const cells = [];
  for (let n = 1; n <= LAST_LEVEL; n++) {
    const s = progress.stars[n] || 0;
    const locked = n > open;
    const cls = ["su-lv", n === level ? "is-current" : "", n % 5 === 0 ? "is-picture" : "", locked ? "is-locked" : ""].join(" ");
    cells.push(`<button type="button" class="${cls}" data-lv="${n}" ${locked ? "disabled" : ""} aria-label="Level ${n}${locked ? ", locked" : s ? `, ${s} stars` : ""}">
      <b>${n}</b><small>${locked ? "🔒" : s ? "★".repeat(s) : n % 5 === 0 ? "🖼" : "&nbsp;"}</small></button>`);
  }
  openOverlay(`<div class="dialog su-dialog su-levels" role="dialog" aria-modal="true" aria-labelledby="su-lv-title">
    <p class="dlg-eyebrow">Free in your browser</p>
    <h2 id="su-lv-title">Choose a level</h2>
    <div class="su-lv-grid">${cells.join("")}</div>
    <button type="button" class="su-link" data-close>Back to level ${level}</button>
    ${platform.showsStoreLinks ? `<div class="dlg-promo"><p><strong>537 more levels</strong> are waiting in the app.</p>${storeRow("levels")}</div>` : ""}
  </div>`);
  ui.overlay.querySelectorAll("[data-lv]").forEach((b) => b.addEventListener("click", () => startLevel(Number(b.dataset.lv), "select")));
  ui.overlay.querySelector("[data-close]").addEventListener("click", closeOverlay);
}

function showIntro(kind) {
  const intro = INTROS[kind];
  progress.intro[kind] = true;
  save();
  openOverlay(`<div class="dialog su-dialog" role="dialog" aria-modal="true" aria-labelledby="su-intro">
    <p class="dlg-eyebrow">New on this board</p>
    <h2 id="su-intro">${intro.title}</h2>
    <p class="dlg-note">${intro.body}</p>
    <button type="button" class="dlg-btn" data-ok>Got it</button>
  </div>`);
  ui.overlay.querySelector("[data-ok]").addEventListener("click", () => { sound.unlock(); closeOverlay(); });
}

// ---------- Input ----------
let down = null;
ui.board.addEventListener("pointerdown", (e) => {
  sound.unlock();
  const r = ui.board.getBoundingClientRect();
  down = { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now(), id: e.pointerId };
});
ui.board.addEventListener("pointerup", (e) => {
  if (!down || down.id !== e.pointerId) return;
  const r = ui.board.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const moved = Math.hypot(x - down.x, y - down.y);
  const quick = performance.now() - down.t < 700;
  down = null;
  if (moved < 14 && quick) handleTap(x, y);
});
ui.board.addEventListener("pointercancel", () => { down = null; });
ui.preview.addEventListener("click", () => { sound.unlock(); renderer.startPlay(); ui.preview.hidden = true; });

ui.hint.addEventListener("click", () => {
  if (progress.hints <= 0 || finishing) return;
  if (renderer.previewing) { renderer.startPlay(); ui.preview.hidden = true; }
  const id = game.hint();
  if (id < 0) return;
  progress.hints--;
  attempt.hints++;
  save();
  renderer.hint(id);
  sound.play("hint");
  renderHud();
});
ui.restart.addEventListener("click", () => {
  platform.track("game_control", { action: "restart" });
  startLevel(level, "restart");
});
ui.levels.addEventListener("click", showLevels);
ui.sound.addEventListener("click", () => {
  progress.muted = !progress.muted;
  save();
  sound.unlock();
  platform.track("game_control", { action: progress.muted ? "sound_off" : "sound_on" });
  renderHud();
});
ui.overlay.addEventListener("click", (e) => { if (e.target === ui.overlay && !finishing) closeOverlay(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !ui.overlay.hidden && !finishing) closeOverlay(); });

platform.onPause(() => sound.pause());
platform.onResume(() => sound.resume());

// Local verification only: lets a test drive taps by snake id. Never present on the live site.
if (["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.__snakeUncoil = {
    get snap() { return snap; },
    get level() { return level; },
    solve: () => JSON.parse(game.solveOrder()),
    /** Taps the middle of a snake's head cell, through the real input path. */
    tapSnake(id) {
      const s = snap.snakes.find((x) => x.id === id);
      const [x, y] = renderer.cellCentre(s.cells[s.cells.length - 1]);
      handleTap(x, y);
    },
    /** Plays the level out with the solver's own order, one tap every [ms]. */
    async autoplay(ms = 120) {
      for (const id of JSON.parse(game.solveOrder())) {
        this.tapSnake(id);
        await new Promise((r) => setTimeout(r, ms));
      }
    },
  };
}

// ---------- Go ----------
const startAt = progress.current && progress.current <= progress.furthest + 1 ? progress.current : progress.furthest + 1;
await startLevel(Math.min(LAST_LEVEL, startAt), "auto_start");
platform.firstFrameReady();
platform.gameReady();
ui.stage.classList.add("is-ready");
