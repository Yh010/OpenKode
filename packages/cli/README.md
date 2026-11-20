# OpenKode

Open source coding agent for your terminal. Supports Ollama, OpenAI, Claude and Gemini.

## Install

Requires Node.js 24.14 or newer on Windows or macOS.

```sh
npm install -g openkode
openkode login
openkode configure
```

Then open your project folder and run:

```sh
openkode
```

Or pass one request:

```sh
openkode "Explain this project"
```

The package includes the CLI, agent runtime and dependencies. You do not need to
clone the repository, install pnpm, run a collector or create a `.env` file.

## Models and keys

Choose a provider and model with `openkode configure`. Cloud providers require
your own API key. Model requests go directly to the selected provider and use
its normal API quota/billing. For local models, install Ollama separately.

OpenKode keeps each provider's settings and encrypted key on your computer in
`~/.openkode/model.json`. Windows uses account-based credential protection.
macOS uses an encryption key in your login Keychain. Switching providers keeps
the other saved keys. Package installation and native credential storage are
tested on Windows and macOS in GitHub Actions.

## Telemetry

Google login identifies your traces. OpenKode sends prompts, model responses,
tool inputs/results, errors, timings and token usage to the OpenKode collector
for evaluation. The operator can inspect these traces in a private dashboard.
Credential-pattern redaction is applied; general personal-data redaction is not
implemented. Captured fields are currently capped at 4,000 characters and marked
when shortened. Trace uploads are best-effort and can be lost during outages.

Set `OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT=false` before launching to disable
content capture; identity and structural usage events still upload. No automatic
trace expiry or user-facing deletion command is implemented yet.

The hosted collector is included by default. Self-hosted setups can set
`OPENKODE_TELEMETRY_COLLECTOR_URL`, `OPENKODE_SUPABASE_URL` and the corresponding
public `OPENKODE_SUPABASE_PUBLISHABLE_KEY`. Environment values override saved
provider settings through `OPENKODE_PROVIDER`, `OPENKODE_MODEL`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY` and `GEMINI_API_KEY`.

## Commands

- `openkode login` — sign in with Google. Use `--no-browser` to open the printed link yourself.
- `openkode configure` — choose a model or change saved keys.
- `openkode whoami` — show the signed-in account.
- `openkode logout` — sign out of this installation.
- `openkode scan` — inspect the current project structure.
- `openkode --help` — show available commands.

In interactive chat, use `/help`, `/new`, `/chats`, `/history`, `/rename` or `/exit`.

Source and issue reports: https://github.com/Yh010/OpenKode

License: ISC. Bundled dependency licenses are in `THIRD_PARTY_NOTICES.txt`.
