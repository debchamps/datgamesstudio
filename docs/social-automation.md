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

**Status:** written and tested against a fake Meta API only (`tools/test_social_post.py`).
It has not yet posted for real. Meta changes its API and permission rules, so do the live test
below and check the current docs if a call is rejected.

## One-time setup

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
5. **Store the secrets** (never commit them; do this in your own terminal):
   ```bash
   gh secret set META_PAGE_TOKEN --repo debchamps/datgamesstudio
   gh secret set FB_PAGE_ID --repo debchamps/datgamesstudio
   gh secret set IG_USER_ID --repo debchamps/datgamesstudio
   ```
   Optional variable if Meta retires the API version in `social_post.py`:
   `gh variable set GRAPH_VERSION --body v25.0 --repo debchamps/datgamesstudio`.

## First live test

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
