#!/usr/bin/env python3
"""Human-run monthly Instagram Login token refresh. No posting or secret-writing workflow.

    python3 tools/instagram_token_refresh.py
    python3 tools/instagram_token_refresh.py --sync-only  # retry GitHub sync without refreshing

Reads the private file, refreshes an unexpired token at least 24 hours old, verifies the account,
and atomically saves the returned token and expires_in date. Optionally updates GitHub via gh.
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys

import instagram_tokens as tokens
from social_post import GraphError, instagram_expiry_error


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sync-only", action="store_true", help="sync the saved token without refreshing")
    args = parser.parse_args()
    values = tokens.read_env()
    required = ("IG_ACCESS_TOKEN", "IG_USER_ID", "IG_TOKEN_EXPIRES")
    if values.get("IG_AUTH_MODE") != "instagram_login" or any(not values.get(key) for key in required):
        raise GraphError("Instagram Login is not configured. Run tools/instagram_token_setup.py first.")
    now = dt.datetime.now(dt.timezone.utc)
    try:
        expiry = dt.date.fromisoformat(values["IG_TOKEN_EXPIRES"])
    except ValueError:
        raise GraphError("Invalid stored expiry. Run tools/instagram_token_setup.py.") from None
    if expiry <= now.date():
        raise GraphError("Token expired. Generate a new dashboard token and run tools/instagram_token_setup.py.")
    if args.sync_only:
        error = instagram_expiry_error(values["IG_TOKEN_EXPIRES"])
        if error:
            raise GraphError(error)
        account = tokens.profile(values["IG_ACCESS_TOKEN"])
        if account["user_id"] != values["IG_USER_ID"]:
            raise GraphError("Stored Instagram account ID does not match the token; run setup again.")
        tokens.github_values(values)
        print("✓ Saved Instagram token and variables synced to GitHub; no refresh or post was sent.")
        return 0
    try:
        issued = dt.datetime.fromisoformat(values.get("IG_TOKEN_ISSUED_AT", ""))
        if issued.tzinfo is None:
            raise ValueError
    except ValueError:
        raise GraphError("Token age is unknown. Run tools/instagram_token_setup.py, then wait 24 hours.") from None
    if now - issued < dt.timedelta(hours=24):
        raise GraphError("Wait until at least 24 hours after the last token setup or refresh.")
    result = tokens.token_request("refresh_access_token", grant_type="ig_refresh_token",
                                  access_token=values["IG_ACCESS_TOKEN"])
    updated = tokens.token_values(result, dt.datetime.now(dt.timezone.utc))
    account = tokens.profile(updated["IG_ACCESS_TOKEN"])
    if account["user_id"] != values["IG_USER_ID"]:
        raise GraphError("Refreshed token account ID changed; nothing was saved.")
    values.update(updated)
    tokens.update_env(updated)
    print(f"✓ Token refreshed and saved privately. Expiry: {values['IG_TOKEN_EXPIRES']} UTC.")
    if input(f"Also update Instagram secrets and variables on {tokens.REPO}? [y/N] ").strip().lower() == "y":
        tokens.github_values(values)
        print("✓ GitHub updated. Refresh again in about 30 days.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except GraphError as error:
        sys.exit(f"✗ {error}")
    except (KeyboardInterrupt, EOFError):
        sys.exit("\nStopped. Any token already saved remains in the private file; no posts were sent.")
