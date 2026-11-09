// Snake Uncoil board renderer: Canvas 2D port of the app's SnakeGameView / SnakeArtV2.
// It draws what the engine says (snapshots and tap outcomes from engine/*.mjs) and owns every
// animation; it never decides a rule. Units: "cell" coordinates are (col + 0.5, row + 0.5) for a
// cell's centre; px = origin + cell * size.

// SnakeRenderer.PALETTE, in the app's order.
const PALETTE = [
  [255, 94, 91], [90, 162, 255], [74, 214, 146], [255, 168, 66], [184, 128, 255], [72, 219, 226],
  [255, 220, 92], [255, 133, 196], [134, 128, 255], [255, 138, 101], [150, 214, 96], [240, 112, 160],
];

function hue([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
const WHEEL_ORDER = PALETTE.map((_, i) => i).sort((a, b) => hue(PALETTE[a]) - hue(PALETTE[b]));

/** SnakeRenderer.levelFamily: six evenly spaced hues, rotated by level. */
function levelFamily(level) {
  const offset = (level * 5) % WHEEL_ORDER.length;
  return Array.from({ length: 6 }, (_, i) => PALETTE[WHEEL_ORDER[(offset + i * 2) % WHEEL_ORDER.length]]);
}

/** BoardColoring.assign: touching snakes always differ, colours used about equally. */
function assignColours(snakes, slots) {
  const owner = new Map();
  for (const s of snakes) for (const [r, c] of s.cells) owner.set(r * 1000 + c, s.id);
  const neighbours = new Map();
  for (const s of snakes) {
    const set = new Set();
    for (const [r, c] of s.cells) {
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const o = owner.get((r + dr) * 1000 + c + dc);
        if (o !== undefined && o !== s.id) set.add(o);
      }
    }
    neighbours.set(s.id, set);
  }
  const order = [...snakes].sort((a, b) => neighbours.get(b.id).size - neighbours.get(a.id).size || a.id - b.id);
  const result = new Map();
  const usage = new Array(slots).fill(0);
  for (const s of order) {
    const taken = new Set([...neighbours.get(s.id)].map((n) => result.get(n)).filter((x) => x !== undefined));
    let best = -1;
    for (let k = 0; k < slots; k++) if (!taken.has(k) && (best < 0 || usage[k] < usage[best])) best = k;
    if (best < 0) best = usage.indexOf(Math.min(...usage));
    result.set(s.id, best);
    usage[best]++;
  }
  return result;
}

const rgb = ([r, g, b], a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const mix = (c, t, k) => c.map((v, i) => v + (t[i] - v) * k);
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

// SnakeVisualStyleV2, in cell units (W = body width).
const W = 0.56;
const TAIL_TIP = 0.42;
const HEAD_WIDTH = 1.24;
const CORNER = 0.42;

// Escape timing (SnakeGameView): 46ms a step, accelerating, capped at 1.5s.
const ESCAPE_STEP_MS = 46;
const ESCAPE_MAX_MS = 1500;
const ESCAPE_ACCEL = 0.35;
const BOARD_ENTRANCE_MS = 420;
const HINT_MS = 3000;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The points a snake's centreline passes through, densely sampled, tail first. [pts] are cell
 * centres; corners are rounded with a quadratic curve, the tail end pulled back into its cell and
 * the head pushed forward so the body fills its cells.
 */
function sampleCentreline(pts, headDir, step) {
  const n = pts.length;
  let tailDir;
  if (n > 1) {
    const dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1];
    const len = Math.hypot(dx, dy) || 1;
    tailDir = [dx / len, dy / len];
  } else {
    tailDir = headDir;
  }
  const P = [[pts[0][0] - tailDir[0] * 0.3, pts[0][1] - tailDir[1] * 0.3], ...pts];
  const last = pts[n - 1];
  P.push([last[0] + headDir[0] * 0.22, last[1] + headDir[1] * 0.22]);

  const out = [];
  const pushLine = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let i = out.length ? 1 : 0; i <= k; i++) out.push([a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k]);
  };
  let cursor = P[0];
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const d1 = [b[0] - a[0], b[1] - a[1]], d2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    const straight = l1 < 1e-6 || l2 < 1e-6 || Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-6;
    if (straight) continue;
    const r = Math.min(CORNER, l1 / 2, l2 / 2);
    const p0 = [b[0] - (d1[0] / l1) * r, b[1] - (d1[1] / l1) * r];
    const p2 = [b[0] + (d2[0] / l2) * r, b[1] + (d2[1] / l2) * r];
    pushLine(cursor, p0);
    const k = 6;
    for (let j = 1; j <= k; j++) {
      const t = j / k, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]]);
    }
    cursor = p2;
  }
  pushLine(cursor, P[P.length - 1]);
  return out;
}

/** The cells of a fractional window [s, s + len - 1] along [track] (cell centres). */
function windowPoints(track, s, len) {
  const at = (x) => {
    const i = Math.max(0, Math.min(track.length - 2, Math.floor(x)));
    const t = x - i;
    return [track[i][0] + (track[i + 1][0] - track[i][0]) * t, track[i][1] + (track[i + 1][1] - track[i][1]) * t];
  };
  const end = s + len - 1;
  const pts = [at(s)];
  for (let k = Math.floor(s) + 1; k < end; k++) if (k > s) pts.push(track[k]);
  if (end > s) pts.push(at(end));
  return pts;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const cache = document.createElement("canvas");
  const cctx = cache.getContext("2d");

  let dpr = 1, cssW = 0, cssH = 0;
  let snap = null, level = 0, colours = new Map(), family = [];
  let size = 20, ox = 0, oy = 0;
  let picture = null, pictureCanvas = null, pictureState = "none", pictureT0 = 0;
  let cacheValid = false, cacheExclude = new Set();
  let entranceT0 = 0;
  const anims = [];
  const effects = [];
  let hintId = null, hintT0 = 0;
  let coach = null;
  let frameQueued = false;
  let onIdle = null;

  const snakeById = () => new Map((snap?.snakes || []).map((s) => [s.id, s]));
  const toPx = ([x, y]) => [ox + x * size, oy + y * size];
  const centre = ([r, c]) => [c + 0.5, r + 0.5];

  function layout() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [canvas, cache]) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
    }
    if (snap) {
      const pad = cssW < 500 ? 10 : 20;
      size = Math.min((cssW - pad * 2) / snap.cols, (cssH - pad * 2) / snap.rows, 64);
      ox = (cssW - size * snap.cols) / 2;
      oy = (cssH - size * snap.rows) / 2;
      if (picture) renderPicture();
    }
    cacheValid = false;
    request();
  }

  function playable(r, c) {
    if (r < 0 || c < 0 || r >= snap.rows || c >= snap.cols) return false;
    return !snap.mask || snap.mask[r][c] === "#";
  }

  // ---------- Board panel ----------
  function trayPath(inflate = 0) {
    const p = new Path2D();
    if (!snap.mask) {
      p.roundRect(ox - 6 - inflate, oy - 6 - inflate, size * snap.cols + 12 + inflate * 2, size * snap.rows + 12 + inflate * 2, 14 + inflate);
      return p;
    }
    for (let r = 0; r < snap.rows; r++) {
      let c = 0;
      while (c < snap.cols) {
        if (snap.mask[r][c] !== "#") { c++; continue; }
        const start = c;
        while (c < snap.cols && snap.mask[r][c] === "#") c++;
        p.rect(ox + start * size - inflate, oy + r * size - inflate, (c - start) * size + inflate * 2, size + inflate * 2);
      }
    }
    return p;
  }

  function drawTray(g) {
    g.save();
    g.shadowColor = "rgba(0,0,0,0.45)";
    g.shadowBlur = 24;
    g.shadowOffsetY = 8;
    g.fillStyle = "#3a4560";
    g.fill(trayPath(snap.mask ? 2 : 1.5));
    g.restore();
    const fill = g.createLinearGradient(0, oy, 0, oy + size * snap.rows);
    fill.addColorStop(0, "#1b2338");
    fill.addColorStop(1, "#111727");
    g.fillStyle = fill;
    g.fill(trayPath());
    // Grid at half the old alpha (game screen v2).
    g.save();
    g.clip(trayPath());
    g.strokeStyle = "rgba(255,255,255,0.055)";
    g.lineWidth = 1;
    g.beginPath();
    for (let c = 1; c < snap.cols; c++) { g.moveTo(ox + c * size, oy); g.lineTo(ox + c * size, oy + snap.rows * size); }
    for (let r = 1; r < snap.rows; r++) { g.moveTo(ox, oy + r * size); g.lineTo(ox + snap.cols * size, oy + r * size); }
    g.stroke();
    g.restore();
  }

  // ---------- Picture levels ----------
  function renderPicture() {
    const w = Math.max(1, Math.round(size * snap.cols * dpr));
    const h = Math.max(1, Math.round(size * snap.rows * dpr));
    pictureCanvas = document.createElement("canvas");
    pictureCanvas.width = w;
    pictureCanvas.height = h;
    pictureCanvas.getContext("2d").drawImage(picture, 0, 0, w, h);
  }

  function drawPicture(g, dim) {
    if (!pictureCanvas) return;
    g.drawImage(pictureCanvas, ox, oy, size * snap.cols, size * snap.rows);
    if (dim > 0) {
      g.save();
      g.fillStyle = `rgba(11,14,22,${dim})`;
      g.fill(trayPath());
      g.restore();
    }
  }

  // ---------- Snakes ----------
  function colourOf(id) {
    return family[colours.get(id) ?? 0] || PALETTE[0];
  }

  /**
   * One snake along [pts] (cell centres, tail first). Four passes, as in SnakeRendererV2: a soft
   * shadow (or a dark keyline on picture boards), the tapered tube, a lit top and shaded
   * underside inside it, then the head's eyes.
   */
  function drawSnake(g, pts, dirName, colour, opts = {}) {
    const dir = DIRS[dirName];
    // About one sample every 2.5px, so big cells stay smooth and small ones stay cheap.
    const samples = sampleCentreline(pts, dir, Math.max(0.04, Math.min(0.12, 2.5 / size)));
    const lens = [0];
    for (let i = 1; i < samples.length; i++) lens.push(lens[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
    const total = lens[lens.length - 1] || 1;
    const taper = Math.min(total * 0.5, 2.2);
    const widthAt = (d) => {
      const t = clamp01(d / taper);
      return W * (TAIL_TIP + (1 - TAIL_TIP) * (t * t * (3 - 2 * t)));
    };

    const circles = (radiusAdd, dx, dy, scale = 1) => {
      const p = new Path2D();
      for (let i = 0; i < samples.length; i++) {
        const [x, y] = toPx(samples[i]);
        const r = ((widthAt(lens[i]) * scale) / 2 + radiusAdd) * size;
        p.moveTo(x + dx * size + r, y + dy * size);
        p.arc(x + dx * size, y + dy * size, r, 0, Math.PI * 2);
      }
      return p;
    };
    const head = samples[samples.length - 1];
    const [hx, hy] = toPx([head[0] - dir[0] * 0.12, head[1] - dir[1] * 0.12]);
    const headPath = (add) => {
      const p = new Path2D();
      p.ellipse(hx, hy, ((W * HEAD_WIDTH) / 2 + add) * size, ((W * HEAD_WIDTH) / 2 + add) * size * 0.92, Math.atan2(dir[1], dir[0]), 0, Math.PI * 2);
      return p;
    };

    g.save();
    if (opts.alpha !== undefined) g.globalAlpha = opts.alpha;
    if (opts.crisp) {
      g.fillStyle = "rgba(8,10,18,0.95)";
      g.fill(circles(0.06, 0, 0));
      g.fill(headPath(0.06));
    } else {
      g.fillStyle = "rgba(0,0,0,0.32)";
      g.fill(circles(0.02, 0, 0.07));
      g.fill(headPath(0.02));
    }
    const body = circles(0, 0, 0);
    body.addPath(headPath(0));
    // A sleeper is greyed toward slate so it reads as "not now" before the badge is found.
    let base = opts.asleep ? mix(colour, [120, 130, 165], 0.5) : colour;
    if (opts.tint) base = mix(base, [255, 255, 255], opts.tint);
    g.fillStyle = rgb(base);
    g.fill(body);
    g.save();
    g.clip(body);
    g.fillStyle = rgb(mix(base, [10, 12, 30], 0.35), 0.55);
    g.fill(circles(0, 0.06, 0.12, 0.8));
    if (!opts.crisp) {
      g.fillStyle = rgb(mix(base, [255, 255, 255], 0.55), 0.5);
      g.fill(circles(0, -0.05, -0.1, 0.42));
    }
    g.restore();

    // Eyes: big, set forward, pupils looking where the snake will go.
    const perp = [-dir[1], dir[0]];
    const eyeR = W * 0.27 * size;
    for (const side of [-1, 1]) {
      const ex = hx + (perp[0] * side * W * 0.3 + dir[0] * W * 0.12) * size;
      const ey = hy + (perp[1] * side * W * 0.3 + dir[1] * W * 0.12) * size;
      if (opts.asleep) {
        g.strokeStyle = "rgba(20,16,30,0.9)";
        g.lineWidth = Math.max(1, eyeR * 0.35);
        g.lineCap = "round";
        g.beginPath();
        g.arc(ex, ey - eyeR * 0.1, eyeR * 0.7, 0.15 * Math.PI, 0.85 * Math.PI);
        g.stroke();
        continue;
      }
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(ex, ey, eyeR, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#1a1626";
      g.beginPath();
      g.arc(ex + dir[0] * eyeR * 0.38, ey + dir[1] * eyeR * 0.38, eyeR * 0.54, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.beginPath();
      g.arc(ex + dir[0] * eyeR * 0.2 - eyeR * 0.2, ey + dir[1] * eyeR * 0.2 - eyeR * 0.25, eyeR * 0.18, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    return { mid: samples[Math.floor(samples.length / 2)], head };
  }

  // ---------- Mechanics ----------
  const mech = () => snap.mech || { sleepers: [], gates: [], grass: [], escaped: 0 };

  /** A gate cell: a gold block with dark bars, glowing so it reads at a 10px cell. */
  function drawGate(g, gate, alpha = 1) {
    g.save();
    g.globalAlpha = alpha;
    for (const [r, c] of gate.cells) {
      const x = ox + c * size, y = oy + r * size, pad = size * 0.04;
      g.shadowColor = "rgba(255,194,75,0.85)";
      g.shadowBlur = Math.max(6, size * 0.5);
      const gr = g.createLinearGradient(0, y, 0, y + size);
      gr.addColorStop(0, "#ffe08a");
      gr.addColorStop(1, "#e0962a");
      g.fillStyle = gr;
      g.beginPath();
      g.roundRect(x + pad, y + pad, size - pad * 2, size - pad * 2, size * 0.18);
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = "rgba(70,40,0,0.9)";
      g.lineWidth = Math.max(1.2, size * 0.1);
      g.lineCap = "round";
      g.beginPath();
      for (const f of [0.3, 0.5, 0.7]) { g.moveTo(x + size * f, y + size * 0.2); g.lineTo(x + size * f, y + size * 0.8); }
      g.stroke();
    }
    g.restore();
  }

  /** The key on a gate's key snake: a gold key on a dark disc, never smaller than a fingertip mark. */
  function drawKey(g, at) {
    const [x, y] = toPx(at);
    const R = Math.max(8, size * 0.46);
    g.save();
    g.fillStyle = "rgba(30,20,4,0.9)";
    g.strokeStyle = "#ffc24b";
    g.lineWidth = Math.max(1.2, R * 0.14);
    g.beginPath();
    g.arc(x, y, R, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.translate(x, y);
    g.rotate(-0.7);
    const s = R * 0.62;
    g.fillStyle = "#ffd24a";
    g.beginPath();
    g.arc(-s * 0.5, 0, s * 0.42, 0, Math.PI * 2);
    g.rect(-s * 0.15, -s * 0.13, s * 1.15, s * 0.26);
    g.rect(s * 0.6, s * 0.1, s * 0.18, s * 0.28);
    g.rect(s * 0.85, s * 0.1, s * 0.16, s * 0.2);
    g.fill();
    g.fillStyle = "rgba(30,20,4,0.95)";
    g.beginPath();
    g.arc(-s * 0.5, 0, s * 0.16, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawStar(g, at, scale = 1) {
    const [x, y] = toPx(at);
    const R = Math.max(8, size * 0.42) * scale, r = R * 0.45;
    g.save();
    g.fillStyle = "#ffe066";
    g.strokeStyle = "rgba(90,60,0,0.9)";
    g.lineWidth = Math.max(1, size * 0.05);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r : R;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  function drawGrass(g, patch, alpha = 1) {
    g.save();
    g.globalAlpha = alpha;
    const cells = new Set(patch.cells.map(([r, c]) => r * 1000 + c));
    for (const [r, c] of patch.cells) {
      const x = ox + c * size, y = oy + r * size;
      const gr = g.createLinearGradient(0, y, 0, y + size);
      gr.addColorStop(0, "#4fa64a");
      gr.addColorStop(1, "#2d6e31");
      g.fillStyle = gr;
      g.fillRect(x - 0.5, y - 0.5, size + 1, size + 1);
      // Blades: deterministic per cell so the cache and the fade agree.
      g.strokeStyle = "rgba(170,230,120,0.75)";
      g.lineWidth = Math.max(1, size * 0.06);
      g.lineCap = "round";
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const seed = ((r * 31 + c * 17 + k * 7) % 13) / 13;
        const bx = x + size * (0.15 + 0.7 * ((k + seed) / 4));
        g.moveTo(bx, y + size * 0.85);
        g.lineTo(bx + size * (seed - 0.5) * 0.25, y + size * (0.35 + 0.2 * seed));
      }
      g.stroke();
      if (!cells.has((r - 1) * 1000 + c)) {
        g.fillStyle = "rgba(200,255,150,0.25)";
        g.fillRect(x, y, size, size * 0.12);
      }
    }
    g.restore();
  }

  function drawSleepBadge(g, snake, remaining) {
    const head = centre(snake.cells[snake.cells.length - 1]);
    const [x, y] = toPx([head[0] + 0.45, head[1] - 0.55]);
    const r = Math.max(8, size * 0.36);
    g.save();
    g.fillStyle = "rgba(30,26,60,0.92)";
    g.strokeStyle = "#a99bff";
    g.lineWidth = Math.max(1, size * 0.05);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = "#e9e4ff";
    g.font = `800 ${Math.round(r * 1.05)}px "Baloo 2", system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(remaining > 0 ? String(remaining) : "z", x, y + r * 0.08);
    g.restore();
  }

  // ---------- The resting board, rasterized once per state ----------
  function rebuildCache() {
    const g = cctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cache.width, cache.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!snap) return;
    drawTray(g);
    if (pictureCanvas) drawPicture(g, pictureState === "done" ? 0 : 0.38);
    const m = mech();
    const sleeping = new Map(m.sleepers.filter((s) => !s.awake).map((s) => [s.id, s.wakeAt - m.escaped]));
    const keyFor = new Map(m.gates.filter((gt) => !gt.open).map((gt) => [gt.key, gt]));
    const starFor = new Set(m.grass.filter((p) => !p.cleared).flatMap((p) => p.stars));
    for (const gate of m.gates) if (!gate.open) drawGate(g, gate);
    const marks = [];
    for (const s of snap.snakes) {
      if (cacheExclude.has(s.id)) continue;
      const res = drawSnake(g, s.cells.map(centre), s.dir, colourOf(s.id), { crisp: !!pictureCanvas, asleep: sleeping.has(s.id) });
      if (sleeping.has(s.id)) marks.push(() => drawSleepBadge(g, s, sleeping.get(s.id)));
      if (keyFor.has(s.id)) marks.push(() => drawKey(g, res.mid));
      if (starFor.has(s.id)) marks.push(() => drawStar(g, res.mid, 0.9));
    }
    for (const patch of m.grass) if (!patch.cleared) drawGrass(g, patch);
    for (const mark of marks) mark();
    cacheValid = true;
  }

  // ---------- Frame ----------
  function request() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(frame);
  }

  function frame(now) {
    frameQueued = false;
    if (!snap) return;
    const excludeNow = new Set(anims.filter((a) => a.kind === "bump").map((a) => a.id));
    if ([...excludeNow].join() !== [...cacheExclude].join()) { cacheExclude = excludeNow; cacheValid = false; }
    if (!cacheValid) rebuildCache();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Picture preview: the art alone, full brightness, before the snakes arrive.
    if (pictureState === "preview") {
      drawTray(ctx);
      drawPicture(ctx, 0);
      return;
    }

    const e = reducedMotion() ? 1 : clamp01((now - entranceT0) / BOARD_ENTRANCE_MS);
    ctx.save();
    if (e < 1) {
      const k = 0.9 + 0.1 * easeOutBack(e);
      const cx = cssW / 2, cy = cssH / 2;
      ctx.globalAlpha = e;
      ctx.translate(cx, cy);
      ctx.scale(k, k);
      ctx.translate(-cx, -cy);
    }
    if (pictureState === "finale") {
      const t = clamp01((now - pictureT0) / 900);
      const pulse = 1 + 0.035 * Math.sin(Math.PI * t);
      const cx = ox + (size * snap.cols) / 2, cy = oy + (size * snap.rows) / 2;
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);
      ctx.translate(-cx, -cy);
      drawTray(ctx);
      drawPicture(ctx, 0.38 * (1 - t));
    } else {
      ctx.drawImage(cache, 0, 0, cssW, cssH);
    }
    ctx.restore();

    drawHint(now);
    // Anything that ends this frame still needs one more clean frame without it.
    let live = false;
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      const done = a.kind === "escape" ? drawEscape(a, now) : drawBump(a, now);
      if (done) anims.splice(i, 1);
      live = true;
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      if (effects[i](now)) effects.splice(i, 1);
      live = true;
    }
    if (coach) { drawCoach(now); live = true; }
    if (live || e < 1 || hintId !== null || pictureState === "finale") request();
    else onIdle?.();
  }

  function trackFor(snake, extra) {
    const t = snake.cells.map(centre);
    const d = DIRS[snake.dir];
    let last = t[t.length - 1];
    for (const cell of extra) { t.push(centre(cell)); last = t[t.length - 1]; }
    return { t, d, last };
  }

  function drawEscape(a, now) {
    const t = clamp01((now - a.t0) / a.ms);
    const eased = t * (1 - ESCAPE_ACCEL) + t * t * ESCAPE_ACCEL;
    const s = eased * a.exitStep;
    // Past the tray's edge the snake fades as it goes, so it never lingers over the page.
    const out = clamp01((s + a.len - 1 - a.edgeIndex) / Math.max(1, a.len + 1));
    drawSnake(ctx, windowPoints(a.track, s, a.len), a.snake.dir, a.colour, { crisp: !!pictureCanvas, alpha: 1 - out * out });
    if (!a.flashed && s + a.len - 1 >= a.edgeIndex + 0.5) {
      a.flashed = true;
      exitFlash(a.track[a.edgeIndex], a.colour);
    }
    return t >= 1;
  }

  function drawBump(a, now) {
    const t = clamp01((now - a.t0) / a.ms);
    const leg = t < 0.5 ? easeInOut(t * 2) : easeInOut((1 - t) * 2);
    const s = leg * a.peak;
    drawSnake(ctx, windowPoints(a.track, s, a.len), a.snake.dir, a.colour, { crisp: !!pictureCanvas, tint: 0.25 * leg, asleep: a.asleep });
    if (!a.hit && t >= 0.5) {
      a.hit = true;
      const headIdx = Math.min(a.track.length - 1, a.len - 1 + Math.ceil(a.peak));
      const p = a.track[headIdx];
      puff([p[0] + a.d[0] * 0.5, p[1] + a.d[1] * 0.5], [255, 255, 255]);
    }
    return t >= 1;
  }

  function exitFlash(at, colour) {
    const t0 = performance.now();
    effects.push((now) => {
      const t = (now - t0) / 280;
      if (t >= 1) return true;
      const [x, y] = toPx(at);
      const r = size * (0.5 + 0.9 * t);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${0.85 * (1 - t)})`);
      gr.addColorStop(0.5, rgb(colour, 0.5 * (1 - t)));
      gr.addColorStop(1, rgb(colour, 0));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      return false;
    });
  }

  function puff(at, colour) {
    const t0 = performance.now();
    const bits = Array.from({ length: 6 }, (_, i) => (i / 6) * Math.PI * 2 + Math.random() * 0.5);
    effects.push((now) => {
      const t = (now - t0) / 360;
      if (t >= 1) return true;
      const [x, y] = toPx(at);
      ctx.fillStyle = rgb(colour, 0.7 * (1 - t));
      for (const a of bits) {
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * size * 0.5 * t, y + Math.sin(a) * size * 0.5 * t, size * 0.08 * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      return false;
    });
  }

  function drawHint(now) {
    if (hintId === null) return;
    const t = (now - hintT0) / HINT_MS;
    const snake = snakeById().get(hintId);
    if (t >= 1 || !snake) { hintId = null; return; }
    const head = centre(snake.cells[snake.cells.length - 1]);
    const [x, y] = toPx(head);
    for (let k = 0; k < 2; k++) {
      const p = ((now - hintT0) / 900 + k * 0.5) % 1;
      ctx.strokeStyle = `rgba(255,194,75,${0.9 * (1 - p)})`;
      ctx.lineWidth = Math.max(2, size * 0.12);
      ctx.beginPath();
      ctx.arc(x, y, size * (0.5 + p * 1.1), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawCoach(now) {
    const snake = snakeById().get(coach.id);
    if (!snake) { coach = null; return; }
    const cells = snake.cells;
    const mid = centre(cells[Math.floor(cells.length / 2)]);
    const [x, y] = toPx(mid);
    const t = (now % 1400) / 1400;
    const press = t < 0.35 ? t / 0.35 : t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    const lift = (1 - press) * size * 0.6;
    if (press > 0.9) {
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.save();
    ctx.font = `${Math.round(Math.max(28, size * 0.9))}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 8;
    ctx.fillText("👆", x - size * 0.25, y + lift - size * 0.05);
    ctx.restore();
  }

  // ---------- Public API ----------
  const api = {
    /** A new board. [pictureImg] is the level's picture (an HTMLImageElement) or null. */
    setLevel(snapshot, levelNumber, pictureImg) {
      snap = snapshot;
      level = levelNumber;
      family = levelFamily(levelNumber);
      colours = assignColours(snap.snakes, family.length);
      picture = pictureImg;
      pictureCanvas = null;
      pictureState = picture ? "preview" : "none";
      anims.length = 0;
      effects.length = 0;
      hintId = null;
      coach = null;
      cacheExclude = new Set();
      layout();
      if (!picture) entranceT0 = performance.now();
      request();
    },

    /** The picture level's "tap to play": snakes pop in over the art. */
    startPlay() {
      if (pictureState !== "preview") return;
      pictureState = "play";
      entranceT0 = performance.now();
      cacheValid = false;
      request();
    },

    get previewing() { return pictureState === "preview"; },

    /** The board after a tap. Animations already running keep going. */
    update(snapshot) {
      snap = snapshot;
      cacheValid = false;
      request();
    },

    escape(snake, path) {
      const d = DIRS[snake.dir];
      const extra = path.slice();
      let last = extra.length ? extra[extra.length - 1] : snake.cells[snake.cells.length - 1];
      const edgeIndex = snake.cells.length - 1 + extra.length;
      for (let k = 0; k < snake.cells.length + 2; k++) {
        last = [last[0] + d[1], last[1] + d[0]];
        extra.push(last);
      }
      const { t } = trackFor(snake, extra);
      const exitStep = snake.cells.length + path.length;
      const ms = reducedMotion() ? 200 : Math.min(ESCAPE_MAX_MS, ESCAPE_STEP_MS * exitStep);
      anims.push({ kind: "escape", id: snake.id, snake, track: t, len: snake.cells.length, exitStep, edgeIndex, ms, t0: performance.now(), colour: colourOf(snake.id) });
      if (hintId === snake.id) hintId = null;
      request();
    },

    bump(snake, run, asleep = false) {
      for (let i = anims.length - 1; i >= 0; i--) if (anims[i].id === snake.id) anims.splice(i, 1);
      const d = DIRS[snake.dir];
      const extra = [];
      let last = snake.cells[snake.cells.length - 1];
      for (let k = 0; k < Math.max(1, run) + 1; k++) {
        last = [last[0] + d[1], last[1] + d[0]];
        extra.push(last);
      }
      const { t } = trackFor(snake, extra);
      const peak = run > 0 ? run : 0.25;
      const ms = Math.min(700, 200 + 26 * Math.max(run, 1) * 2);
      anims.push({ kind: "bump", id: snake.id, snake, track: t, len: snake.cells.length, peak, ms, d, asleep, t0: performance.now(), colour: colourOf(snake.id) });
      request();
    },

    /** A gate opening or grass clearing: fade the old drawing out over the board. */
    fadeOut(kind, item) {
      const t0 = performance.now();
      effects.push((now) => {
        const t = (now - t0) / 450;
        if (t >= 1) return true;
        if (kind === "gate") drawGate(ctx, item, 1 - t);
        else drawGrass(ctx, item, 1 - t);
        return false;
      });
      request();
    },

    wake(snake) {
      const head = centre(snake.cells[snake.cells.length - 1]);
      puff(head, [200, 190, 255]);
      request();
    },

    hint(id) {
      hintId = id;
      hintT0 = performance.now();
      request();
    },

    coach(id) {
      coach = id === null ? null : { id };
      request();
    },

    ripple(x, y) {
      const t0 = performance.now();
      effects.push((now) => {
        const t = (now - t0) / 300;
        if (t >= 1) return true;
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - t)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6 + 18 * t, 0, Math.PI * 2);
        ctx.stroke();
        return false;
      });
      request();
    },

    /** The picture level's finale: the art lights up and pulses. Resolves when it has played. */
    finale() {
      if (!pictureCanvas) return Promise.resolve();
      pictureState = "finale";
      pictureT0 = performance.now();
      request();
      return new Promise((resolve) => setTimeout(() => {
        pictureState = "done";
        cacheValid = false;
        request();
        resolve();
      }, reducedMotion() ? 300 : 1400));
    },

    /** Resolves once every running animation has had its time. Clock-based, not frame-based, so
     * finishing a level never waits on frames (a background tab gets almost none). */
    settled() {
      const end = Math.max(0, ...anims.map((a) => a.t0 + a.ms));
      return new Promise((resolve) => setTimeout(resolve, Math.max(0, end - performance.now()) + 30));
    },

    /** The board cell under a CSS-pixel point, or null. */
    cellAt(x, y) {
      if (!snap) return null;
      const c = Math.floor((x - ox) / size), r = Math.floor((y - oy) / size);
      return r >= 0 && c >= 0 && r < snap.rows && c < snap.cols ? [r, c] : null;
    },

    /** A cell's centre in CSS px. */
    cellCentre([r, c]) {
      return [ox + (c + 0.5) * size, oy + (r + 0.5) * size];
    },

    /** Distance in CSS px from a point to the nearest cell of [snake]. */
    distanceTo(snake, x, y) {
      let best = Infinity;
      for (const [r, c] of snake.cells) {
        const x0 = ox + c * size, y0 = oy + r * size;
        const dx = Math.max(x0 - x, 0, x - (x0 + size));
        const dy = Math.max(y0 - y, 0, y - (y0 + size));
        best = Math.min(best, Math.hypot(dx, dy));
      }
      return best;
    },

    resize: layout,
    onIdle(fn) { onIdle = fn; },
  };

  if (window.ResizeObserver) new ResizeObserver(() => layout()).observe(canvas);
  else window.addEventListener("resize", layout);
  return api;
}

/** Loads a level's picture SVG, stretched to fill whatever box it is drawn into (the art's
 * viewBox is the shape's own mask grid, so stretching lines it up with the cells). */
export async function loadPicture(url) {
  const text = await (await fetch(url)).text();
  const svg = text.replace("<svg ", '<svg preserveAspectRatio="none" width="600" height="600" ');
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  await img.decode();
  return img;
}

export { DIRS };
