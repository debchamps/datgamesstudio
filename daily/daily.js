// The Daily Trick: hub and puzzle pages. Puzzles are move trees exported by the app's
// puzzle forge (AndroidGames/puzzle-shared, `web` command), so the browser replays exactly
// what the app plays without a solver. See AndroidGames/docs/DAILY_TRICK_SOCIAL_FUNNEL_PLAN_2026_11.md.

const CFG = JSON.parse(document.getElementById("dt-config").textContent);
const EPOCH = CFG.epochDay; // local epoch day of puzzle #1
const COUNT = CFG.count;
const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" };
const SUIT_NAME = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
const RANK_NAME = { A: "ace", K: "king", Q: "queen", J: "jack", T: "10" };
const SEAT_NAME = { N: "North", E: "East", S: "South", W: "West" };
const PARTNERS = new Set(["spades", "twentynine", "tarneeb", "bridge", "euchre"]);
const OG = new URLSearchParams(location.search).get("og");

const $ = (sel, root = document) => root.querySelector(sel);
const FAST = OG || new URLSearchParams(location.search).has("fast"); // tests and social images
const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? 0 : ms));
const track = (name, params = {}) => { try { window.datTrack?.(name, params); } catch (_) {} };

// ---------- Days ----------
function localDay(d = new Date()) {
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
}
const TODAY = localDay();
const TODAY_NUMBER = TODAY - EPOCH + 1;
const fileFor = (n) => ((((n - 1) % COUNT) + COUNT) % COUNT) + 1;
function dateOf(n) {
  const d = new Date((EPOCH + n - 1) * 86400000);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}
function untilMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const s = Math.max(0, Math.floor((next - now) / 1000));
  const pad = (x) => String(x).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
function tickCountdowns() {
  document.querySelectorAll("[data-countdown]").forEach((el) => { el.textContent = untilMidnight(); });
}
setInterval(tickCountdowns, 1000);

// ---------- Storage (per browser; never required) ----------
const STORE_KEY = "dt:v1";
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (_) { return {}; }
}
function saveStore(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (_) {}
}
function solvedRecord(game, n) { return (loadStore().solved || {})[`${game}:${n}`] || null; }
function liveStreak(s = loadStore()) {
  const st = s.streak || {};
  return st.last === TODAY || st.last === TODAY - 1 ? st.current || 0 : 0;
}
function recordSolve(game, n, stars, attempts) {
  const s = loadStore();
  s.solved = s.solved || {};
  const key = `${game}:${n}`;
  const first = !s.solved[key];
  if (first) s.solved[key] = { stars, attempts, day: TODAY };
  // The streak counts days on which today's puzzle of any game was solved.
  if (n === TODAY_NUMBER) {
    const st = s.streak || { current: 0, best: 0, last: null };
    if (st.last !== TODAY) {
      st.current = liveStreak(s) + 1;
      st.best = Math.max(st.best || 0, st.current);
      st.last = TODAY;
    }
    s.streak = st;
  }
  saveStore(s);
  return first;
}

// ---------- Cards ----------
const rankLabel = (r) => (r === "T" ? "10" : r);
const isRed = (id) => id[0] === "H" || id[0] === "D";
const cardName = (id) => `${RANK_NAME[id[1]] || id[1]} of ${SUIT_NAME[id[0]]}`;
const cardShort = (id) => `${rankLabel(id[1])}${SUIT[id[0]]}`;

function cardEl(id, mini = false) {
  const d = document.createElement("div");
  d.className = `pcard${isRed(id) ? " red" : ""}${mini ? " mini" : ""}`;
  d.innerHTML = `<span class="pc-corner">${rankLabel(id[1])}<i>${SUIT[id[0]]}</i></span><span class="pc-pip">${SUIT[id[0]]}</span>`;
  d.setAttribute("aria-hidden", "true");
  return d;
}

/** Suits alternate colours with trump first; within a suit, the game's own ranking. */
function sortHand(cards, p) {
  const base = ["S", "H", "C", "D"];
  const start = p.trump ? base.indexOf(p.trump) : 0;
  const suits = base.slice(start).concat(base.slice(0, start));
  return [...cards].sort((a, b) => suits.indexOf(a[0]) - suits.indexOf(b[0]) || p.order[b] - p.order[a]);
}

// ---------- Store links ----------
function platform() {
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return "desktop";
}
function storeLinks(g, content) {
  const play = g.android
    ? `https://play.google.com/store/apps/details?id=${g.android}&utm_source=website&utm_medium=daily&utm_campaign=daily_${g.key}&utm_content=${content}`
    : null;
  const apple = g.apple ? `https://apps.apple.com/app/id${g.apple}?ct=daily_${content}` : null;
  return { play, apple };
}
function storeRow(g, content) {
  const { play, apple } = storeLinks(g, content);
  const p = platform();
  const btn = (href, store) => {
    if (!href) return "";
    const icon = store === "play" ? "#i-play" : "#i-apple";
    const label = store === "play" ? "<small>Get it on</small>Google Play" : "<small>Download on the</small>App Store";
    const aria = `${g.title} on ${store === "play" ? "Google Play" : "the App Store"}`;
    return `<a class="store-btn" href="${href}" rel="noopener" aria-label="${aria}"><svg aria-hidden="true"><use href="${icon}"/></svg><span>${label}</span></a>`;
  };
  // On a phone, show only that phone's store; elsewhere, both.
  if (p === "android" && play) return btn(play, "play");
  if (p === "ios" && apple) return btn(apple, "apple");
  return btn(play, "play") + btn(apple, "apple");
}
function appPitch(g) {
  const p = platform();
  const inApp = p === "ios" ? CFG.puzzlesInApp.ios : CFG.puzzlesInApp.android;
  if (p === "ios" && !g.apple) {
    return { title: `Play ${g.title} free in your browser`, text: "Full matches against computer players. No download needed.", web: true };
  }
  return inApp
    ? { title: `More ${g.title} puzzles in the app`, text: "A new puzzle every day, the archive, streaks and full matches. Free." }
    : { title: `Play full ${g.title}, free`, text: "Offline, no signup. Smart computer players, stats and themes." };
}

// ---------- Hub ----------
async function hub() {
  const root = $("[data-hub]");
  $("[data-hub-number]").textContent = `#${TODAY_NUMBER}`;
  $("[data-hub-date]").textContent = dateOf(TODAY_NUMBER);
  const streak = liveStreak();
  const streakEl = $("[data-hub-streak]");
  if (streak > 0) { streakEl.hidden = false; streakEl.textContent = `🔥 ${streak}-day streak`; }
  tickCountdowns();
  for (const key of CFG.order) {
    const g = CFG.games[key];
    const tile = root.querySelector(`[data-tile="${key}"]`);
    try {
      const meta = await fetch(`/daily/data/${g.data}/meta.json`).then((r) => r.json());
      const m = meta.puzzles[fileFor(TODAY_NUMBER) - 1];
      tile.querySelector("[data-goal]").textContent = m.goal;
      tile.querySelector("[data-variant]").textContent = m.variant ? `${m.variant[0].toUpperCase()}${m.variant.slice(1)}` : "";
      tile.querySelector("[data-stars]").innerHTML = stars(m.stars);
      const fan = tile.querySelector(".fan");
      m.hand.slice(0, 5).forEach((c) => fan.appendChild(cardEl(c)));
      const rec = solvedRecord(key, TODAY_NUMBER);
      if (rec) {
        tile.classList.add("done");
        tile.querySelector(".dt-go").textContent = `Solved ${"★".repeat(rec.stars)}`;
      }
    } catch (_) { /* The tile still links to the puzzle. */ }
  }
}
const stars = (n) => `<span class="dt-stars" aria-label="${n} star${n > 1 ? "s" : ""} difficulty">${"★".repeat(n)}<span class="off">${"★".repeat(3 - n)}</span></span>`;

// ---------- Puzzle ----------
class Puzzle {
  constructor(g, n, data) {
    this.g = g;
    this.n = n;
    this.p = data;
    this.fails = 0;
    this.helped = false;
    this.started = false;
    this.busy = false;
    this.els = {
      table: $("[data-table]"),
      center: $("[data-center]"),
      status: $("[data-status]"),
      hand: $("[data-hand]"),
      meter: $("[data-meter]"),
      retry: $("[data-retry]"),
      hint: $("[data-hint-btn]"),
    };
    this.els.retry.addEventListener("click", () => { track("puzzle_restart", { game: g.key }); this.reset(); });
    this.els.hint.addEventListener("click", () => this.showHint());
    this.renderGoal();
    this.reset();
  }

  isPlayer(seat) { return this.p.players.includes(seat); }

  reset() {
    const p = this.p;
    this.hands = Object.fromEntries(Object.entries(p.hands).map(([s, cs]) => [s, sortHand(cs, p)]));
    this.trick = p.trick.map(([seat, card]) => ({ seat, card }));
    this.counted = 0;
    this.against = 0;
    this.lost = 0;
    this.won = { N: 0, E: 0, S: 0, W: 0 };
    this.node = p.nodes[p.root];
    this.hintCard = null;
    this.busy = false;
    this.done = false;
    this.closeDialog();
    this.els.center.className = "dt-center";
    this.renderTrick();
    this.renderMeter();
    this.render();
  }

  renderGoal() {
    const p = this.p;
    const trump = $("[data-trump]");
    if (p.trumpBadge) {
      trump.hidden = false;
      trump.classList.toggle("red", p.trump === "H" || p.trump === "D");
      trump.classList.toggle("nt", !p.trump);
      trump.querySelector("b").textContent = p.trump ? SUIT[p.trump] : "NT";
      trump.querySelector("small").textContent = p.trump ? "TRUMP" : "NO TRUMP";
      trump.setAttribute("aria-label", p.trump ? `Trump: ${SUIT_NAME[p.trump]}` : "No trump");
    }
    $("[data-goal]").textContent = p.goal;
    $("[data-rules]").textContent = p.rules;
  }

  renderMeter() {
    const p = this.p;
    const m = this.els.meter;
    const tokens = !p.atMost && p.ownSide && p.unit === "tricks" && p.target >= 1 && p.target <= 8;
    if (tokens) {
      const spare = p.tricksLeft - p.target;
      let h = `<span class="lbl">Yours</span>`;
      for (let i = 0; i < p.target; i++) h += `<span class="dt-token ${i < this.counted ? "on" : ""}">✓</span>`;
      h += `<span class="dt-gap"></span>`;
      if (spare === 0) h += `<span class="lbl">None to spare</span>`;
      else {
        h += `<span class="lbl">Can lose</span>`;
        for (let i = 0; i < spare; i++) h += `<span class="dt-token lose ${i < this.lost ? "on" : ""}">✕</span>`;
      }
      m.innerHTML = h;
      return;
    }
    const whose = p.ownSide ? "You" : "Them";
    if (p.atMost) {
      const over = this.counted > p.target;
      const limit = p.limit || (p.target === 0 ? "allowed: none" : `allowed: ${p.target}`);
      m.innerHTML = `<span class="lbl">${whose}:</span> <span>${this.counted} ${p.unit}</span><span class="dt-limit ${over ? "over" : ""}">${limit}</span>`;
    } else {
      const pct = Math.min(100, (this.counted / Math.max(1, p.target)) * 100);
      m.innerHTML = `<span class="lbl">${whose}</span><span class="dt-bar"><i style="width:${pct}%"></i></span><span>${this.counted} / ${p.target} ${p.unit}</span>`;
    }
  }

  seatTag(seat) {
    const g = this.g.key;
    const partner = PARTNERS.has(g) && seat === "N";
    let role = "";
    if (seat === "S") role = "You";
    else if (g === "bridge" && seat === "N") role = this.isPlayer("N") ? "Dummy · you play" : "Partner";
    else if (partner) role = "Partner";
    const tk = this.won[seat] ? ` <span class="tk">· ${this.won[seat]}</span>` : "";
    return `${seat === "S" ? "" : SEAT_NAME[seat]}${role ? (seat === "S" ? role : ` <em>${role}</em>`) : ""}${tk}`;
  }

  render() {
    const p = this.p;
    const turn = this.node ? this.node.seat : null;
    const legal = this.node && !this.busy ? Object.keys(this.node.m) : [];
    for (const seat of ["N", "W", "E"]) {
      const box = $(`[data-seat="${seat}"]`);
      box.classList.toggle("is-turn", turn === seat && !this.busy);
      box.querySelector(".dt-tag").innerHTML = this.seatTag(seat);
      const cards = box.querySelector("[data-cards]");
      cards.innerHTML = "";
      for (const c of this.hands[seat]) {
        if (this.isPlayer(seat)) cards.appendChild(this.handButton(c, seat, legal, true));
        else {
          const el = cardEl(c, true);
          el.setAttribute("aria-hidden", "false");
          el.setAttribute("role", "img");
          el.setAttribute("aria-label", cardName(c));
          cards.appendChild(el);
        }
      }
    }
    const you = $(`[data-seat="S"]`);
    you.classList.toggle("is-turn", turn === "S" && !this.busy);
    you.querySelector(".dt-tag").innerHTML = this.seatTag("S");
    this.els.hand.innerHTML = "";
    for (const c of this.hands.S) this.els.hand.appendChild(this.handButton(c, "S", legal, false));
    this.els.hint.hidden = !(this.fails >= 3 && !this.done);
    if (!this.busy && this.node) {
      const where = turn === "N" ? "Your turn: play from dummy (North)" : this.hintCard ? "Start with the glowing card" : "Your turn: pick a card";
      this.status(this.trick.length === 0 && !this.started ? `${where}` : where);
    }
  }

  handButton(c, seat, legal, mini) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hc";
    const isTurn = this.node && this.node.seat === seat;
    const ok = isTurn && legal.includes(c);
    if (ok) b.classList.add("legal");
    if (ok && this.hintCard === c) b.classList.add("hint");
    b.disabled = !ok;
    b.setAttribute("aria-label", `${cardName(c)}${ok ? "" : isTurn ? ", can't play" : ""}`);
    b.appendChild(cardEl(c, mini));
    b.addEventListener("click", () => this.play(c));
    return b;
  }

  status(text) { this.els.status.textContent = text; }

  renderTrick(fresh = null) {
    const c = this.els.center;
    c.querySelectorAll(".dt-slot").forEach((el) => el.remove());
    for (const t of this.trick) {
      const s = document.createElement("div");
      s.className = `dt-slot dt-slot-${t.seat.toLowerCase()}${fresh === t ? " fresh" : ""}`;
      s.dataset.slot = t.seat;
      s.appendChild(cardEl(t.card));
      s.setAttribute("role", "img");
      s.setAttribute("aria-label", `${SEAT_NAME[t.seat]} played the ${cardName(t.card)}`);
      c.appendChild(s);
    }
  }

  put(seat, card) {
    this.hands[seat] = this.hands[seat].filter((c) => c !== card);
    const t = { seat, card };
    this.trick.push(t);
    this.renderTrick(t);
    this.render();
  }

  async play(card) {
    if (this.busy || !this.node || this.done) return;
    const move = this.node.m[card];
    if (!move) return;
    if (!this.started) { this.started = true; track("puzzle_start", { game: this.g.key, puzzle_number: this.n }); }
    this.busy = true;
    this.hintCard = null;
    for (const ev of move.ev) {
      if (typeof ev === "string") {
        const seat = ev[0];
        if (seat !== this.node.seat || ev.slice(1) !== card) {
          this.status(`${SEAT_NAME[seat]} plays…`);
          await sleep(480);
        }
        this.put(seat, ev.slice(1));
        await sleep(this.isPlayer(seat) ? 200 : 120);
      } else {
        await sleep(360);
        const w = ev.w;
        const slot = this.els.center.querySelector(`.dt-slot[data-slot="${w}"]`);
        slot?.classList.add("win");
        $(`[data-seat="${w}"]`).classList.add("is-winner");
        this.status(`${w === "S" ? "You win" : `${SEAT_NAME[w]} wins`} the trick`);
        await sleep(620);
        this.els.center.classList.add(`sweep-${w.toLowerCase()}`);
        await sleep(360);
        $(`[data-seat="${w}"]`).classList.remove("is-winner");
        this.trick = [];
        this.renderTrick();
        this.els.center.className = "dt-center";
        this.won[w]++;
        this.counted = ev.c;
        this.against = ev.a;
        this.lost = ev.l;
        this.renderMeter();
      }
    }
    this.busy = false;
    if (move.end === "solved") return this.solved();
    if (move.end === "failed") return this.failed();
    this.node = this.p.nodes[move.next];
    this.render();
  }

  showHint() {
    this.helped = true;
    track("puzzle_hint", { game: this.g.key });
    this.reset();
    this.hintCard = this.p.key;
    this.render();
  }

  failed() {
    this.fails++;
    track("puzzle_fail", { game: this.g.key, attempt: this.fails });
    this.node = null;
    this.render();
    this.status("Not this time");
    this.dialog(`
      <h2>So close!</h2>
      <p>${this.p.failed}</p>
      ${this.fails >= 3 ? `<p>Stuck? Let us show you the first card.</p>` : `<p>Every card is face up, and there is a line that works.</p>`}
      <div class="dt-actions">
        <button type="button" class="dt-btn primary ${this.fails >= 3 ? "" : "wide"}" data-again>Try again</button>
        ${this.fails >= 3 ? `<button type="button" class="dt-btn" data-showme>Show me</button>` : ""}
      </div>`);
    $("[data-again]", this.overlay).addEventListener("click", () => this.reset());
    $("[data-showme]", this.overlay)?.addEventListener("click", () => this.showHint());
  }

  solved() {
    this.done = true;
    this.node = null;
    this.render();
    this.status("Solved!");
    const attempts = this.fails + 1;
    const starsWon = this.helped ? 1 : attempts === 1 ? 3 : attempts === 2 ? 2 : 1;
    const first = recordSolve(this.g.key, this.n, starsWon, attempts);
    const streak = liveStreak();
    track("puzzle_solve", { game: this.g.key, stars: starsWon, attempts, helped: this.helped ? 1 : 0, first_solve: first ? 1 : 0 });
    this.result = { stars: starsWon, attempts };
    this.showSolved(streak);
  }

  shareText() {
    const r = this.result;
    const line = r.attempts === 1 ? "Solved first try" : `Solved in ${r.attempts} tries`;
    const grid = "🟥".repeat(Math.min(r.attempts - 1, 6)) + "🟩";
    return `The Daily Trick #${this.n} · ${this.g.title} ${"★".repeat(r.stars)}${"☆".repeat(3 - r.stars)}\n${line} ${grid}\nCan you find the winning card?`;
  }

  shareUrl(source) {
    return `${location.origin}/daily/${this.g.slug}/${this.n}/?utm_source=${source}&utm_medium=share&utm_campaign=daily_trick`;
  }

  async share() {
    const text = this.shareText();
    const url = this.shareUrl("share");
    if (navigator.share) {
      try { await navigator.share({ text, url }); track("puzzle_share", { game: this.g.key, method: "native" }); } catch (_) {}
      return;
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast("Copied. Paste it anywhere!");
      track("puzzle_share", { game: this.g.key, method: "copy" });
    } catch (_) { toast("Couldn't copy"); }
  }

  showSolved(streak) {
    const g = this.g;
    const p = this.p;
    const r = this.result;
    const pitch = appPitch(g);
    const wa = `https://wa.me/?text=${encodeURIComponent(`${this.shareText()}\n${this.shareUrl("whatsapp")}`)}`;
    const next = CFG.order.map((k) => CFG.games[k]).find((o) => o.key !== g.key && !solvedRecord(o.key, TODAY_NUMBER));
    const lesson = p.trap && p.key !== p.trap
      ? `The key play was the <b>${cardShort(p.key)}</b>. The trap was the <b>${cardShort(p.trap)}</b>.`
      : `The key play was the <b>${cardShort(p.key)}</b>.`;
    const ctaBody = pitch.web
      ? `<div class="store-row"><a class="dt-btn primary" href="${g.play}">Play ${g.title} now</a></div>`
      : `<div class="store-row">${storeRow(g, "result")}</div>`;
    this.dialog(`
      <div class="dt-big-stars" aria-label="${r.stars} of 3 stars">${[0, 1, 2].map((i) => `<span class="${i < r.stars ? "" : "off"}">★</span>`).join("")}</div>
      <h2>Solved!</h2>
      <p>${r.attempts === 1 ? "First try. Brilliant." : `Solved in ${r.attempts} tries.`}${this.helped ? " (with a hint)" : ""}</p>
      ${streak > 1 ? `<div class="dt-streak">🔥 ${streak}-day streak</div>` : ""}
      <div class="dt-lesson"><div data-keycard></div><p>${lesson}</p></div>
      <div class="dt-actions">
        <button type="button" class="dt-btn primary" data-share>Share result</button>
        <a class="dt-btn wa" href="${wa}" target="_blank" rel="noopener" data-wa>WhatsApp</a>
        ${next ? `<a class="dt-btn wide" href="/daily/${next.slug}/">Next: today's ${next.title} puzzle →</a>` : `<a class="dt-btn wide" href="/daily/">All of today's puzzles</a>`}
      </div>
      <div class="dt-cta" data-placement="daily_result">
        <div class="dt-app"><img src="${g.icon}" alt="" width="44" height="44"><div><h3>${pitch.title}</h3><p>${pitch.text}</p></div></div>
        ${ctaBody}
      </div>
      ${g.play && !pitch.web ? `<p class="dt-next"><a href="${g.play}">Or play a full match in your browser</a></p>` : ""}
      <p class="dt-next">Next Daily Trick in <b data-countdown>${untilMidnight()}</b></p>`);
    $("[data-keycard]", this.overlay).replaceWith(cardEl(p.key));
    $("[data-share]", this.overlay).addEventListener("click", () => this.share());
    $("[data-wa]", this.overlay).addEventListener("click", () => track("puzzle_share", { game: g.key, method: "whatsapp" }));
  }

  dialog(html) {
    this.overlay = $("[data-overlay]");
    this.overlay.innerHTML = `<div class="dt-dialog" role="dialog" aria-modal="true" aria-label="Result"><button type="button" class="dt-close" aria-label="Close" data-close>×</button>${html}</div>`;
    this.overlay.hidden = false;
    $("[data-close]", this.overlay).addEventListener("click", () => this.closeDialog());
    this.overlay.onclick = (e) => { if (e.target === this.overlay) this.closeDialog(); };
    setTimeout(() => this.overlay.querySelector(".primary")?.focus(), 50);
  }

  closeDialog() {
    const o = $("[data-overlay]");
    if (o) { o.hidden = true; o.innerHTML = ""; }
    if (this.done && !this.node) this.status("Solved! Come back tomorrow for a new one");
  }
}

function toast(text) {
  const t = document.createElement("div");
  t.className = "dt-toast";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

async function puzzlePage() {
  const game = CFG.page.game;
  const g = CFG.games[game];
  const asked = parseInt(new URLSearchParams(location.search).get("n"), 10);
  const n = CFG.page.number || (asked > 0 ? asked : TODAY_NUMBER);
  if (OG) document.body.classList.add("og", `og-${OG}`);
  const title = $("[data-title]");
  title.innerHTML = `Daily Trick #${n}<small>${g.title} · ${dateOf(n)}</small>`;
  $("[data-og-number]") && ($("[data-og-number]").textContent = `#${n}`);
  if (n < 1 || (n > TODAY_NUMBER && !OG)) {
    $("[data-stage]").innerHTML = `<div class="dt-locked"><h2>${n < 1 ? "This puzzle doesn't exist" : `Daily Trick #${n} isn't out yet`}</h2>
      <p>${n < 1 ? "" : `It unlocks on ${dateOf(n)}.`} Today's puzzle is ready now.</p>
      <a class="dt-btn primary" href="/daily/${g.slug}/">Play today's ${g.title} puzzle</a></div>`;
    return;
  }
  renderSide(g, n);
  const data = await fetch(`/daily/data/${g.data}/${fileFor(n)}.json`).then((r) => r.json());
  $("[data-stars-pill]").innerHTML = stars(data.stars);
  $("[data-og-goal]").textContent = data.goal;
  $("[data-variant-pill]").textContent = data.variant ? data.variant[0].toUpperCase() + data.variant.slice(1) : "";
  const rec = solvedRecord(game, n);
  const puzzle = new Puzzle(g, n, data);
  window.__puzzle = puzzle;
  if (rec && !OG) puzzle.status(`You solved this one ${"★".repeat(rec.stars)}. Play it again?`);
  document.documentElement.dataset.ready = "1";
}

function renderSide(g, n) {
  const pitch = appPitch(g);
  const app = $("[data-side-app]");
  app.innerHTML = `<div class="dt-app"><img src="${g.icon}" alt="" width="52" height="52"><h3>${pitch.title}</h3></div>
    <p>${pitch.text}</p>
    ${pitch.web ? `<a class="dt-btn primary" href="${g.play}">Play ${g.title} now</a>` : `<div class="store-row">${storeRow(g, "side")}</div>`}
    ${g.play && !pitch.web ? `<a class="dt-more" href="${g.play}">Or play a full match in your browser →</a>` : ""}`;
  const list = $("[data-others]");
  list.innerHTML = CFG.order.filter((k) => k !== g.key).map((k) => {
    const o = CFG.games[k];
    const rec = solvedRecord(k, TODAY_NUMBER);
    return `<li><a href="/daily/${o.slug}/"><img src="${o.icon}" alt="" width="28" height="28"><span>${o.title}</span>${rec ? `<b class="ok">✓ ${"★".repeat(rec.stars)}</b>` : "<b>Play →</b>"}</a></li>`;
  }).join("");
}

if (CFG.page.kind === "hub") hub();
else puzzlePage();
