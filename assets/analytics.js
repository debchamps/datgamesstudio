// Shared by every page, including generated guides. Keep event names stable so
// GA4 can compare releases; use parameters to distinguish games and placements.
(() => {
  const GA_ID = "G-677P55P83T";
  const APPS = {
    "com.datgames.bridge": "bridge", "com.datgames.snakeuncoil": "snake-uncoil",
    "com.datgames.cardadda": "card-adda", "com.datgames.hearts": "hearts",
    "com.datgames.spade": "spades", "com.datgames.CallbreakCardGame": "callbreak",
    "com.datgames.bray": "bray", "com.datgames.whist": "whist",
    "debakesh.com.twentynine": "twenty-nine", "com.datgames.tarneeb": "tarneeb",
    "com.datgames.hokm": "hokm", id6827570630: "bridge", id6826481395: "snake-uncoil",
    id6816377998: "card-adda", id1607650705: "bray", id1606221936: "callbreak",
    id1620761646: "hearts", id6443504649: "spades", id6785555890: "tarneeb",
    id6443517269: "whist",
  };
  const aliases = { twentynine: "twenty-nine", cardadda: "card-adda", snakeuncoil: "snake-uncoil" };
  const normalize = (game) => aliases[game] || game;
  const path = location.pathname;
  const match = path.match(/^\/(play|how-to-play)\/([^/]+)(?:\/|$)/);
  const pageGame = match ? normalize(match[2]) : "";
  const pageType = path === "/" ? "home" : /^\/play\//.test(path)
    ? (pageGame ? "game" : "play_hub") : /^\/how-to-play\//.test(path)
    ? (pageGame ? "guide" : "guide_hub") : "other";
  window.DAT_GAME = pageType === "game" ? pageGame : "";

  // Local verification must not add synthetic players or events to production.
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) || location.protocol === "file:";
  window.datTrack = (name, params = {}) => {
    if (local) return;
    try {
      window.gtag("event", name, {
        send_to: GA_ID, page_path: path, page_type: pageType,
        game: pageGame || "none", ...params,
      });
    } catch (_) { /* Analytics must never interrupt a game or navigation. */ }
  };

  let current = null;
  const summary = () => ({
    rounds_completed: current.rounds.size,
    cards_played: current.cards,
  });
  const finishMatch = (params) => {
    if (!current || current.finished) return;
    current.finished = true;
    window.datTrack("match_finish", { ...summary(), ...params });
  };
  window.DATAnalytics = {
    startMatch(event) {
      if (current && !current.finished && current.engaged) {
        window.datTrack("match_restart", summary());
      }
      const action = !event ? "auto_start" : event.currentTarget?.hasAttribute("data-again") ? "play_again" : "new_match";
      current = { engaged: false, finished: false, cards: 0, rounds: new Set() };
      window.datTrack("game_start", { action });
    },
    // Called only after the engine accepts a human card, not a page load, hint,
    // pass selection, or disabled-card click. Reset for each new match.
    cardPlayed() {
      if (!current || current.finished) return;
      current.cards++;
      if (current.engaged) return;
      current.engaged = true;
      window.datTrack("game_engaged");
    },
    roundFinish(params) {
      if (!current || current.rounds.has(params.round_number)) return;
      current.rounds.add(params.round_number);
      window.datTrack("round_finish", params);
    },
    finishMatch,
  };

  function placement(element) {
    // Nearest named region wins: an overlay inside a table must remain distinct
    // from the table, and a guide sidebar from the rest of the guide.
    const selectors = [
      ["[data-placement]", (el) => el.dataset.placement],
      ["[data-overlay]", "game_overlay"], [".game-wrap", "game_table"],
      [".site-header", "header"], [".site-footer", "footer"],
      [".game-card", "game_card"], [".play-hub-card", "play_hub_card"],
      [".guide-side", "guide_sidebar"], [".guide-cta", "guide_download"],
      [".guide-more", "related_guides"], [".guide-toc", "guide_contents"],
      [".guide-hero", "guide_hero"], [".hero", "hero"],
      [".play-band", "play_band"], [".guide-band", "guide_band"],
      ["section[id]", (el) => el.id],
    ];
    for (let el = element; el && el !== document.body; el = el.parentElement) {
      for (const [selector, value] of selectors) {
        if (el.matches(selector)) return typeof value === "function" ? value(el) : value;
      }
    }
    return "content";
  }

  function linkGame(url, element) {
    // Store developer pages are catalog links even when clicked on a game page.
    if (["play.google.com", "apps.apple.com"].includes(url.hostname)) {
      const id = url.searchParams.get("id") || url.pathname.match(/\/(id\d+)(?:\/|$)/)?.[1];
      return APPS[id] || "all_games";
    }
    const target = url.pathname.match(/^\/(?:play|how-to-play)\/([^/]+)(?:\/|$)/);
    if (url.origin === location.origin && target) return normalize(target[1]);
    const card = element.closest(".game-card[id]");
    const anchorGame = url.hash.match(/^#game-(.+)$/);
    if (anchorGame) return normalize(anchorGame[1]);
    if (card) return normalize(card.id.replace(/^game-/, ""));
    if (url.origin === location.origin && /^\/(?:play|how-to-play)\/$/.test(url.pathname)) return "hub";
    return pageGame || "none";
  }

  // Capture before game handlers replace the clicked button or navigate away.
  // Track meaningful controls, not every card/bid, to keep reports usable.
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    if (!target) return;
    const control = target.closest("button");
    if (control && !control.disabled) {
      const controls = { "data-new": "new_match", "data-again": "play_again", "data-next": "next_round",
        "data-hint": "hint", "data-reveal": "reveal_trump", "data-nav-toggle": "menu" };
      let action = Object.entries(controls).find(([attr]) => control.hasAttribute(attr))?.[1];
      if (control.hasAttribute("data-filter")) action = `filter_${control.dataset.filter}`;
      if (action) window.datTrack(window.DAT_GAME ? "game_control" : "site_control", {
        action, placement: placement(control),
      });
    }
    const link = target.closest("a[href]");
    if (!link) return;
    let url;
    try { url = new URL(link.href, location.href); } catch (_) { return; }
    if (!["http:", "https:"].includes(url.protocol)) return;
    const params = {
      game: linkGame(url, link), placement: placement(link),
      link_text: (link.getAttribute("aria-label") || link.textContent || link.querySelector("img")?.alt || "image")
        .replace(/\s+/g, " ").trim().slice(0, 100),
      // Drop query strings, which can contain campaign tokens or user input.
      link_url: url.origin + url.pathname + url.hash,
    };
    if (["play.google.com", "apps.apple.com"].includes(url.hostname)) {
      window.datTrack("store_click", { ...params, store: url.hostname === "apps.apple.com" ? "app_store" : "google_play" });
    } else if (url.origin === location.origin && /^\/play\//.test(url.pathname)) {
      window.datTrack("play_click", params);
    } else if (url.origin === location.origin && /^\/how-to-play\//.test(url.pathname)) {
      window.datTrack("guide_click", params);
    } else {
      window.datTrack("site_click", params);
    }
  }, { capture: true });
})();
