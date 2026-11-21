# Automatic Daily Trick posts (Facebook and Instagram)

A GitHub Action (`.github/workflows/daily-social.yml`) runs `tools/social_post.py` every day.
It posts the day's puzzle image with its caption, adds the puzzle link as a first comment on
Facebook, and comments yesterday's answer on yesterday's post. One post a day per platform;
the games per lane are in `tools/social_content.py`.

| Platform | Games | Time (UTC) |
| --- | --- | --- |
| Facebook Page | Callbreak, 29, Tarneeb, Bray | 14:30 (Tarneeb 17:00) |
| Instagram | Spades, Hearts, Bridge | 13:30 |

**Safe by default.** Until the repository variable `SOCIAL_POSTING_ENABLED` is `true`, every
run is a dry run that prints what it would post. A run first looks for an existing post for
the day's puzzle number, so re-running a failed job never posts twice.

**Status (2026-11-21):** Facebook is live. Instagram Login (Option B, no linked Facebook Page)
is implemented and tested against a fake API; the account setup and first live Instagram test
remain for the human. No live Instagram post was sent during implementation.

## Instagram setup — Option B (no Facebook Page link)

Meta's current requirements and links are recorded in [the API findings](instagram-api-findings.md).
The human does the logins, accepts invites and enters tokens. Never paste a token into chat,
the public repo, a command argument or a workflow input.

1. Open [DAT Games Social in the Meta dashboard](https://developers.facebook.com/apps/1653465589615252/).
   Add the **Instagram** product / Instagram management use case, then select **API setup with
   Instagram login**. Labels can vary. The app must be a Business app; if the existing app
   cannot add this product, create a separate Business app for Instagram and leave the Facebook
   app alone. Standard Access is sufficient for an owned/managed account added to the app;
   keep Development mode for this setup. Other people's accounts require Advanced Access.
2. Confirm `@datgamesstudio` is a public Professional account (Business or Creator). Add it
   as an Instagram tester/account under **App Roles → Roles** or the Instagram API setup.
   Accept the tester invitation while logged into that account (Instagram → Settings → Apps
   and websites → Tester invites; use Instagram's web settings if the phone app omits it).
3. Grant **`instagram_business_basic`**, **`instagram_business_content_publish`**, and
   **`instagram_business_manage_comments`**. Messaging permissions are unnecessary.
4. In **Instagram → API setup with Instagram login**, click **Generate token** beside the
   account and log in. Meta documents this dashboard token as long-lived (60 days).
5. In your own terminal, run:
   ```bash
   cd /Users/debarghy/Desktop/GamesV2/datgamesstudio
   python3 tools/instagram_token_setup.py
   ```
   Paste the token only into the hidden prompt. Enter the UTC date the dashboard generated it
   (default today). The helper reads `/me`, verifies `@datgamesstudio` is professional and saves
   the returned professional **`user_id`** as `IG_USER_ID`. It merges the private file
   `~/.config/datgames-social/meta.env` atomically with mode **600**, preserving Facebook settings.
   It saves `IG_ACCESS_TOKEN`, `IG_USER_ID`, `IG_AUTH_MODE=instagram_login`, `IG_TOKEN_EXPIRES`
   and a local `IG_TOKEN_ISSUED_AT` timestamp. The date guard uses midnight UTC conservatively.
6. Answer **y** to the optional GitHub sync after first checking `gh auth status`. This sets
   **secrets** `IG_ACCESS_TOKEN`, `IG_USER_ID` through stdin, and **repository variables**
   `IG_AUTH_MODE=instagram_login`, `IG_TOKEN_EXPIRES`. It does not change Facebook secrets,
   the schedule, or `SOCIAL_POSTING_ENABLED`. A failed sync can be retried without regenerating
   the token:
   ```bash
   python3 tools/instagram_token_refresh.py --sync-only
   ```

For a short-lived token obtained through a custom OAuth login instead of the dashboard, use
`python3 tools/instagram_token_setup.py --short-lived`. It also prompts, hidden, for the
**Instagram App Secret** and exchanges the token server-side. The secret is never saved.
No OAuth callback server is needed for the dashboard route.

### Instagram test and activation (human only)

After reviewing the local changes and pushing them yourself:

1. Run `IG_AUTH_MODE=instagram_login python3 tools/social_post.py instagram --date 2026-11-23`.
   It must print Spades **Daily Trick #7**, the caption and public image URL. This is a dry run;
   no credentials are loaded and no Meta requests are sent (only public image HEAD checks).
2. Actions → **Daily social posts** → Run workflow → platform `instagram`, leave **live** unticked.
   Check the caption, image URL and absence of warnings.
3. Run it again for today's puzzle with **live** ticked. Confirm the feed image and caption;
   the next day, confirm yesterday's answer comment. Rerunning checks for the puzzle number
   before posting, and for its answer marker before commenting.
4. The repository's `SOCIAL_POSTING_ENABLED` is already `true` according to the brief, so the
   13:30 UTC cron becomes live once the workflow and Instagram configuration reach GitHub.
   To complete both manual tests before any scheduled Instagram run, set
   `IG_AUTH_MODE=instagram_login` first but leave the **GitHub** `IG_ACCESS_TOKEN` secret unset
   until the dry run passes; live attempts fail closed on missing credentials. Then sync the
   token shortly before the first manual live test and complete it before 13:30 UTC. Local
   credentials can be configured earlier. Setting `SOCIAL_POSTING_ENABLED=false` pauses both
   platforms' scheduled live runs; manual dispatch still requires its own live checkbox.

### Monthly Instagram token refresh

Run locally every **30 days**, before the guard starts blocking posts:

```bash
python3 tools/instagram_token_refresh.py
```

The helper requires an unexpired long-lived token at least 24 hours after the previous setup
or refresh (the first wait is conservative). It saves the returned token and the expiry date
calculated from Meta's actual `expires_in`, preserving Facebook settings. Answer **y** to sync
the new secret and expiry to GitHub. No token or app secret is printed, passed as a process
argument, or added to a commit. No secret-writing GitHub workflow or personal access token is
introduced. No reminder or automatic local schedule is created by setup.

- With **fewer than 14 days remaining**, the Instagram Login job fails **before any API calls**,
  including yesterday's answer, so GitHub can notify the human (check Actions notification
  settings). Exactly 14 days is allowed. A missing/malformed expiry also blocks live calls.
  `--date` chooses the puzzle; it never overrides the real UTC token-validity date.
- If expired/revoked, generate a fresh dashboard token and rerun setup; an expired token
  cannot be refreshed. The helper never silently replaces a failed refresh with an assumed
  60-day expiry.
- If GitHub sync fails after refresh, the new token is already saved privately. Run
  `python3 tools/instagram_token_refresh.py --sync-only`; do not refresh again within 24 hours.
- Running the older Facebook setup helper rewrites the private file with Facebook settings;
  if you run it again later, rerun Instagram setup afterward. The Instagram helpers preserve
  existing Facebook values on every write.

### Configuration compatibility

`IG_AUTH_MODE` defaults to `facebook_login` when unset/empty. That original route still uses
`META_PAGE_TOKEN` and `IG_USER_ID` with `graph.facebook.com`. `instagram_login` uses only
`IG_ACCESS_TOKEN` and `IG_USER_ID` with `graph.instagram.com/v27.0`; it does not need
`META_PAGE_TOKEN`. Both reuse container → poll → publish, duplicate checks and answer comments.
Facebook always uses its Page token and ignores Instagram mode/expiry. The workflow passes the
new secrets and variables through without changing its dry-run/default-live controls.

## Existing Facebook setup and Page-linked Instagram fallback (Option A)

1. **Instagram account.** It must be a Professional account (Business or Creator) linked to the
   DAT Games Facebook Page (Instagram: Settings → Account type, and Page linking).
2. **Meta app.** At developers.facebook.com create an app (type Business) and add the Facebook
   Login and Instagram products. While you are an admin of the app, it can post to accounts you
   own without App Review; check Meta's current rules if that changes.
3. **Permissions** to request on the token: `pages_show_list`, `pages_read_engagement`,
   `pages_manage_posts`, `pages_manage_engagement`, `instagram_basic`,
   `instagram_content_publish`, `instagram_manage_comments`.
4. **A long-lived Page token.** In the Graph API Explorer pick your app, get a user token with
   the permissions above, then:
   ```bash
   # exchange for a long-lived user token (about 60 days)
   curl -s "https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN"
   # list your Pages: each has id and access_token; a Page token made this way does not expire
   curl -s "https://graph.facebook.com/me/accounts?access_token=LONG_USER_TOKEN"
   # the Instagram account id behind the Page
   curl -s "https://graph.facebook.com/PAGE_ID?fields=instagram_business_account&access_token=PAGE_TOKEN"
   ```
5. **Easiest way, for steps 4 and 5 together.** Run the helper in your own terminal. It asks for the
   App Secret and the Explorer token with hidden input, does the exchange, checks the Page token,
   saves everything to `~/.config/datgames-social/meta.env` (private, outside every repo) and, if
   you say yes, sets the GitHub secrets:
   ```bash
   python3 tools/meta_token_setup.py
   ```
   Never store tokens in this repository: it is public, and git history keeps deleted files.
   Local runs of `social_post.py --live` read that private file automatically.

   **Or store the secrets by hand** (never commit them; do this in your own terminal):
   ```bash
   gh secret set META_PAGE_TOKEN --repo debchamps/datgamesstudio
   gh secret set FB_PAGE_ID --repo debchamps/datgamesstudio
   gh secret set IG_USER_ID --repo debchamps/datgamesstudio
   ```
   Optional variable if Meta retires the API version in `social_post.py`:
   `gh variable set GRAPH_VERSION --body v28.0 --repo debchamps/datgamesstudio`.

## Facebook live test / Page-linked fallback

1. Actions → **Daily social posts** → Run workflow: platform `facebook`, leave live unticked.
   Read the printed post and check the image link opens.
2. Run it again with **live** ticked for today. Check the Page: the photo post, the link comment,
   and (from day two) yesterday's answer. Delete the post if it was only a test.
3. Repeat for `instagram`.
4. Turn on the daily schedule: `gh variable set SOCIAL_POSTING_ENABLED --body true --repo debchamps/datgamesstudio`.
   To stop everything at any time set it to `false`.

## Keeping it running

- **Images.** Posts use images published with the site (`daily/social/<platform>/`). About a month
  ahead run:
  ```bash
  python3 tools/build_daily.py --through 90
  python3 tools/make_social_week.py --start <first day not yet published> --days 35 --publish
  git add -A && git commit -m "Social images for the next month" && git push
  ```
  The job fails (and GitHub emails you) three days before the images run out.
- **Scheduled jobs pause** if the repository has no activity for 60 days; the monthly push above
  keeps them alive.
- **Token trouble.** An error mentioning an invalid or expired token means making a new long-lived
  Page token (step 4) and updating `META_PAGE_TOKEN`.
- **Change the games or times:** edit `PLATFORMS` and `TIMES` in `tools/social_content.py`, and the
  matching `cron` lines in the workflow (the cron time must equal the game's time).

## Not automated

Instagram Stories with link and quiz stickers (the API cannot add stickers), pinning the Facebook
first comment, posting in Facebook groups and Reddit. `tools/make_social_week.py` still makes the
Story images and quiz options for the manual part.
