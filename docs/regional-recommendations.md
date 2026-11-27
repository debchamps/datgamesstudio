# Regional browser-game recommendations

The homepage has three featured games, real links in the HTML before JavaScript
runs. The first two are regional card games; the third is Snake Uncoil for
discovery. The play band, full catalog and `/play/` hub use the same priorities.
Individual game URLs never redirect or change games based on location.

## Country profiles

| Countries | Featured games, in order |
| --- | --- |
| US | Hearts, Spades, Snake Uncoil |
| IN, NP | Callbreak, 29, Snake Uncoil |
| BD | 29, Bray, Snake Uncoil |
| AE, BH, EG, IQ, JO, KW, LB, OM, PS, QA, SA, SY, YE | Tarneeb, Hokm, Snake Uncoil |
| IR | Hokm, Tarneeb, Snake Uncoil |
| Other or unknown | Hearts, Callbreak, Snake Uncoil |

These are editorial starting rules, not measured popularity claims. Country
membership and game priority live in `assets/game-catalog.js`, alongside names,
descriptions and the differences between game slugs and image filenames.

## Automatic detection on GitHub Pages

`assets/recommendations-config.js` enables detection and selects the endpoint.
The initial endpoint is `https://get.geojs.io/v1/ip/country`. It works directly
from GitHub Pages without an account, API key, backend or DNS change. The provider
derives country from the network request. Its plain-text endpoint returns only a
two-letter country code; do not switch to its full geolocation or IP JSON API.

Requests omit credentials and referring page URLs. GeoJS receives the visitor's
IP as the recipient of the request. See its [country API documentation](https://www.geojs.io/docs/v1/endpoints/country/)
and [privacy policy](https://www.geojs.io/privacy/). The site's own privacy page
describes this request, session storage and recommendation analytics.

1. Render working HTML immediately, with no loading overlay or geolocation prompt.
2. Use an IP-country result from this tab's session storage if less than 24 hours
   old. A fresh result avoids another network request.
3. Otherwise use an explicit country suffix in browser language preferences as a
   provisional fallback. Generic `en`, `bn` and `ar` do not establish a country.
4. Request country in the background. Apply a valid result only within the
   600 ms update window and before interaction. One IP result can update the view.
5. A result arriving after the update window is cached for the next navigation,
   without changing the current choices. Abort the request after 3 seconds.

Pointer down, touch, keyboard focus, hovering a game link, or scrolling freezes
the presentation. Existing catalog nodes are moved instead of rebuilt, preserving
filter state, anchor IDs, rules links and Daily Trick links. Individual game
pages do not perform lookups. Localhost and file previews do not call GeoJS.

Unavailable storage, offline connections, malformed country responses, ad
blockers and failed services retain functioning links. IP country is approximate,
especially through a VPN. Every game stays available via the full catalog.

Set `enabled: false` in the config to disable detection and retain the three
general choices. This also skips country-cache and locale selection.

## Optional Cloudflare Worker

`worker/region.mjs` implements the originally proposed first-party-operated
country endpoint, with no database or secret. It uses the incoming
`request.cf.country`; request headers, query strings, IPs and coordinates are
never echoed. The response is JSON, for example `{"country":"IN"}`.

The Worker intentionally serves anonymous public visitors. It accepts GET, HEAD
and OPTIONS on `/` and `/api/region`, permits browser requests from the site's
www and apex origins, and returns `Cache-Control: no-store` and
`CDN-Cache-Control: no-store`. CORS restricts browser consumption; it is not an
authentication boundary. Anonymous requests without Origin are supported.
Application logging is absent and Workers observability is disabled in config.

When a Cloudflare account is available:

```sh
cd worker
npx wrangler login
npx wrangler deploy
```

Use the actual returned HTTPS URL in `assets/recommendations-config.js` and bump
the config script's version in `index.html` and `play/index.html`. Verify a real
browser request from both allowed origins and check that its response is only
country JSON, never cached. Then publish the static changes through the existing
GitHub Pages release process. No DNS migration is necessary for a workers.dev URL.
A custom hostname is optional. Revisit the website privacy wording when replacing
GeoJS. No Worker was deployed as part of local implementation.

For Worker development, the supplied dev config binds only to `127.0.0.1:8787`.
Local development does not provide actual visitor country; use the Worker tests
for simulated `request.cf` metadata. Do not add an endpoint accepting arbitrary
visitor-supplied IP headers as a source of truth.

## Mobile and accessible layout

The hero uses three cards across on desktop and stacked rows at 760px and below.
Play targets are at least 48px high, text wraps, and controls move to another row
when enlarged text needs more space. There is no game carousel or horizontal
swipe requirement. The phone screenshot composition remains beside the choices
on desktop and moves below them on smaller screens, with a compact 288px-high
composition on mobile. Screenshots follow the regional choices at every width
and are lazy loaded. Repeated introduction text is hidden on mobile to bring games forward.
Keyboard focus indicators remain visible and links open the selected game in the
same tab. Existing catalog filters and the mobile menu keep working.

## Verification and publication

```sh
npm test
git diff --check
python3 -m http.server 8000 --bind 127.0.0.1
```

Automated tests cover countries, fallback languages, cache expiry, blocked
storage, no-JavaScript links, ordering, touch/hover/focus freeze, late responses,
timeouts, country-only Worker responses, CORS and click-to-engagement attribution.

For browser QA, simulate IP responses by intercepting the country endpoint in a
test browser. There is deliberately no production region query parameter or
visitor-facing country selector. Test 320, 360, 390, 430, 768, 1024 and desktop
widths, short-phone and landscape viewports, and 200% text. Check horizontal
overflow, focus visibility, all three Play links, menu and filters. Test failure,
slow response and no-JavaScript states. Block Google measurement requests in
browser QA; local previews already suppress custom events.

Use `game_engaged` per recommendation exposure to judge results. Compare regional
game engagement and card positions before changing profile rules. New custom
parameters need GA4 custom definitions before standard report breakdowns work;
they are not automatically registered by changing the website.

Implementation does not commit, push, change DNS or publish the website. The
optional Worker requires a separate deployment; the configured GeoJS lookup
requires only publication of the static site files.

### Local verification, November 27, 2026

- Existing analytics and real-game match tests and all 44 Python tests passed.
- Fourteen recommendation/Worker tests passed, including a busy-main-thread
  regression for the 600 ms update deadline.
- Chrome and Playwright WebKit passed 176 layout cases: six country profiles at
  seven widths with normal and doubled hero text, plus landscape and failure
  states. Menu, catalog filters, play hub ordering and game navigation passed.
- Both browser engines successfully fetched the real GeoJS country-only endpoint,
  received `IN`, applied the India profile from IP within the update budget, and
  carried hero-click attribution to the opened game's start event.
- Physical iPhones, Android devices and Samsung Internet were not exercised;
  these were browser-engine checks and responsive viewport simulations.
