(() => {
  const surface = document.querySelector("[data-recommendations]");
  const catalog = window.DATGameCatalog;
  const config = window.DATRecommendationsConfig;
  if (!surface || !catalog || !config) return;

  const CACHE_KEY = "dat:country:v1";
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) || location.protocol === "file:";
  const countryCode = (value) => typeof value === "string" && /^[A-Z]{2}$/.test(value) && !["XX", "ZZ", "T1"].includes(value) ? value : null;
  const now = Date.now();
  let fixed = false;
  let viewed = false;
  let observer;
  let inView = false;
  let budgetTimer;
  let context;

  function cachedCountry() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY));
      return cached && Number.isFinite(cached.at) && cached.at <= now && now - cached.at < config.cacheTtlMs
        ? countryCode(cached.country) : null;
    } catch (_) { return null; }
  }

  function localeCountry() {
    // A language tag is a weaker preference signal. Generic en/bn/ar alone
    // cannot establish a country, and even en-US is only a last-resort hint.
    for (const language of navigator.languages || [navigator.language]) {
      const match = String(language).match(/^[a-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2})(?:-|$)/);
      if (match) return countryCode(match[1].toUpperCase());
    }
    return null;
  }

  function createCard(slug, index) {
    const game = catalog.games[slug];
    const card = document.createElement("article");
    card.className = "hero-game";
    card.dataset.featuredGame = slug;
    card.dataset.recommendationPosition = String(index + 1);
    const icon = document.createElement("img");
    icon.src = game.icon;
    icon.alt = "";
    icon.width = 44;
    icon.height = 44;
    const info = document.createElement("div");
    info.className = "hero-game-info";
    const title = document.createElement("h2");
    title.textContent = game.name;
    const description = document.createElement("p");
    description.textContent = game.description;
    info.append(title, description);
    const play = document.createElement("a");
    play.className = "hero-game-play";
    play.href = game.play;
    play.setAttribute("aria-label", `Play ${game.name} free in your browser`);
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "▶";
    play.append(arrow, " Play");
    card.append(icon, info, play);
    return card;
  }

  function reorder(selector, itemSelector, slugs, identify) {
    const container = document.querySelector(selector);
    if (!container) return;
    const items = [...container.querySelectorAll(itemSelector)];
    const ordered = [...items].sort((a, b) => {
      const rank = (node) => { const i = slugs.indexOf(identify(node)); return i === -1 ? slugs.length : i; };
      return rank(a) - rank(b);
    });
    // Keep the existing nodes, filter state, daily teaser hooks and anchor IDs.
    if (items.some((item, i) => item !== ordered[i])) container.append(...ordered);
  }

  function apply(country, source) {
    const region = catalog.regionFor(country);
    const featured = catalog.profiles[region];
    context = {
      recommendation_region: region,
      recommendation_source: source,
      recommendation_set: featured.join("|"),
      recommendation_version: "regional-v1",
    };
    window.DATRecommendationContext = Object.freeze(context);
    surface.dataset.recommendationRegion = region;
    const list = surface.querySelector("[data-featured-games]");
    if (list && list.dataset.gameSet !== featured.join("|")) {
      list.replaceChildren(...featured.map(createCard));
      list.dataset.gameSet = featured.join("|");
    }
    const copy = surface.querySelector("[data-regional-copy]");
    if (copy) copy.textContent = `${catalog.games[featured[0]].name}, ${catalog.games[featured[1]].name} and a clever puzzle — ready when you are. Play in your browser, or get our apps for Android and iPhone.`;
    reorder(".play-tiles", ".play-tile", featured, (node) => node.getAttribute("href").split("/")[2]);
    reorder(".play-hub-grid", ".play-hub-card", featured, (node) => node.querySelector(".phc-main").getAttribute("href").split("/")[2]);
    reorder("[data-games]", ".game-card", featured, (node) => {
      const id = node.id.replace("game-", "");
      return id === "twentynine" ? "twenty-nine" : id === "snakeuncoil" ? "snake-uncoil" : id;
    });
    // The phone composition follows the same featured games at every width;
    // lazy images keep it secondary to the immediately playable links.
    surface.querySelectorAll("[data-regional-screen]").forEach((image) => {
      const game = catalog.games[featured[Number(image.dataset.regionalScreen)]];
      if (image.getAttribute("src") !== game.screen) image.src = game.screen;
    });
  }

  function trackView() {
    if (viewed || document.visibilityState === "hidden") return;
    viewed = true;
    observer?.disconnect();
    window.datTrack?.("recommendation_view", { ...context, game: "all_games", placement: surface.dataset.recommendations });
  }

  function finalize() {
    if (fixed) return;
    fixed = true;
    clearTimeout(budgetTimer);
    surface.dataset.recommendationStatus = "ready";
    const target = surface.querySelector("[data-featured-games]") || document.querySelector(".play-hub-grid");
    if (target && "IntersectionObserver" in window) {
      observer = new IntersectionObserver((entries) => {
        inView = entries.some((entry) => entry.isIntersecting);
        if (inView) trackView();
      }, { threshold: 0.25 });
      observer.observe(target);
    } else if (target) trackView();
    document.dispatchEvent(new CustomEvent("dat:recommendations-ready", { detail: context }));
  }

  // Freeze before navigation handlers run. A slow lookup must never replace a
  // focused, hovered, or touched link, or reorder a catalog while it is scrolled.
  const freeze = () => finalize();
  document.addEventListener("visibilitychange", () => { if (inView) trackView(); });
  document.addEventListener("pointerdown", freeze, { capture: true, once: true });
  document.addEventListener("touchstart", freeze, { capture: true, passive: true, once: true });
  document.addEventListener("focusin", freeze, { capture: true, once: true });
  document.addEventListener("pointerover", (event) => {
    if (event.target instanceof Element && event.target.closest(".hero-game-play, .play-tile, .phc-main")) finalize();
  }, { capture: true });
  window.addEventListener("scroll", () => { if (window.scrollY > 0) finalize(); }, { passive: true });
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(".hero-game-play, .phc-main")) {
      finalize();
      trackView();
    }
  }, { capture: true });

  if (!config.enabled) {
    apply(null, "disabled");
    finalize();
    return;
  }
  const cached = cachedCountry();
  const locale = localeCountry();
  apply(cached || locale, cached ? "cache" : locale ? "locale" : "default");
  if (cached || local || typeof fetch !== "function") {
    finalize();
    return;
  }

  surface.dataset.recommendationStatus = "loading";
  budgetTimer = setTimeout(finalize, config.updateBudgetMs);
  const controller = new AbortController();
  const requestTimer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  fetch(config.endpoint, {
    signal: controller.signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok) throw new Error("country lookup failed");
    const body = await response.text();
    let value = body.trim();
    if (value.startsWith("{")) value = JSON.parse(value).country;
    const country = countryCode(value);
    if (!country) throw new Error("invalid country");
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ country, at: Date.now() })); } catch (_) {}
    // Check elapsed time as well as the timer: a busy mobile main thread can
    // delay a timeout callback until after a network promise has completed.
    const canUpdate = !fixed && Date.now() - now <= config.updateBudgetMs;
    if (canUpdate) apply(country, "ip");
    window.datTrack?.("recommendation_lookup", { result: canUpdate ? "success" : "late" });
  }).catch((error) => {
    window.datTrack?.("recommendation_lookup", { result: error.name === "AbortError" ? "timeout" : "unavailable" });
  }).finally(() => {
    clearTimeout(requestTimer);
    finalize();
  });
})();
