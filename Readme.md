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

There is also no Bash/command-execution tool yet, so OpenKode cannot independently run a project build, tests, linting, or format checks after a change.

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
- [ ] Add a constrained command-execution tool for builds, tests, and linting.
- [ ] Build an evaluation suite to measure agent reliability on real coding tasks.

## Development status

OpenKode is being developed in public as an educational, from-first-principles project. The implementation will evolve quickly, and the current interfaces should be treated as experimental.
