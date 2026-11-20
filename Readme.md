# OpenKode

OpenKode is an early-stage, local-first coding agent. Its goal is to become an open-source coding environment in the direction of tools such as Codex and Cursor: an agent that can understand a codebase, make changes, verify them, and explain what it did.

The project is being built from first principles. The current focus is not breadth of features; it is building a reliable foundation for tool use, permissions, orchestration, and observability.

## Vision

An LLM alone can suggest code, but it cannot safely work on a real project without a way to inspect files, make controlled edits, and validate what happened.

OpenKode's intended loop is:

```text
Discover files → search code → read context → plan → edit → verify
```

The model proposes actions, but the OpenKode runtime owns execution. Every filesystem operation passes through a constrained tool with validation and structured results.

```text
LLM proposes an action
        ↓
OpenKode validates it
        ↓
The tool performs the bounded operation
        ↓
OpenKode returns the observation to the LLM
```

That separation is central to the project: the model should not receive unrestricted filesystem or shell access just because it can generate text.

## OpenKode and OpenCollector

OpenKode is the coding agent. It handles the user prompt, coordinates the planner and coder workers, and executes approved tools inside the target project.

OpenCollector is the companion telemetry collector. It receives the run, span, agent-step, and LLM-generation events emitted while OpenKode works. This makes the agent observable: a run can be traced from the user request through orchestration, worker decisions, and tool-driven work.

```text
User
  ↓
OpenKode CLI
  ↓
OpenKode runtime ─────────────→ OpenCollector
  │                              receives telemetry events
  ├─ Orchestrator
  ├─ Planner
  ├─ Coder
  └─ File tools
```

OpenKode sends batched telemetry events to the URL configured in `OPENKODE_TELEMETRY_COLLECTOR_URL`. OpenCollector therefore needs to be running and exposing its ingestion endpoint before OpenKode can start.

## Current state

OpenKode is an active prototype with a small, controlled toolset. It supports local Ollama models and cloud models through the OpenAI and Anthropic APIs, using your own API key.

### Available tools

| Tool | Purpose | Important boundary |
| --- | --- | --- |
| `ReadFileTool` | Read one UTF-8 project file. | Cannot read outside the project. |
| `WriteFileTool` | Create or replace a complete UTF-8 file. | Cannot write outside the project. |
| `EditFileTool` | Replace one exact, unique text block. | Rejects missing or ambiguous target text. |
| `GlobTool` | Discover files by name or pattern. | Ignores generated/dependency folders and caps results. |
| `GrepTool` | Search text or regex patterns inside discovered files. | Searches only explicit, previously discovered paths. |
| `RunCommandTool` | Run an approved Node-project verification script. | Only root `package.json` scripts on the fixed allowlist; never invokes a shell. |

### What works today

- A CLI that accepts a natural-language request.
- Live progress for agent steps, file reads, searches, edits and verification, with short tool-result previews. Trace events are exported in the background without printing raw telemetry objects in the terminal.
- Orchestrator, planner, and coder workers using Ollama, OpenAI, Claude, or Gemini.
- Direct file-content requests through `ReadFileTool`.
- Direct file-creation/replacement requests through `WriteFileTool`.
- Planner-led repository discovery with Glob and Read.
- Coder-led exact edits with refreshed source context after each successful change.
- Structured tool errors so an agent can retry with corrected input.
- Project-root path protection for filesystem tools.
- Telemetry emitted to OpenCollector for every OpenKode run.

### What is still in progress

The basic tools work, but agent reliability is still being improved. In particular, broad questions such as “find all references” need stricter runtime enforcement so the model must use Grep across the required file set before returning an answer.

OpenKode now includes a constrained command-execution tool for project builds, tests, linting, and format checks after a change.

### Verification commands

OpenKode can automatically run a small set of verification scripts after a change: `test`, `lint`, `build`, and `format:check`. It only reads scripts from the target project's root `package.json`, selects pnpm, npm, or Yarn from that project's `packageManager` field or lockfile, and runs the script without a shell or model-supplied arguments. Non-Node projects and arbitrary commands are not supported in this first release.

## Setup

### Prerequisites

- Windows, Node.js 24.14 or newer, and pnpm (secure Google login and saved keys currently use Windows credential protection).
- An OpenAI or Anthropic API key for cloud models, or [Ollama](https://ollama.com/) running locally. For the default local model:

  ```powershell
  ollama pull qwen2.5-coder:3b
  ```

- A Google account to sign in to OpenKode.

### 1. Set up OpenCollector

The example configuration uses the hosted OpenCollector endpoint. For a self-hosted collector, replace that URL with your HTTPS ingestion endpoint. You do not need to deploy a collector to try this checkout.

The OpenKode runtime currently requires this endpoint; it will fail fast if `OPENKODE_TELEMETRY_COLLECTOR_URL` is not configured.

### 2. Set up OpenKode

Clone this repository and install the workspace dependencies:

```powershell
git clone https://github.com/Yh010/OpenKode.git
Set-Location OpenKode
pnpm install
```

Create a local environment file from the example:

```powershell
Copy-Item .env.example .env
```

The collector URL in `.env` is:

```env
OPENKODE_TELEMETRY_COLLECTOR_URL=https://openkode-collector.onrender.com/v1/telemetry/events
```

The remaining telemetry settings can stay at their defaults while getting started.

New runs record the model's proposed route separately from the runtime's chosen route,
agent retry links and reasons, and tool execution or validation rejection. The dashboard
uses these records to explain why each call ran and what happened afterward. Older
traces keep their original evidence; missing routing decisions cannot be backfilled.

Readable prompts, model responses, tasks, correction messages, tool inputs/results
and final answers are captured by default for evaluation. Set
`OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT=false` explicitly to disable content capture.
Credential redaction remains active. The existing default cap is 4,000 characters
per captured value and 4,000 characters across each generation's input messages;
truncated fields are marked. `OPENKODE_TELEMETRY_LLM_MAX_CONTENT_CHARS` changes this
cap. These are bounded evaluation records, not guaranteed full transcripts.
With capture disabled, structural decisions, ownership links, context counts and
execution outcomes are still recorded.
Rebuild the core and restart the CLI after changing runtime code.

For an explicit request to explain named files, the runtime reads those files from the
current project before asking the model for an answer. The latest question and fresh
contents are supplied separately from chat history. A failed read returns its actual
error without generating an explanation. Relative paths, quoted paths with spaces,
and absolute paths inside the current project are supported; outside-project paths
remain blocked. This guarantees current file evidence, not that every model explanation
is correct.

File changes go through Planner and Coder. Orchestrator proposals cannot write files or
claim a coding task completed directly. History is sent as background before the current
task for each agent. Workers omit unrelated history for explicit named-file tasks;
requests referring to earlier work retain it. Explicit new targets may be absent, while existing edit targets are
read and edited through approved paths. A no-op write or an empty plan cannot count as
completed implementation work. Coder responses are constrained to its accepted JSON
protocol, and each call includes fresh contents, acceptance criteria, and the count of
successful changes for the current plan step.

Build the core package and CLI:

```powershell
pnpm --filter @openkode/core build
pnpm --filter @openkode/cli build
```

Link the CLI globally:

```powershell
Set-Location packages/cli
pnpm link --global
```

### 3. Sign in with Google (Windows)

```powershell
openkode login
openkode whoami
openkode logout
```

`login` opens your browser and waits up to three minutes for Google sign-in.
It uses PKCE and a loopback-only callback on port 43821. Close any other OpenKode
login before starting another. Authentication works independently of Ollama
and OpenCollector. Google account creation/sign-in is currently configured in
testing mode; public availability has not been verified.

Only the Supabase refresh token is retained locally. It is encrypted using
Windows DPAPI for your Windows account and saved under `~/.openkode/auth`
(or `OPENKODE_HOME`). Access tokens and Google provider tokens are not saved.
`whoami` refreshes the saved session and verifies your identity with Supabase.
`logout` revokes this authentication session and removes local credentials;
`logout --local` only removes local credentials, useful when the server cannot
be reached. Already issued access tokens may remain valid until expiry.

Secure session persistence currently supports Windows only. macOS and Linux
credential-store integration remains pending. Authentication commands respect
the configured HTTP(S) proxy and system certificate store. If a command crashes,
its error may identify a stale `.lock` file: remove it only after confirming no
authentication command is running.

The default OpenKode Supabase URL and **public** client key are included in the
CLI. For a self-hosted backend, set `OPENKODE_SUPABASE_URL` and
`OPENKODE_SUPABASE_PUBLISHABLE_KEY`. Never use a secret or service-role key.
Configure `http://127.0.0.1:43821/auth/callback/*` in that project's allowed
redirect URLs. Google OAuth secrets stay in Supabase, never the CLI.

Coding commands require sign-in. OpenKode registers an installation per account,
a new CLI session per coding launch, and chat IDs when used. Every event carries
user, installation, session, optional chat, and run IDs. Telemetry sends a
Supabase bearer token over HTTPS or loopback HTTP. New run IDs are UUIDs;
historical IDs remain unchanged. The collector verifies ownership before saving
events; apply the run-registration migration and restart the collector.
Only IDs go into the identity database; chat contents remain local.
The collector's dashboard/read/export/analysis APIs require a verified Google
account approved in its server-side `OPENCOLLECTOR_ADMIN_USER_IDS` setting.
Ordinary CLI accounts can submit their own telemetry without dashboard access.

### 4. Run OpenKode in a target project

OpenKode uses the directory where the command is run as its project root. Move to the project you want it to inspect, then run a prompt:

```powershell
Set-Location C:\path\to\your\project
openkode "what does package.json contain?"
```

For a persistent interactive chat, start OpenKode without a prompt:

```powershell
Set-Location C:\path\to\your\project
openkode
```

Each interactive launch starts a new project-scoped chat. Use `/new`, `/chats`, `/rename <title>`, `/help`, and `/exit` inside the prompt. Signed-in chats are saved under `~/.openkode/accounts/<account-hash>/chats` (or `OPENKODE_HOME` when set). Earlier unowned chats remain separate and are not automatically assigned to an account. Only user prompts and final responses are retained locally. One-shot prompts do not create saved chats.

Useful checks:

```powershell
openkode --version
openkode --help
```

## Hosted telemetry

OpenCollector now runs at `https://openkode-collector.onrender.com`. Set
`OPENKODE_TELEMETRY_COLLECTOR_URL` to
`https://openkode-collector.onrender.com/v1/telemetry/events`, as shown in
`.env.example`. Sign in with `openkode login` before starting a coding session.
The CLI attaches verified account, installation and launch IDs to its traces.

The internal operator dashboard is at
`https://opencollector-dashboard.vercel.app`. Ordinary OpenKode accounts can
upload their own traces but do not receive dashboard access. Traces are stored
in Supabase, so a Render restart does not erase them. Free Render instances
sleep when idle; the first upload may take about a minute. Uploads retry once
after a temporary failure and remain best-effort during longer outages.

The CLI supports Ollama, OpenAI, Claude and Gemini. npm distribution remains follow-up
work. Hosted dashboard AI analysis separately needs a hosted model; trace
viewing, charts and Excel exports work now.

## Choose your model

After building/linking the CLI, run:

```powershell
openkode configure
openkode login
openkode "your task"
```

`configure` asks for a provider, model ID, and (for a cloud provider) an API key
in a masked prompt. It saves settings to `~/.openkode/model.json`; the key is
encrypted for the current Windows account. Switching to Ollama removes the
saved cloud key. Your key is sent only to the selected provider's official API,
in authentication headers. It is not sent to Supabase or OpenCollector.

OpenAI uses the Responses API with response storage disabled. Claude uses the
Messages API. Gemini uses Google's GenerateContent API with a Google AI Studio
API key. Agent decisions use structured JSON outputs; usage traces record
the actual provider/model and token counts. The CLI reports summed token usage
for cloud calls in each run. No provider fallback happens silently.

Temporary cloud-model HTTP errors retry up to three times with increasing delays
and small random offsets. The CLI shows the wait time and retry number. Server
`Retry-After` delays are respected up to 30 seconds; longer delays return a
try-again-later message. Invalid credentials and request errors fail immediately.
Retries cover the model request, without replaying tools or a stream that has
already started returning output.

The initial model choices are `gpt-5.4-mini`, `claude-sonnet-4-6` and
`gemini-4-hydrogen`; enter another
supported model ID during configuration to change them. Models must support
structured JSON outputs. Your provider controls availability, quotas, retention
and billing. A ChatGPT, Claude or Gemini chat subscription is not an API key.
Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/api-keys).
Gemini usage includes thinking tokens in output totals; cached prompt tokens
are already included in input totals.

For an environment-based setup, use `OPENKODE_PROVIDER` (`ollama`, `openai`,
`anthropic`, or `gemini`), optional `OPENKODE_MODEL`, and the matching
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`.
Environment values override saved settings; they are never
copied into the settings file. Avoid putting a real key in shell arguments or
committing it to a project. Without configuration, existing local Ollama setups
continue to use `qwen2.5-coder:3b`.

If automatic browser opening fails during Google login, use the printed link on
the same computer, or run `openkode login --no-browser`. Complete sign-in within
three minutes.

Provider references: [OpenAI Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses),
[OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[Claude Messages](https://platform.claude.com/docs/en/api/messages/create),
[Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
[Gemini GenerateContent](https://ai.google.dev/api/generate-content),
[Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).

## Project structure

```text
packages/
  core/     Agent runtime, workers, tools, LLM provider, and telemetry client
  cli/      The `openkode` command-line interface
```

## Milestones

- [x] Build the OpenKode CLI and local LLM orchestration loop.
- [x] Connect OpenKode telemetry to OpenCollector.
- [x] Add safe Read, Write, and Edit filesystem tools.
- [x] Add Glob and Grep tools for repository discovery and code search.
- [ ] Enforce evidence-backed reference-search workflows and improve tool reliability.
- [x] Add a constrained command-execution tool for builds, tests, and linting.
- [ ] Build an evaluation suite to measure agent reliability on real coding tasks.

## Development status

OpenKode is being developed in public as an educational, from-first-principles project. The implementation will evolve quickly, and the current interfaces should be treated as experimental.
