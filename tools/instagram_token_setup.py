#!/usr/bin/env python3
"""Human-run Instagram Login setup. No posts are sent. Tokens are prompted with hidden input.

    python3 tools/instagram_token_setup.py                # dashboard token (already long-lived)
    python3 tools/instagram_token_setup.py --short-lived  # optional OAuth token exchange

The private file is merged, keeping Facebook's settings. GitHub sync is optional; it sets two
secrets and IG_AUTH_MODE/IG_TOKEN_EXPIRES variables using the human's local gh authentication.
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys

import instagram_tokens as tokens
from social_post import GraphError, LOCAL_ENV


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--short-lived", action="store_true", help="exchange a 1-hour OAuth token")
    args = parser.parse_args()
    print("Instagram Login for @datgamesstudio. Run in your own terminal; input is hidden.")
    token = tokens.hidden_input("Instagram access token: ")
    now = dt.datetime.now(dt.timezone.utc)
    if args.short_lived:
        secret = tokens.hidden_input("Instagram App Secret (not the Facebook App Secret): ")
        result = tokens.token_request("access_token", grant_type="ig_exchange_token",
                                      client_secret=secret, access_token=token)
        now = dt.datetime.now(dt.timezone.utc)
        values = tokens.token_values(result, now)
    else:
        generated = input("Dashboard token generated on UTC date YYYY-MM-DD [today]: ").strip()
        try:
            day = dt.date.fromisoformat(generated) if generated else now.date()
        except ValueError:
            raise GraphError("Use a valid generation date in YYYY-MM-DD format.") from None
        if day > now.date():
            raise GraphError("Token generation date cannot be in the future.")
        values = {"IG_ACCESS_TOKEN": token, "IG_TOKEN_EXPIRES": (day + dt.timedelta(days=60)).isoformat(),
                  # Conservatively wait 24h from setup before attempting the first refresh.
                  "IG_TOKEN_ISSUED_AT": now.isoformat()}
    from social_post import instagram_expiry_error
    error = instagram_expiry_error(values["IG_TOKEN_EXPIRES"])
    if error:
        raise GraphError("The token is too close to expiry. Generate a fresh dashboard token.")
    account = tokens.profile(values["IG_ACCESS_TOKEN"])
    values.update(IG_USER_ID=account["user_id"], IG_AUTH_MODE="instagram_login")
    tokens.update_env(values)
    print(f"✓ Verified @datgamesstudio; saved to {LOCAL_ENV} (mode 600), preserving Facebook settings.")
    print(f"✓ Conservative expiry date: {values['IG_TOKEN_EXPIRES']} UTC. Refresh locally every 30 days.")
    if input(f"Also update Instagram secrets and variables on {tokens.REPO}? [y/N] ").strip().lower() == "y":
        tokens.github_values(values)
        print("✓ GitHub Instagram secrets and variables updated. No posts were sent.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except GraphError as error:
        sys.exit(f"✗ {error}")
    except (KeyboardInterrupt, EOFError):
        sys.exit("\nStopped. If setup already saved the file, it remains private; no posts were sent.")
