import * as E from "./engine.js";

const NAMES = { SOUTH: "You", EAST: "Emma", NORTH: "Arthur", WEST: "William" };
const GLYPH = { S: "♠", H: "♥", C: "♣", D: "♦" };
const SUIT_NAME = { S: "Spades", H: "Hearts", C: "Clubs", D: "Diamonds" };
const FAST = new URLSearchParams(location.search).has("fast"); // test mode: skip the pacing delays
const SPEED = FAST ? { bid: 5, play: 5, trickHold: 5 } : { bid: 750, play: 750, trickHold: 1100 };

const $ = (sel) => document.querySelector(sel);
const el = {
  score: $("[data-score]"),
  round: $("[data-round]"),
  hand: $("[data-hand]"),
  trick: $("[data-trick]"),
  bid: $("[data-bid]"),
  bidInfo: $("[data-bid-info]"),
  bidButtons: $("[data-bid-buttons]"),
  trumpPanel: $("[data-trump-panel]"),
  trumpButtons: $("[data-trump-buttons]"),
  trumpChip: $("[data-trump-chip]"),
  contract: $("[data-contract]"),
  reveal: $("[data-reveal]"),
  status: $("[data-status]"),
  overlay: $("[data-overlay]"),
  hint: $("[data-hint]"),
  seats: Object.fromEntries(E.SEATS.map((s) => [s, $(`[data-seat="${s}"]`)])),
};

let state = null;
let match = { us: 0, them: 0, dealer: "WEST", round: 1 };
let run = 0;
let hintCard = null;
let hintBid = undefined; // number = bid this, null = pass, undefined = none
let hintTrump = null;
let hintReveal = false;
let shownTrick = null;
const seenTrick = new Set(); // cards already on the table, so only a new card animates in
let bubbles = {}; // seat -> short text shown on the chip during bidding
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRed = (c) => c.suit === "H" || c.suit === "D";
const FACE = new Set(["J", "Q", "K"]);

function cardEl(card) {
  const d = document.createElement("div");
  d.className = `pcard ${isRed(card) ? "red" : "black"}${FACE.has(card.rank) ? " face" : ""}`;
  d.setAttribute("role", "img");
  d.setAttribute("aria-label", `${card.rank} of ${SUIT_NAME[card.suit].toLowerCase()}`);
  d.innerHTML = `<span class="pc-corner">${card.rank}<i>${GLYPH[card.suit]}</i></span><span class="pc-pip" data-rank="${card.rank}">${GLYPH[card.suit]}</span><span class="pc-corner pc-br">${card.rank}<i>${GLYPH[card.suit]}</i></span><span class="pc-pts">${E.pts(card) ? E.pts(card) : ""}</span>`;
  return d;
}

function render() {
  if (!state) return;
  el.score.innerHTML = `<span class="sc-us">Us <b>${fmt(match.us)}</b></span><span class="sc-them">Them <b>${fmt(match.them)}</b></span>`;
  el.round.textContent = `Round ${match.round}`;

  const bidderSeat = state.phase === "BIDDING" ? null : state.bidding.highestBidder || E.SEATS.find((s) => s === state.trumpSetter);
  for (const s of E.SEATS) {
    const seat = el.seats[s];
    seat.querySelector("[data-name]").textContent = NAMES[s] + (s === "NORTH" ? " (partner)" : "");
    const pts = state.pointsWon[s];
    const tricks = state.tricksWon[s];
    const call = bubbles[s] ? bubbles[s] : state.phase === "PLAYING" || state.phase === "ROUND_OVER" ? `${tricks} tricks · ${pts} pts` : "";
    seat.querySelector("[data-call]").textContent = call || "–";
    seat.classList.toggle("is-turn", state.turn === s && state.phase !== "ROUND_OVER" && !shownTrick);
    seat.classList.toggle("is-winner", !!shownTrick && shownTrick.winner === s);
    seat.classList.toggle("is-bidder", !!bidderSeat && state.phase !== "BIDDING" && state.trumpSetter === s);
  }

  // Contract + trump chips
  const inPlay = state.phase === "PLAYING" || state.phase === "ROUND_OVER";
  el.contract.hidden = !inPlay;
  if (inPlay) {
    const target = E.winningBid(state.bidding);
    el.contract.textContent = `${NAMES[state.trumpSetter]} bid ${target}`;
  }
  el.trumpChip.hidden = !inPlay;
  if (inPlay) {
    const revealed = E.isTrumpRevealed(state) || state.phase === "ROUND_OVER";
    if (revealed) {
      el.trumpChip.className = "chip-trump " + (state.trump === "H" || state.trump === "D" ? "red" : "");
      el.trumpChip.innerHTML = `Trump <b>${GLYPH[state.trump]}</b> ${SUIT_NAME[state.trump]}`;
    } else if (state.trumpSetter === "SOUTH") {
      el.trumpChip.className = "chip-trump mine " + (state.trump === "H" || state.trump === "D" ? "red" : "");
      el.trumpChip.innerHTML = `Your trump <b>${GLYPH[state.trump]}</b> hidden`;
    } else {
      el.trumpChip.className = "chip-trump hidden-trump";
      el.trumpChip.innerHTML = `Trump <b>?</b> hidden`;
    }
  }

  // Your hand
  el.hand.replaceChildren();
  const legal = state.phase === "PLAYING" && state.turn === "SOUTH" && !shownTrick ? E.legalMoves(state, "SOUTH") : [];
  state.hands.SOUTH.forEach((card) => {
    const isLegal = legal.some((c) => E.sameCard(c, card));
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hand-card" + (isLegal ? " is-legal" : "") + (hintCard && E.sameCard(hintCard, card) ? " is-hint" : "");
    b.disabled = !isLegal;
    b.appendChild(cardEl(card));
    b.addEventListener("click", () => onPlay(card));
    el.hand.appendChild(b);
  });

  // Trick
  el.trick.replaceChildren();
  const plays = shownTrick ? shownTrick.plays : state.currentTrick;
  if (!plays.length) seenTrick.clear();
  for (const p of plays) {
    const slot = document.createElement("div");
    slot.className = `trick-slot slot-${p.player.toLowerCase()}` + (seenTrick.has(E.cardId(p.card)) ? "" : " fresh") + (shownTrick && shownTrick.winner === p.player ? " is-winner" : "");
    seenTrick.add(E.cardId(p.card));
    slot.appendChild(cardEl(p.card));
    el.trick.appendChild(slot);
  }

  // Bidding panel
  const bidding = state.phase === "BIDDING" && state.turn === "SOUTH";
  el.bid.hidden = !bidding;
  el.bidButtons.replaceChildren();
  if (bidding) {
    const b = state.bidding;
    el.bidInfo.textContent = b.highestBidder
      ? `Current bid: ${b.highest} by ${NAMES[b.highestBidder]}`
      : "No bid yet. The minimum bid is 16.";
    const pass = document.createElement("button");
    pass.type = "button";
    pass.className = "bid-btn bid-pass" + (hintBid === null ? " is-hint" : "");
    pass.textContent = "Pass";
    pass.addEventListener("click", () => onBid(null));
    el.bidButtons.appendChild(pass);
    for (let n = E.minimumLegalBid(state, "SOUTH"); n <= E.MAX_BID; n++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bid-btn" + (hintBid === n ? " is-hint" : "");
      btn.textContent = n;
      btn.addEventListener("click", () => onBid(n));
      el.bidButtons.appendChild(btn);
    }
  }

  // Trump selection panel
  const choosing = state.phase === "TRUMP_SELECTION" && state.turn === "SOUTH";
  el.trumpPanel.hidden = !choosing;
  el.trumpButtons.replaceChildren();
  if (choosing) {
    for (const suit of E.SUITS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suit-btn " + (suit === "H" || suit === "D" ? "red" : "") + (hintTrump === suit ? " is-hint" : "");
      btn.innerHTML = `<b>${GLYPH[suit]}</b><span>${SUIT_NAME[suit]}</span>`;
      btn.addEventListener("click", () => onTrump(suit));
      el.trumpButtons.appendChild(btn);
    }
  }

  // Show-trump button (only when you are void in the suit led)
  const canReveal = state.phase === "PLAYING" && state.turn === "SOUTH" && !shownTrick && E.canRevealTrump(state, "SOUTH");
  el.reveal.hidden = !canReveal;
  el.reveal.classList.toggle("is-hint", canReveal && hintReveal);

  el.hint.disabled = !(bidding || choosing || legal.length || canReveal);
}

const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
const setStatus = (t) => (el.status.textContent = t);

// ── Game flow ───────────────────────────────────────────────────────────────

async function advance() {
  const token = run;
  while (state && token === run) {
    render();
    if (state.phase === "BIDDING") {
      if (state.turn === "SOUTH") {
        setStatus(state.bidding.highestBidder ? "Your turn to bid. Raise or pass." : "Your turn. Bid at least 16, or pass.");
        return;
      }
      setStatus(`${NAMES[state.turn]} is bidding…`);
      await sleep(SPEED.bid);
      if (token !== run) return;
      const seat = state.turn;
      const bid = E.chooseBid(state, seat);
      if (bid === null) {
        state = E.applyPass(state, seat);
        bubbles[seat] = "Pass";
      } else {
        state = E.applyBid(state, seat, bid);
        bubbles[seat] = `Bid ${bid}`;
      }
    } else if (state.phase === "TRUMP_SELECTION") {
      bubbles = {};
      if (state.turn === "SOUTH") {
        setStatus("You won the bid. Choose the trump suit. It stays hidden.");
        return;
      }
      setStatus(`${NAMES[state.turn]} won the bid at ${E.winningBid(state.bidding)} and is choosing trump…`);
      await sleep(SPEED.bid * 1.2);
      if (token !== run) return;
      state = E.selectTrump(state, E.chooseTrump(state, state.turn));
    } else if (state.phase === "PLAYING") {
      if (state.turn === "SOUTH") {
        const lead = state.currentTrick.length === 0;
        const reveal = E.canRevealTrump(state, "SOUTH");
        setStatus(
          lead
            ? "Your lead. Play any card."
            : reveal
              ? "You can't follow suit. Show the trump to cut, or throw a card."
              : "Your turn. Glowing cards are legal plays.",
        );
        return;
      }
      setStatus(`${NAMES[state.turn]} is thinking…`);
      await sleep(SPEED.play);
      if (token !== run) return;
      const seat = state.turn;
      if (E.canRevealTrump(state, seat) && E.shouldRevealTrump(state, seat)) {
        state = E.revealTrump(state, seat);
        render();
        setStatus(`${NAMES[seat]} asks to see trump: ${SUIT_NAME[state.trump]}!`);
        await sleep(SPEED.play + 300);
        if (token !== run) return;
      }
      await playCard(seat, E.chooseCard(state, seat), token);
      if (token !== run) return;
    } else {
      showRoundOver();
      return;
    }
  }
}

async function playCard(seat, card, token) {
  const before = state.completedTricks.length;
  const hadPair = state.pairDeclaredBy;
  state = E.play(state, seat, card);
  hintCard = null;
  hintReveal = false;
  if (!hadPair && state.pairDeclaredBy) setStatus(`${NAMES[state.pairDeclaredBy]} declared the K+Q pair of trump!`);
  if (state.completedTricks.length > before) {
    const last = state.completedTricks[state.completedTricks.length - 1];
    shownTrick = { plays: last.plays, winner: last.winner };
    render();
    const trickPts = last.plays.reduce((n, p) => n + E.pts(p.card), 0);
    setStatus(`${NAMES[last.winner]} takes the trick${trickPts ? ` (${trickPts} point${trickPts > 1 ? "s" : ""})` : ""}.`);
    await sleep(SPEED.trickHold);
    if (token !== run) return;
    shownTrick = null;
  }
}

function onBid(value) {
  if (state.phase !== "BIDDING" || state.turn !== "SOUTH") return;
  hintBid = undefined;
  if (value === null) {
    state = E.applyPass(state, "SOUTH");
    bubbles.SOUTH = "Pass";
  } else {
    state = E.applyBid(state, "SOUTH", value);
    bubbles.SOUTH = `Bid ${value}`;
  }
  advance();
}

function onTrump(suit) {
  if (state.phase !== "TRUMP_SELECTION" || state.turn !== "SOUTH") return;
  hintTrump = null;
  state = E.selectTrump(state, suit);
  advance();
}

async function onPlay(card) {
  if (!(state.phase === "PLAYING" && state.turn === "SOUTH") || shownTrick) return;
  if (!E.isLegal(state, "SOUTH", card)) return;
  const token = run;
  await playCard("SOUTH", card, token);
  if (token === run) advance();
}

function onReveal() {
  if (!E.canRevealTrump(state, "SOUTH")) return;
  state = E.revealTrump(state, "SOUTH");
  hintReveal = false;
  const mustCut = E.legalMoves(state, "SOUTH").every((c) => c.suit === state.trump);
  render();
  setStatus(`Trump is ${SUIT_NAME[state.trump]}. ${mustCut ? "You must play a trump." : "You hold no trump, so play any card."}`);
}

function onHint() {
  if (state.phase === "BIDDING" && state.turn === "SOUTH") hintBid = E.chooseBid(state, "SOUTH");
  else if (state.phase === "TRUMP_SELECTION" && state.turn === "SOUTH") hintTrump = E.chooseTrump(state, "SOUTH");
  else if (state.phase === "PLAYING" && state.turn === "SOUTH") {
    if (E.canRevealTrump(state, "SOUTH") && E.shouldRevealTrump(state, "SOUTH")) hintReveal = true;
    else hintCard = E.chooseCard(state, "SOUTH");
  }
  render();
}

// ── Overlays ────────────────────────────────────────────────────────────────

function showRoundOver() {
  const r = state.roundResult;
  match.us += r.ourDelta;
  match.them += r.theirDelta;
  match.us = Math.max(-E.MATCH_SCORE, Math.min(E.MATCH_SCORE, match.us));
  match.them = Math.max(-E.MATCH_SCORE, Math.min(E.MATCH_SCORE, match.them));
  render();

  const decided = match.us >= E.MATCH_SCORE || match.them >= E.MATCH_SCORE || match.us <= -E.MATCH_SCORE || match.them <= -E.MATCH_SCORE;
  const bidderName = r.bidderUs ? "Your team" : "Opponents";
  const bidderPts = r.bidderUs ? r.ourPoints : r.theirPoints;
  const pairNote = r.pairDeclaredBy
    ? `<p class="dlg-note">${NAMES[r.pairDeclaredBy]} declared the K+Q pair, so the target moved to <b>${r.effectiveTarget}</b>.</p>`
    : "";
  const title = r.bidderUs
    ? r.succeeded ? "You made the bid!" : "Bid missed"
    : r.succeeded ? "Opponents made their bid" : "You set them!";
  const good = r.bidderUs === r.succeeded;
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Round ${match.round} · Trump ${GLYPH[r.trump]} ${SUIT_NAME[r.trump]}</p>
      <h2 id="dlg-title" class="${good ? "good" : "bad"}">${title}</h2>
      <table class="score-table">
        <thead><tr><th></th><th>Card points</th><th>Tricks</th></tr></thead>
        <tbody>
          <tr class="me"><th>Us</th><td><strong>${r.ourPoints}</strong></td><td>${r.ourTricks}</td></tr>
          <tr><th>Them</th><td><strong>${r.theirPoints}</strong></td><td>${r.theirTricks}</td></tr>
        </tbody>
      </table>
      <p class="dlg-note">${bidderName} bid <b>${r.bidTarget}</b> and took <b>${bidderPts}</b>. ${r.succeeded ? "Bid made: +1." : "Bid missed: −1."}</p>
      ${pairNote}
      <p class="dlg-score">Match: <b>Us ${fmt(match.us)}</b> · <b>Them ${fmt(match.them)}</b> <small>(first to +${E.MATCH_SCORE} wins)</small></p>
      <button class="dlg-btn" type="button" data-next autofocus>${decided ? "See final result" : "Next round"}</button>
    </div>`;
  el.overlay.querySelector("[data-next]").addEventListener("click", () => {
    el.overlay.hidden = true;
    if (decided) return showMatchOver();
    match.round += 1;
    match.dealer = E.nextSeat(match.dealer);
    startRound();
  });
}

function showMatchOver() {
  const won = match.us >= E.MATCH_SCORE || match.them <= -E.MATCH_SCORE;
  el.overlay.hidden = false;
  el.overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <p class="dlg-eyebrow">Match complete</p>
      <h2 id="dlg-title" class="${won ? "good" : "bad"}">${won ? "You won the match! 🏆" : "The opponents won the match"}</h2>
      <p class="dlg-score">Final: <b>Us ${fmt(match.us)}</b> · <b>Them ${fmt(match.them)}</b></p>
      <button class="dlg-btn" type="button" data-again autofocus>Play again</button>
      <div class="dlg-promo">
        <p><strong>Like it? Get the full game.</strong> Double/Redouble, Single Hand, 7th-card trump, house rules, stats and a stronger computer.</p>
        <div class="store-row">
          <a class="store-btn" href="https://play.google.com/store/apps/details?id=debakesh.com.twentynine&amp;utm_source=website&amp;utm_medium=web_game&amp;utm_campaign=play_29&amp;utm_content=match_over" rel="noopener"><svg aria-hidden="true"><use href="#i-play"/></svg><span><small>Get it on</small>Google Play</span></a>
          <span class="store-btn is-soon"><svg aria-hidden="true"><use href="#i-apple"/></svg><span><small>iPhone</small>Coming soon</span></span>
        </div>
      </div>
    </div>`;
  el.overlay.querySelector("[data-again]").addEventListener("click", newMatch);
}

function resetHints() {
  hintCard = hintTrump = null;
  hintBid = undefined;
  hintReveal = false;
}

function startRound() {
  run++;
  bubbles = {};
  shownTrick = null;
  resetHints();
  state = E.startRound(match.dealer);
  advance();
}

function newMatch() {
  match = { us: 0, them: 0, dealer: "WEST", round: 1 };
  el.overlay.hidden = true;
  startRound();
}

$("[data-new]").addEventListener("click", newMatch);
el.hint.addEventListener("click", onHint);
el.reveal.addEventListener("click", onReveal);
newMatch();
