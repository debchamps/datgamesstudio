# Brief: automatic Instagram posting for The Daily Trick

For a coding agent (Codex) working in the `datgamesstudio` repo, with a human doing the few steps
that need a login. Read all of it before changing anything. Where this brief and Meta's current
docs disagree, **Meta's docs win**: fix the brief and say so in your summary.

## 1. Goal

Post one Instagram feed image a day for @datgamesstudio, with a caption, and comment yesterday's
answer on yesterday's post, with no manual work. Facebook already works this way; Instagram does
not, because the personal Facebook profile that owns the Meta developer account has a restriction
("can't add Instagram profiles"), so the Instagram account cannot be linked to the Facebook Page.

**Chosen route: "Instagram API with Instagram Login".** It authorises the Instagram professional
account directly and needs no Facebook Page link. (Fallback if the restriction is lifted later:
the existing Facebook-login path, see section 6.)

## 2. What exists (do not rebuild)

Repo: `/Users/debarghy/Desktop/GamesV2/datgamesstudio` (GitHub `debchamps/datgamesstudio`, branch
`main`, **public**, served by GitHub Pages at https://www.datgamesstudio.com). Read these first:

| File | What it does |
| --- | --- |
| `tools/social_content.py` | Lanes per platform (`PLATFORMS`), post times (`TIMES`), `build_post(platform, n)` returns caption, answer text, game, time; `image_url(platform, n)` |
| `tools/social_post.py` | The poster. `Graph` client, `Poster` with `fb_*` and `ig_*` methods (Instagram methods already written for the Facebook-login API: container, wait, publish, comment), dry run unless `--live`, `--slot`, `--date`, idempotency check, `RUNWAY_DAYS` check |
| `tools/test_social_post.py` | 15 tests against a fake Graph API (`FakeGraph`) |
| `tools/meta_token_setup.py` | Interactive helper (hidden input) that makes a Facebook Page token and saves it to `~/.config/datgames-social/meta.env` (mode 600) and GitHub secrets |
| `tools/make_social_week.py` | Renders images; `--publish` copies feed images to `daily/social/<platform>/` |
| `.github/workflows/daily-social.yml` | Cron: 13:30 UTC Instagram, 14:30 and 17:00 UTC Facebook. Posts for real only if repo variable `SOCIAL_POSTING_ENABLED` is `true` |
| `docs/social-automation.md` | Setup and upkeep guide (Facebook route) |

State: Meta app **DAT Games Social**, App ID `1653465589615252`, Graph API `v27.0`, use case
"Manage everything on your Page". Facebook posting is live. Instagram images for puzzles #5 to #39
are published in `daily/social/instagram/`. Instagram lane: Spades, Hearts, Bridge at 13:30 UTC.

## 3. Hard rules

1. **Never put a token, secret or key in the repo, a commit, a log, a test or a message.** The
   repo is public and history keeps deleted files. Secrets live in GitHub Actions secrets and the
   private file `~/.config/datgames-social/meta.env`. Never print them; the existing code avoids it.
2. **Safe by default.** No change may make the repo post for real without `--live` or
   `SOCIAL_POSTING_ENABLED=true`. Keep dry run as the default.
3. **Never post twice.** Keep the "find an existing post for the puzzle number" check.
4. **Do not post for real yourself.** The human runs the first live post (section 8).
5. **Do not push to `main`.** Commit locally; the human pushes.
6. Tools stay Python standard library only. Match the existing style, tests and docs.
7. Do not change Facebook behaviour. Run `npm test` before finishing; all tests must pass.

## 3b. Split of work

| Who | What |
| --- | --- |
| **Human** | Everything marked HUMAN in section 5 (logins, accepting invites, copying secrets) |
| **Codex** | Verify docs, code, tests, docs, workflow changes (sections 4, 6, 7) |

## 4. Phase 0: verify Meta's current docs (do first, report findings)

Verified 2026-11-21: see [findings and source links](instagram-api-findings.md). Dashboard-generated
tokens are already long-lived (60 days); use the professional `user_id` from `/me`. Add the
Instagram product / API setup with Instagram login to a Business app; dashboard labels vary.
Live calls must stop when fewer than 14 days remain, including expired/missing/invalid expiry.

The details below come from memory of Meta's documentation and must be checked. For
"Instagram API with Instagram Login" confirm and write down, with links:

- Base URL and version (`https://graph.instagram.com/v?/...`), and what to use for `{ig-user-id}`.
- Required permissions (expected: `instagram_business_basic`, `instagram_business_content_publish`,
  `instagram_business_manage_comments`).
- Publishing: create container (`POST /{ig-user-id}/media` with `image_url`, `caption`), poll
  (`GET /{container-id}?fields=status_code`), publish (`POST /{ig-user-id}/media_publish`
  with `creation_id`). Image rules (JPEG, aspect ratio 4:5 to 1.91:1; ours are 1080x1350).
- Reading own media (`GET /{ig-user-id}/media?fields=id,caption`) and comments
  (`GET /{media-id}/comments`, `POST /{media-id}/comments` with `message`).
- Tokens: how a long-lived token is obtained, its lifetime (expected 60 days), the refresh call
  (expected `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=...`),
  its conditions (token age, not expired), and whether the dashboard's "Generate token" gives a
  long-lived token directly.
- Whether the app in Development mode can publish to an Instagram account that is only an
  app tester, without App Review.
- Limits (posts per 24 hours) and any rule about automated posting.

If this route is not possible, stop and report why, and recommend the alternatives (section 6).

## 5. Setup steps (HUMAN does the logins; Codex writes the commands and checks)

1. **HUMAN, Meta app dashboard** (https://developers.facebook.com/apps/1653465589615252/): Use
   cases → Add use cases → **"Manage messaging & content on Instagram"**. Add the permissions in
   section 4. The app stays in Development mode.
2. **HUMAN, Instagram account**: it must be a Professional (Business or Creator) account.
   App roles → Roles → add **@datgamesstudio** as an Instagram tester.
3. **HUMAN, Instagram app (phone)**: log in as @datgamesstudio → Settings → Apps and websites →
   Tester invites → accept.
4. **HUMAN, dashboard**: Instagram use case → API setup → add the account → **Generate token**.
   Copy the token and the Instagram user id. Do not paste them anywhere except the helper below.
5. **Codex writes `tools/instagram_token_setup.py`** (modelled on `meta_token_setup.py`):
   hidden-input prompts for the token (and app secret if an exchange is needed), checks it with
   a read call, writes `IG_ACCESS_TOKEN`, `IG_USER_ID`, `IG_AUTH_MODE=instagram_login` to
   `~/.config/datgames-social/meta.env` (mode 600), optionally sets the GitHub secrets
   `IG_ACCESS_TOKEN` and `IG_USER_ID` through `gh secret set` reading the value from stdin, and
   sets the **repository variable** `IG_TOKEN_EXPIRES` (a date, not secret). Never print the token.
   **HUMAN runs it.**

## 6. Code changes (Codex)

1. `tools/social_post.py`: add an Instagram-login mode.
   - `IG_AUTH_MODE` env (`instagram_login` or `facebook_login`, default `facebook_login` so
     nothing changes for Facebook or the old path). In `instagram_login` mode the Instagram
     methods use `IG_ACCESS_TOKEN`, `IG_USER_ID` and the Instagram base URL; `META_PAGE_TOKEN` is
     not needed for Instagram. `load_local_env` already fills missing variables from the private file.
   - Make the missing-secrets message correct for each mode.
   - Reuse the existing container, polling, publish, idempotency and answer-comment logic; only
     the client base URL, token and field names should differ. Keep errors free of the token.
   - Add a **token expiry guard**: read `IG_TOKEN_EXPIRES` (YYYY-MM-DD); if fewer than 14 days
     remain, record a failure so the job fails and GitHub emails the human; if expired, refuse to post.
2. `tools/instagram_token_refresh.py`: refreshes the long-lived token (per section 4), writes the
   new token to the private file and the GitHub secret (stdin, never argv), updates
   `IG_TOKEN_EXPIRES`. The human runs it about monthly (the guard tells them when). Do **not**
   build a workflow that rewrites secrets: `GITHUB_TOKEN` cannot write secrets, and a personal
   access token with secret-write access is not worth the risk.
3. `.github/workflows/daily-social.yml`: pass `IG_ACCESS_TOKEN`, `IG_USER_ID` (secrets),
   `IG_AUTH_MODE` and `IG_TOKEN_EXPIRES` (variables) to the job. Keep everything else, including
   the dry-run default.
4. Tests in `tools/test_social_post.py` (extend `FakeGraph`, do not call the network): the
   Instagram-login mode uses the Instagram base URL and token; container then publish flow;
   idempotency; answer comment; expiry guard (7 days left fails, expired refuses, 30 days passes);
   missing secrets message; the token never appears in output or exceptions; Facebook tests unchanged.
5. Docs: update `docs/social-automation.md` with the Instagram-login setup, monthly refresh and
   what to do if the token expires. Update `docs/analytics.md` if event names change (they should not).

Fallbacks if the route is blocked: (A) the human requests a review of the Facebook profile
restriction on Business Support Home; once lifted, link Instagram to the Page, run
`tools/meta_token_setup.py` (it saves `IG_USER_ID`), and the existing `facebook_login` path
works unchanged. (C) A scheduler such as Buffer, Later or Metricool with weekly packs from
`tools/make_social_week.py`; no code.

## 7. Acceptance criteria

- [x] Phase 0 findings written down, with links, and the brief corrected where it was wrong.
- [x] `python3 -m unittest discover -s tools -p 'test_*.py'` and `npm test` pass.
- [x] `python3 tools/social_post.py instagram --date 2026-11-23` (dry run, `IG_AUTH_MODE=instagram_login`)
      prints the Spades #7 caption and image URL and sends nothing.
- [x] Live mode without the secrets stops with a clear message listing what is missing.
- [x] No secret in any file, diff, log or test output (repository credential-pattern scan and diff review).
- [x] Facebook posting behaviour and tests are unchanged (shared error reporting now withholds unsafe API details).
- [x] Docs updated; changes committed locally (not pushed) with a message that says what and why.

Implementation validation (2026-11-21): 44 Python tests and 15 JavaScript tests pass; the
requested dry run succeeds without warnings. The missing-secrets check uses an isolated empty
environment, with local credential loading disabled. Helpers and posting use only Python's
standard library. The new helpers preserve the private file's Facebook settings and include
`--sync-only` recovery after an interrupted GitHub sync. No private credential file was read,
no token was generated, no account/dashboard setting was changed, and no post was sent during
implementation. Sections 5 and 8 still require the human; [the setup guide](social-automation.md)
lists exact steps. No reminder or automatic refresh schedule has been created.

## 8. First live test (HUMAN, after the human pushes)

1. GitHub → Actions → **Daily social posts** → Run workflow: platform `instagram`, live unticked
   (dry run). Read the log: the image URL must be public and no warnings.
2. Run it again with live ticked for today's puzzle. Check the post on @datgamesstudio. Check the
   next day that yesterday's answer was commented.
3. Only then rely on the 13:30 UTC schedule (the variable `SOCIAL_POSTING_ENABLED` is already `true`).
4. Put a reminder to run `instagram_token_refresh.py` about every 30 days; the expiry guard fails
   the job 14 days before the token ends.

## 9. Out of scope

Instagram Stories with link and quiz stickers (the API cannot add stickers), pinning comments,
Facebook groups, Reddit, changing the Facebook lane. The daily Story is still done by hand from
`social/daily/` (see `make_social_week.py`).

## 10. When you finish

Report: what Meta's docs said (Phase 0), what you changed (files), test results, anything you
could not verify, and the exact steps left for the human.
