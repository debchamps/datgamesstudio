# Instagram Login verification — 2026-11-21

Option B is supported. No account login or live publishing was performed during verification.
Dashboard availability and the account's permissions still need the human setup check.

- **Route and access:** Instagram Login supports Business/Creator accounts without a linked
  Facebook Page. Standard Access is intended for accounts you own/manage and have added to
  the app; Advanced Access for other customers requires review and business verification.
  Meta now recommends Unified Login for new integrations, but still documents Instagram Login.
  We retain the explicitly chosen Instagram Login route. An accepted tester role and the correct
  permissions must be confirmed in the dashboard; Development mode alone does not grant them.
  [Platform overview](https://developers.facebook.com/documentation/instagram-platform/overview).
- **Account ID and dashboard token:** use `GET https://graph.instagram.com/v27.0/me` with
  `fields=user_id,username,account_type`; save `user_id`, the professional account ID, rather than
  assuming the app-scoped `id` is interchangeable. `/me` represents the token's account.
  Meta's example wraps the profile in `data`; the helper also accepts an unwrapped profile.
  Dashboard **Generate token** produces a 60-day token directly. A Business Login OAuth token
  lasts one hour instead.
  [Get started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started).
- **Permissions:** publishing uses `instagram_business_basic` and
  `instagram_business_content_publish`; comments additionally need
  `instagram_business_manage_comments`. No messaging permission is required here.
  Create with `POST /{user_id}/media` (`image_url`, `caption`), check
  `GET /{container_id}?fields=status_code`, then `POST /{user_id}/media_publish`
  (`creation_id`). The guide uses `graph.instagram.com/v27.0` for this login route.
  Media must be publicly retrievable. The guide lists 100 API posts per rolling 24 hours but
  also contains a 50-post statement in its carousel section: do not assume one universal cap;
  `GET /{user_id}/content_publishing_limit` reports the account's limit. One daily post is below
  either figure. Automated content publishing is a documented API feature.
  [Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing).
- **Images:** ordinary JPEG, maximum 8 MB, aspect ratio 4:5 through 1.91:1, width
  320–1440 pixels. Existing 1080×1350 feed images fit these dimensions.
  [Media reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media).
- **Read and comment:** read own posts via `GET /{user_id}/media?fields=id,caption`.
  Read comments with `GET /{media_id}/comments?fields=text`; add an answer using
  `POST /{media_id}/comments` with `message`. The comments reference explicitly includes the
  Instagram Login host/permission family and top-level comment creation.
  [Get started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started),
  [Comments reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments).
- **Token lifecycle:** optional short-token exchange is an unversioned
  `GET https://graph.instagram.com/access_token` with `grant_type=ig_exchange_token`,
  `client_secret` (the Instagram app secret), and `access_token`. Refresh is an unversioned
  `GET https://graph.instagram.com/refresh_access_token` with `grant_type=ig_refresh_token`
  and `access_token`. Refresh requires an unexpired long-lived token at least 24 hours old
  and `instagram_business_basic`. Save the returned token and compute expiry from the actual
  `expires_in`; expired tokens require login again. Refresh locally every 30 days, rather than
  every 45 days: 45 days is too close to the guard at fewer than 14 days remaining.
  [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login).
- **Dashboard correction:** Meta documents adding the Instagram product to an existing
  **Business** app and selecting **API setup with Instagram login**. Use-case labels can vary;
  do not assume the brief's exact label is present. If the existing app cannot add this product,
  use a separate Business app for Instagram, keeping Facebook on its original app.
  [App setup](https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app).

The expiry guard is fail-closed for live Instagram Login: missing/invalid expiry, an expired
token, or fewer than 14 days remaining prevents all API calls. Dry runs need no credentials.
The refresh helper is run by the human locally; no secret-writing workflow or PAT is added.
