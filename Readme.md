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

OpenKode is an active prototype, not yet a production-ready coding agent. It currently runs a local Ollama model (`qwen2.5-coder:3b`) and supports a small, controlled toolset.

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
- Local Ollama-backed orchestrator, planner, and coder workers.
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

- Node.js and pnpm
- [Ollama](https://ollama.com/) running locally
- The local model used by OpenKode:

  ```powershell
  ollama pull qwen2.5-coder:3b
  ```

- A running OpenCollector instance with a telemetry ingestion endpoint

### 1. Set up OpenCollector

Start OpenCollector separately and note the URL of its telemetry ingestion endpoint. OpenKode sends batched events to that endpoint.

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

Set the collector URL in `.env`:

```env
OPENKODE_TELEMETRY_COLLECTOR_URL=http://<your-opencollector-host>/<telemetry-ingestion-path>
```

The remaining telemetry settings can stay at their defaults while getting started.

New runs record the model's proposed route separately from the runtime's chosen route,
agent retry links and reasons, and tool execution or validation rejection. The dashboard
uses these records to explain why each call ran and what happened afterward. Older
traces keep their original evidence; missing routing decisions cannot be backfilled.

To include readable tasks, correction messages and tool payloads, enable
`OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT=true`. These fields use the same redaction and
length limits as existing model-content capture. With capture disabled, structural
decisions, ownership links, context counts and execution outcomes are still recorded.
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

### 3. Run OpenKode in a target project

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

Each interactive launch starts a new project-scoped chat. Use `/new`, `/chats`, `/rename <title>`, `/help`, and `/exit` inside the prompt. Chats are saved locally under `~/.openkode/chats` (or `OPENKODE_HOME` when set); only user prompts and final OpenKode responses are retained. The one-shot `openkode "prompt"` form remains available for scripts and does not create a saved chat.

Useful checks:

```powershell
openkode --version
openkode --help
```

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
