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
