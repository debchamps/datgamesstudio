const header = document.querySelector("[data-site-header]");
const nav = document.querySelector("[data-site-nav]");
const toggle = document.querySelector("[data-nav-toggle]");

function syncHeader() {
  if (!header) return;
  if (header.hasAttribute("data-force-solid")) return;
  header.classList.toggle("is-solid", window.scrollY > 18);
}

function closeNav() {
  if (!nav || !toggle) return;
  nav.classList.remove("is-open");
  document.body.classList.remove("nav-open");
  toggle.setAttribute("aria-expanded", "false");
}

if (toggle && nav) {
  toggle.addEventListener("click", () => {
    const willOpen = !nav.classList.contains("is-open");
    nav.classList.toggle("is-open", willOpen);
    document.body.classList.toggle("nav-open", willOpen);
    toggle.setAttribute("aria-expanded", String(willOpen));
  });

  nav.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      closeNav();
    }
  });
}

window.addEventListener("scroll", syncHeader, { passive: true });
syncHeader();

const filters = document.querySelector("[data-filters]");
const games = document.querySelectorAll("[data-games] .game-card");

if (filters) {
  filters.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-filter]");
    if (!chip) return;
    const filter = chip.dataset.filter;
    filters.querySelectorAll("[data-filter]").forEach((button) => {
      const active = button === chip;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    games.forEach((card) => {
      const tags = (card.dataset.tags || "").split(" ");
      card.hidden = filter !== "all" && !tags.includes(filter);
    });
  });
}

// Game pages: on short windows, scroll so the whole table and hand are on screen.
const stage = document.querySelector(".game-wrap");
if (stage) {
  window.addEventListener("load", () => {
    const rect = stage.getBoundingClientRect();
    if (rect.bottom <= window.innerHeight) return;
    const headerHeight = header ? header.offsetHeight : 0;
    window.scrollTo({ top: window.scrollY + rect.top - headerHeight, behavior: "instant" });
  });
}
