# Launch defaults audit — 20 November 2026

This records material defaults and limits found in the CLI and hosted collector.
It distinguishes launch implementation choices from older code. Git author names
do not establish who proposed a decision in chat. This is a source audit, not a
claim that every historical conversation or deployed account setting was reviewed.

## Telemetry correction

- The local `.env` already enabled content capture. The earlier statement that
  current local runs necessarily lacked prompts/responses was incorrect.
- The shared policy and example configuration defaulted content capture off.
  Both now default on. An explicit `false` still disables content capture.
- The off default and 4,000-character limit occur in commit `bd2cea7`, before the
  current launch/deployment changes. They were carried forward without explaining
  their effect on evaluation. The earlier claim that the off default was newly
  chosen during launch work was not supported by the history.
- Enabling capture cannot reconstruct content absent from older stored events.

## Material choices and limits

| Setting | Actual behavior | Provenance / status |
| --- | --- | --- |
| Content size | 4,000 characters per serialized captured value; 4,000 total across generation input messages, favoring the newest messages. Truncation flags mark affected fields. | Older policy, carried forward. Still present; complete long-form evaluation is limited. Override with `OPENKODE_TELEMETRY_LLM_MAX_CONTENT_CHARS`. |
| Credential filtering | Credential-looking text is replaced with `[REDACTED]` before capture. This is heuristic and does not guarantee removal of every possible secret. | Older policy, retained. |
| Failed calls | A generation that throws records the error but does not run the success-only content metadata factory. A run that throws also lacks the success-only original-request/final-output fields. | Existing evaluation gap; enabling capture does not by itself make failed-call transcripts complete. |
| Upload durability | Queue is in memory (1,000 events); batches contain up to 10 events. HTTP uploads retry once. Failed batches are dropped; there is no disk-backed retry spool. | Queue/drop behavior predates launch; limited HTTP retry was added during deployment. Delivery is best-effort. |
| Hosted storage | Events go to Supabase Postgres JSONB. Hosted mode bypasses local JSONL/SQLite and the worker. | Launch implementation choice within requested Render/Supabase setup; storage path should have been explained explicitly. |
| Hosted request/view limits | Request body at most 1 MB; dashboard reads at most 20,000 spans per filter, then asks for a shorter range. | Launch implementation limits, not separately agreed product requirements. |
| Hosted AI analysis | Hosted `/analyze` returns 503 until an operator model is configured; trace browsing/export work. | Deferred during launch; previously reported. CLI provider support does not enable hosted analysis. |
| Platform support | Windows DPAPI and macOS login Keychain protection are implemented. Linux remains unsupported by saved-credential flows. | Windows-only restriction corrected at the user's request. macOS native integration test still needs a Mac; platform-independent crypto/command tests run on Windows. |
| Model selection | Defaults: Ollama `qwen2.5-coder:3b`, OpenAI `gpt-5.4-mini`, Claude `claude-sonnet-4-6`, Gemini `gemini-4-hydrogen`. Model IDs are editable; no silent provider fallback. | Cloud model defaults selected during launch work without a separate preference question. |
| Saved keys | Each provider retains its model and encrypted key. Switching providers or choosing Ollama preserves the others. Environment settings override the selected provider's saved settings. | Single-provider overwrite behavior corrected at the user's request; old records migrate on save. |
| Model errors | Three retries for selected transient HTTP errors; invalid credentials and ambiguous network failures are not retried; accepted streams are not replayed. | Retry feature explicitly requested; detailed retry policy selected in implementation. |
| Retention/deletion | No automatic trace expiry or user-facing account/trace deletion flow was found in the audited source. | Unfinished product behavior, not an agreed retention policy. |
| Package license | Package metadata currently says ISC, without a complete release license setup. | Existing metadata, not a confirmed license choice. Publishing still needs that decision. |

The 4,000-character cap, upload loss behavior, hosted limits and missing Linux credential support
remain visible limitations. This change does not silently replace those policies.
