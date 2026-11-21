"""No-network tests for human-run Instagram token setup, storage, refresh and GitHub sync."""
import datetime as dt
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import instagram_tokens as tokens
import instagram_token_setup as setup
import instagram_token_refresh as refresh
from social_post import GraphError


class TokenTests(unittest.TestCase):
    def settings(self, days_old=30, days_left=30):
        now = dt.datetime.now(dt.timezone.utc)
        return {"META_PAGE_TOKEN": "fixture-page", "FB_PAGE_ID": "456", "IG_AUTH_MODE": "instagram_login",
                "IG_ACCESS_TOKEN": "fixture-instagram", "IG_USER_ID": "123",
                "IG_TOKEN_EXPIRES": (now.date() + dt.timedelta(days=days_left)).isoformat(),
                "IG_TOKEN_ISSUED_AT": (now - dt.timedelta(days=days_old)).isoformat()}

    def test_storage_merges_facebook_and_is_private_even_when_replacing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "private" / "meta.env"
            tokens.update_env({"META_PAGE_TOKEN": "fixture-page", "FB_PAGE_ID": "456"}, str(path))
            path.chmod(0o644)
            tokens.update_env({"IG_ACCESS_TOKEN": "fixture-instagram"}, str(path))
            values = tokens.read_env(str(path))
            self.assertEqual(values["META_PAGE_TOKEN"], "fixture-page")
            self.assertEqual(values["FB_PAGE_ID"], "456")
            self.assertEqual(values["IG_ACCESS_TOKEN"], "fixture-instagram")
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(list(path.parent.glob(".meta-*")), [])

    def test_failed_replace_preserves_original_private_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "meta.env"
            tokens.update_env({"META_PAGE_TOKEN": "fixture-page"}, str(path))
            with mock.patch.object(tokens.os, "replace", side_effect=OSError("fixture-instagram")):
                with self.assertRaises(GraphError) as caught:
                    tokens.update_env({"IG_ACCESS_TOKEN": "fixture-instagram"}, str(path))
            self.assertNotIn("fixture-instagram", str(caught.exception))
            self.assertEqual(tokens.read_env(str(path)), {"META_PAGE_TOKEN": "fixture-page"})
            self.assertEqual(list(path.parent.glob(".meta-*")), [])

    def test_profile_uses_professional_user_id_for_wrapped_and_flat_responses(self):
        result = {"id": "999", "user_id": "123", "username": "datgamesstudio", "account_type": "BUSINESS"}
        for payload in (result, {"data": [result]}):
            with mock.patch.object(tokens, "Graph") as graph:
                graph.return_value.call.return_value = payload
                self.assertEqual(tokens.profile("fixture-instagram")["user_id"], "123")
                self.assertEqual(graph.call_args.kwargs["host"], "https://graph.instagram.com")
                graph.return_value.call.assert_called_once_with("GET", "me", fields="user_id,username,account_type")

    def test_profile_rejects_wrong_account_personal_or_ambiguous_response(self):
        payloads = [{"user_id": "123", "username": "other", "account_type": "BUSINESS"},
                    {"user_id": "123", "username": "datgamesstudio", "account_type": "PERSONAL"},
                    {"id": "123", "username": "datgamesstudio", "account_type": "BUSINESS"},
                    {"data": []}, {"data": [{}, {}]}]
        for payload in payloads:
            with mock.patch.object(tokens, "Graph") as graph:
                graph.return_value.call.return_value = payload
                with self.assertRaises(GraphError):
                    tokens.profile("fixture-instagram")

    def test_token_response_uses_returned_lifetime(self):
        now = dt.datetime(2026, 11, 21, 12, tzinfo=dt.timezone.utc)
        values = tokens.token_values({"access_token": "fixture-renewed", "expires_in": 30 * 86400}, now)
        self.assertEqual(values["IG_TOKEN_EXPIRES"], "2026-12-21")
        self.assertEqual(values["IG_TOKEN_ISSUED_AT"], now.isoformat())
        for result in ({}, {"access_token": "fixture-renewed", "expires_in": -1},
                       {"access_token": "fixture-renewed", "expires_in": True}):
            with self.assertRaises(GraphError):
                tokens.token_values(result, now)

    def test_token_endpoint_is_unversioned_and_never_prints_response(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {"access_token": "fixture-renewed", "expires_in": 5184000}).encode()
        with mock.patch.object(tokens.urllib.request, "urlopen", return_value=response) as request:
            tokens.token_request("refresh_access_token", grant_type="ig_refresh_token", access_token="fixture-old")
        parsed = tokens.urllib.parse.urlparse(request.call_args.args[0])
        self.assertEqual(parsed.netloc, "graph.instagram.com")
        self.assertEqual(parsed.path, "/refresh_access_token")
        self.assertEqual(tokens.urllib.parse.parse_qs(parsed.query)["grant_type"], ["ig_refresh_token"])

    def test_token_endpoint_errors_withhold_secrets(self):
        errors = [tokens.urllib.error.URLError("fixture-secret"),
                  tokens.urllib.error.HTTPError("fixture-secret", 400, "fixture-secret", {},
                                               io.BytesIO(b'fixture-secret'))]
        for error in errors:
            with mock.patch.object(tokens.urllib.request, "urlopen", side_effect=error):
                with self.assertRaises(GraphError) as caught:
                    tokens.token_request("access_token", client_secret="fixture-secret")
            self.assertNotIn("fixture-secret", str(caught.exception))

    def test_hidden_input_refuses_echo_fallback(self):
        with mock.patch.object(tokens.getpass, "getpass", side_effect=tokens.getpass.GetPassWarning("echo")):
            with self.assertRaises(GraphError):
                tokens.hidden_input("Token: ")

    def test_github_sends_secrets_only_over_stdin_and_sets_mode_last(self):
        with mock.patch.object(tokens.subprocess, "run") as run:
            tokens.github_values(self.settings())
        calls = run.call_args_list
        self.assertEqual(len(calls), 4)
        self.assertIn("IG_AUTH_MODE", calls[-1].args[0])
        for call in calls:
            self.assertNotIn("fixture-instagram", " ".join(call.args[0]))
            self.assertEqual(call.kwargs["stderr"], tokens.subprocess.DEVNULL)
        self.assertEqual(calls[0].kwargs["input"], b"fixture-instagram")
        self.assertEqual(calls[1].kwargs["input"], b"123")

    def test_github_error_withholds_subprocess_output_and_has_recovery(self):
        error = tokens.subprocess.CalledProcessError(1, ["gh"], stderr="fixture-instagram")
        with mock.patch.object(tokens.subprocess, "run", side_effect=error):
            with self.assertRaises(GraphError) as caught:
                tokens.github_values(self.settings())
        self.assertNotIn("fixture-instagram", str(caught.exception))
        self.assertIn("--sync-only", str(caught.exception))

    def test_dashboard_setup_does_not_exchange_and_verifies_account(self):
        with mock.patch.object(sys, "argv", ["setup"]), \
                mock.patch.object(tokens, "hidden_input", return_value="fixture-instagram"), \
                mock.patch("builtins.input", side_effect=["", "n"]), \
                mock.patch.object(tokens, "profile", return_value={"user_id": "123"}) as profile, \
                mock.patch.object(tokens, "token_request") as request, \
                mock.patch.object(tokens, "update_env") as save, \
                mock.patch.object(tokens, "github_values") as sync, redirect_stdout(io.StringIO()) as output:
            self.assertEqual(setup.main(), 0)
        request.assert_not_called()
        profile.assert_called_once_with("fixture-instagram")
        self.assertEqual(save.call_args.args[0]["IG_AUTH_MODE"], "instagram_login")
        self.assertEqual(save.call_args.args[0]["IG_USER_ID"], "123")
        sync.assert_not_called()
        self.assertNotIn("fixture-instagram", output.getvalue())

    def test_short_lived_setup_exchanges_then_saves_actual_expiry(self):
        with mock.patch.object(sys, "argv", ["setup", "--short-lived"]), \
                mock.patch.object(tokens, "hidden_input", side_effect=["fixture-short", "fixture-secret"]), \
                mock.patch("builtins.input", return_value="y"), \
                mock.patch.object(tokens, "profile", return_value={"user_id": "123"}), \
                mock.patch.object(tokens, "token_request", return_value={"access_token": "fixture-long", "expires_in": 5184000}) as request, \
                mock.patch.object(tokens, "update_env") as save, \
                mock.patch.object(tokens, "github_values") as sync, redirect_stdout(io.StringIO()) as output:
            self.assertEqual(setup.main(), 0)
        request.assert_called_once_with("access_token", grant_type="ig_exchange_token",
                                        client_secret="fixture-secret", access_token="fixture-short")
        self.assertEqual(save.call_args.args[0]["IG_ACCESS_TOKEN"], "fixture-long")
        sync.assert_called_once()
        for value in ("fixture-short", "fixture-secret", "fixture-long"):
            self.assertNotIn(value, output.getvalue())

    def test_refresh_saves_returned_token_and_preserves_all_other_settings(self):
        original = self.settings(days_left=7)  # guard blocks posting, but refresh must still work
        with mock.patch.object(sys, "argv", ["refresh"]), \
                mock.patch.object(tokens, "read_env", return_value=original.copy()), \
                mock.patch.object(tokens, "token_request", return_value={"access_token": "fixture-renewed", "expires_in": 5184000}) as request, \
                mock.patch.object(tokens, "profile", return_value={"user_id": "123"}), \
                mock.patch.object(tokens, "update_env") as save, \
                mock.patch.object(tokens, "github_values") as sync, \
                mock.patch("builtins.input", return_value="y"), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(refresh.main(), 0)
        request.assert_called_once_with("refresh_access_token", grant_type="ig_refresh_token", access_token="fixture-instagram")
        self.assertEqual(save.call_args.args[0]["IG_ACCESS_TOKEN"], "fixture-renewed")
        self.assertNotIn("META_PAGE_TOKEN", save.call_args.args[0])
        self.assertEqual(sync.call_args.args[0]["META_PAGE_TOKEN"], "fixture-page")
        self.assertNotIn("fixture-renewed", output.getvalue())

    def test_expired_young_unknown_age_and_unconfigured_tokens_do_not_refresh(self):
        cases = [self.settings(days_left=-1), self.settings(days_old=0), self.settings(), {}]
        del cases[2]["IG_TOKEN_ISSUED_AT"]
        for values in cases:
            with mock.patch.object(sys, "argv", ["refresh"]), \
                    mock.patch.object(tokens, "read_env", return_value=values), \
                    mock.patch.object(tokens, "token_request") as request, \
                    mock.patch.object(tokens, "update_env") as save:
                with self.assertRaises(GraphError):
                    refresh.main()
            request.assert_not_called()
            save.assert_not_called()

    def test_failed_refresh_never_overwrites_token(self):
        with mock.patch.object(sys, "argv", ["refresh"]), \
                mock.patch.object(tokens, "read_env", return_value=self.settings()), \
                mock.patch.object(tokens, "token_request", side_effect=GraphError("HTTP 400")), \
                mock.patch.object(tokens, "update_env") as save:
            with self.assertRaises(GraphError):
                refresh.main()
        save.assert_not_called()

    def test_sync_only_does_not_refresh_again(self):
        with mock.patch.object(sys, "argv", ["refresh", "--sync-only"]), \
                mock.patch.object(tokens, "read_env", return_value=self.settings()), \
                mock.patch.object(tokens, "profile", return_value={"user_id": "123"}), \
                mock.patch.object(tokens, "token_request") as request, \
                mock.patch.object(tokens, "github_values") as sync, redirect_stdout(io.StringIO()):
            self.assertEqual(refresh.main(), 0)
        request.assert_not_called()
        sync.assert_called_once()


if __name__ == "__main__":
    unittest.main()
