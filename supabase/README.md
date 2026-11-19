# OpenKode identity setup

Project: `openkode` (`hzrnpjibpbaxjmlbfkeh`), South Asia (Mumbai).

Project URL: `https://hzrnpjibpbaxjmlbfkeh.supabase.co`

## Applied baseline

`migrations/202611190001_identity.sql` was applied through the Supabase SQL
Editor on 2026-11-19. This dashboard operation did **not** register it in the
Supabase CLI migration ledger. Before using CLI migrations against this project,
verify the remote schema matches this baseline, then reconcile migration history
instead of blindly reapplying the baseline. New empty projects can apply it once.

Tables:

- `profiles`: optional display name, keyed by the Supabase Auth user ID.
- `installations`: installation registrations owned by an account. Generate a
  new registration ID when a different account uses the same machine.
- `chats`: conversation IDs only; no chat content or titles.
- `cli_sessions`: CLI launches tied to an installation and user.
- `runs`: trace/run IDs registered by the authenticated collector, with session
  and optional chat ownership enforced by composite foreign keys.

All tables have RLS enabled. Anonymous access is denied. Authenticated users
can read only their own rows, create their own profile/installation/chat/session,
and update only their profile display name. Clients cannot insert runs directly.
Privileged collector credentials bypass RLS: the collector must validate tokens,
derive `user_id` from the verified identity, and scope every read/write itself.
Never distribute privileged credentials in the CLI.

Profiles are optional and are not created by a signup trigger. Supabase Auth is
the source of identity. Coding commands now register installation, session, and
chat IDs. Detailed telemetry stays in OpenCollector.

## Database verification

Verified in the SQL Editor with two temporary synthetic users and RLS role
switches in a transaction that was rolled back:

- Own installation/chat/run visible; another user's rows hidden.
- Another user's profile and CLI session hidden.
- Forged ownership on chat insertion rejected.
- Cross-user run/chat relation rejected even for privileged insertion.
- Direct run insertion by authenticated clients rejected.
- Anonymous table reads rejected.

These checks exercise database rules, not real Google login or collector token
verification. End-to-end authentication tests remain pending.

## Google login: provider enabled; CLI integration pending

Create an OAuth **Web application** client in Google Auth Platform for Supabase's
hosted Google integration. Register this exact authorized redirect URI:

```
https://hzrnpjibpbaxjmlbfkeh.supabase.co/auth/v1/callback
```

Enter its client ID and secret directly into Supabase Authentication > Sign In /
Providers > Google, then enable the provider. Keep nonce checks enabled. Start
with basic identity scopes (`openid`, `email`, `profile`). Google credentials
belong in provider configuration, never source control or the distributable CLI.

The CLI uses PKCE and port 43821 bound only to 127.0.0.1. The allowlist entry
`http://127.0.0.1:43821/auth/callback/*` was saved in Supabase. Each login uses a
new random callback path. The Google-to-Supabase callback above is separate
from Supabase's redirect to the CLI.

Google Cloud project `OpenKode` (`openkode-515213`) has been created under the
owner's personal account. The consent-screen configuration was submitted with
the app name OpenKode, the owner's support/contact email, and External audience
(testing), after the owner's explicit approval of Google's API Services User
Data Policy. Google confirmed "OAuth configuration created!".

The Web application client `OpenKode Supabase Login` was created with the
callback above after the owner's explicit consent. Google confirmed "OAuth
client created". The owner entered and saved the client credentials in Supabase.
Google sign-in was then enabled and saved; the provider list confirmed
`GoogleEnabled`. No credentials are stored in this repository.

The CLI now implements login, whoami, logout, PKCE callback validation, and
Windows DPAPI refresh-token persistence. Local authentication tests cover
callback validation, session encryption, and provider request contracts.
Collector ingestion now verifies user tokens and run relationships. The Google audience
remains in testing mode; public availability has not been verified.

Live validation on 2026-11-19: Google sign-in completed; a separate `whoami`
process decrypted and refreshed the saved session and verified the account via
Supabase. A real scoped logout also succeeded. No provider secrets or session
tokens were printed or added to source control.

## Run ownership registration

`migrations/202611190002_register_runs.sql` was applied via SQL Editor on
2026-11-19 (not recorded in the CLI migration ledger). Its security-definer
function fixes the search path, derives ownership from `auth.uid()`, validates
session/installation ownership, and inserts immutable run/chat links.
Authenticated callers can execute this checked function but cannot insert runs
directly. Collector calls need no service credential.

Verified live: stable installation across launches, distinct session IDs,
chat registration, idempotent run registration, forged IDs rejected, owned run
visible under RLS, and ownership preserved through raw JSONL normalization.
The smoke test creates labeled metadata records and removes temporary raw files.
It requires a login and the sibling OpenCollector checkout:

```powershell
pnpm --filter @openkode/cli exec tsx ../../supabase/tests/live-ownership.mts
```

OpenCollector's dashboard/read/export/analysis APIs now verify Supabase tokens
and require a server-side operator allowlist. Your local account is configured
as an approved operator. Ordinary CLI users have ingestion access only.

Verification: OpenKode core (36 tests), CLI auth (8), and collector ownership
(3) pass; all three packages build. Two-user SQL tests also reject foreign
sessions, cross-user reads, run takeover, and anonymous function execution;
temporary database users were rolled back. The old collector analytics test
expectation was corrected to match the documented root-outcome semantics;
collector and dashboard suites now pass in full.

## Operator dashboard login

The local collector API is running at `http://127.0.0.1:3000` and the dashboard
at `http://127.0.0.1:5175`. Supabase's callback allowlist includes
`http://127.0.0.1:5175/auth/callback/*`. Its Google OAuth client secret remains
unchanged in Supabase; the dashboard uses only the public project key.

Dashboard sign-in uses PKCE, keeps access tokens in memory and the refresh token
in tab-scoped sessionStorage, restores the session on reload, and revokes it on
sign-out. Every collector read/export/analysis request verifies the user and
checks `OPENCOLLECTOR_ADMIN_USER_IDS`. Empty configuration denies all accounts.
Live checks covered Google login, restored sessions, trace details, a valid
Excel export, sign-out and subsequent reload. Anonymous live reads, exports,
and analysis return 401. Synthetic non-operator accounts are denied by API tests.
The local dataset includes older test and performance traces; trace counts are
not customer counts. Public hosting, domain and HTTPS deployment are pending.

Final operator-access verification: all 52 collector tests and all 31 dashboard
tests pass, and both production builds succeed. The collector API, worker and
dashboard are running locally. A signed-in CLI missing-file smoke request
(`720b1267-770b-4d16-ad3e-a5b7e2a532a8`) generated five accepted events and
appeared in the authenticated dashboard after worker processing. No source files
were changed and no LLM call was needed for that request.

## Hosted trace storage

`202611190003_hosted_telemetry.sql` was applied through SQL Editor on
2026-11-19 (not in the CLI migration ledger). It adds durable JSONB events,
immutable/deduplicated ingestion, and database-enforced operator-only reads.
The project owner's verified UUID was separately inserted into
`collector_operators`; fresh installations must explicitly enroll their owner.
No service-role key or database password is used by the collector.

Live verification covered committed storage, duplicate uploads, rejected
overwrites, denied direct inserts/operator self-grants/anonymous reads, and the
hosted HTTP ingestion/detail/analytics/Excel routes using content-free test data.
The Render free entry point is `OpenCollector/src/cloud.ts`; local JSONL data
stays local. The Render and Vercel deployments are now live (details below).

Migration `202611190004_validate_stored_events.sql` also validates stored JSON
types, including LLM counters, when clients call the ingestion RPC directly.
It was applied through SQL Editor on the same date. Database role tests in
`tests/hosted-storage-rls.sql` passed for a non-operator identity, including
rejected self-grants, forged owners and anonymous ingestion permissions.

```powershell
$env:COLLECTOR_TEST_URL='http://127.0.0.1:3002'
pnpm --filter @openkode/cli exec tsx ../../supabase/tests/live-hosted-storage.mts
```

This writes one labeled smoke trace per invocation, containing no prompts or
source code. Set the test URL to the actual deployed HTTPS origin for final QA.

## Live deployment: 2026-11-19

- Collector: `https://openkode-collector.onrender.com` (Render free, Singapore).
- Operator dashboard: `https://opencollector-dashboard.vercel.app` (Vercel Hobby).
- Supabase Auth also allows
  `https://opencollector-dashboard.vercel.app/auth/callback/*`.

The production API and database both restrict reads to the approved operator.
Live verification covered Google login, session restoration after reload,
authenticated trace viewing, charts, a browser Excel download (valid XLSX with
two worksheets), and denied anonymous reads. A real CLI missing-file smoke
request produced five spans in run `77d9ad9c-29a0-4aea-bb9e-7fb598e3bc19`,
which appeared in the deployed dashboard. No model call or file edit was needed.
Test traces are labeled or content-free; these counts are not customer counts.

The CLI's private local `.env` and public `.env.example` now point to the Render
ingestion endpoint. Local JSONL history has not been uploaded. Hosted reads are
bounded to 20,000 spans per filtered view; shorten the date range above that
limit. Hosted AI analysis still needs a hosted model, and Google OAuth's public
onboarding state has not been verified beyond the existing approved account.

Render uses a public Git repository source, so deploy future collector commits
with **Manual Deploy → Deploy latest commit** in its console. Vercel is linked
to GitHub and automatically deploys the dashboard's `main` branch.
