# Website analytics

GA4 property: **DAT Games Web**, `562910986`, measurement ID `G-677P55P83T`.

## Reporting configuration (saved November 9, 2026)

Six event-scoped custom dimensions are registered and verified through the GA4
Data API: **Game** (`game`), **Placement** (`placement`), **Action** (`action`),
**Result** (`result`), **Store** (`store`), and **Page type** (`page_type`).
The Events report was saved with all six available in its primary dimension picker.

[Open the saved Events report](https://analytics.google.com/analytics/web/?authuser=0&hl=en-US#/a213644929p562910986/reports/explorer?r=16301580840&collectionId=games).

Examples:

| Question | Event to filter on | Breakdown |
| --- | --- | --- |
| Which games do visitors actually play? | `game_engaged` | Game; use Total users for players, Event count for engaged matches |
| Which Play buttons attract clicks? | `play_click` | Game, then Placement |
| Which areas send visitors to the stores? | `store_click` | Placement, Game, Store |
| Do visitors complete rounds and matches? | `round_finish`, `match_finish` | Game, Result |
| Are visitors using hints or restarting? | `game_control` | Game, Action |
| Which rules pages are selected? | `guide_click` | Game, Placement |

Use the dropdown beside **Event name** to switch the primary breakdown. The **+**
beside that column adds a secondary breakdown. For several dimensions at once,
use **Explore → Free form**, import the custom dimensions, and put Game and
Placement in Rows, Event name in Columns, and Event count/Total users in Values.
For the clicked button and destination, import the predefined **Link text** and
**Link URL** dimensions; these use `link_text` and `link_url` without new custom
definitions.

Filter on the relevant custom event before interpreting its dimensions. Automatic
events such as `session_start` can have `(not set)` for these fields. Store clicks
measure visits to a store, not installs. Event count is not unique-player count.

Google says custom data can take **24–48 hours** to become available in reports
after the data is sent and the definition exists:
[event-scoped dimensions](https://support.google.com/analytics/answer/14239696?hl=en).
Do not expect old unregistered parameters to backfill these reports.

## Website event definitions

`assets/analytics.js` owns the shared tracker. All existing tagged pages load it;
`tools/build_guides.py` also emits that reference when guides are regenerated.
Google Ads and the GA4 bootstrap remain in the page head. Custom events explicitly
target GA4 so they are not also routed to the Ads tag.

| Event | Trigger |
| --- | --- |
| `play_click` | Internal link to a browser game or the play hub |
| `guide_click` | Internal link to a rules guide or guide hub |
| `store_click` | Google Play or App Store link, including catalog links |
| `site_click` | Other HTTP(S) links and section anchors |
| `site_control` | Mobile menu or catalog filter button |
| `game_control` | New match, play again, next round, hint, reveal trump, or menu |
| `game_start` | Match initialized; Action distinguishes `auto_start`, `new_match`, `play_again` |
| `game_engaged` | First successful human card play in each match |
| `round_finish` | Round/deal/hand result is shown; includes `round_number` and Result |
| `match_finish` | Final round completes, even if the visitor never opens the final result screen |
| `match_restart` | An engaged, unfinished match is replaced by a new match |

`game_start` includes automatically dealt games, so use **game_engaged** to answer
which games people actually play. Engagement resets on every match. Results are
deduplicated; opening the final result screen does not count completion again.
Bray reuses the Hearts module and is attributed to **bray**, using its page URL.

Every custom event includes `game`, `page_type`, and `page_path`. Link events also
include Placement, Link text, and Link URL. Game identifiers are consistent slugs
such as `twenty-nine`, `card-adda`, and `snake-uncoil`; catalog store links use
`all_games`. A navigation link to the play/rules hub uses `hub`.

Placement comes from the actual page region, rather than campaign query strings:
`hero`, `header`, `footer`, `game_card`, `play_hub_card`, `play_band`,
`guide_sidebar`, `guide_hero`, `guide_download`, `related_guides`, `guide_band`,
`game_table`, `game_overlay`, or a containing section ID. An explicit
`data-placement` attribute can override region inference.

Round results describe making/missing the contract or winning the hand. Hearts
and Bray use `clean` for nonpositive round scores and `points_taken` otherwise.
Match Result is `won` or `lost`, following the existing game UI's tie behavior.
Match summaries also send numeric `cards_played` and `rounds_completed` parameters.
Those numbers are available in raw event inspection; custom metrics for summing
them have not been registered. Standard report event counts already measure rounds
and matches directly.

The tracker sends no card identities, bids, invite codes, or form contents.
Custom Link URL drops query strings. Existing automatic GA4 collection is separate.
This is section/button tracking, not a pixel heatmap or session recording.

## Verification and release

Tracking changes are local until the website repository is published. No commit
or push was made as part of this change. The GA4 reporting configuration above is
already live. The pre-existing `app-ads.txt` edit is unrelated to this work.

```sh
npm ci --registry=https://registry.npmjs.org
npm test
python3 tools/build_guides.py
git diff --check
```

Tests capture gtag calls without network access and execute the actual game modules
in a DOM through a complete match for all eight browser games. They check game
attribution, actual engagement, round/match completion, controls, duplicate
suppression, guide/sidebar placement, store links, and local-preview suppression.
Node 22.13+ is required; Node's VM module API currently prints an experimental warning.
The site itself remains static and has no production npm dependency.

Both Google tag configurations and custom events are suppressed on localhost,
127.0.0.1, IPv6 loopback, and file previews. Verification does not add synthetic
players to the live property. After publishing, check Realtime with a real visit,
then check the detailed reports once GA4 has processed new traffic.
