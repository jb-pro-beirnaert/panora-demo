# Panora demo — AI claims handling for an insurance brokerage

A claim e-mail reaches a brokerage, three AI agents analyze it, check coverage at the insurer
through an MCP connector, and a broker approves the proposed action before it is executed and
audited. Specifications (in French) are in [`specs/`](specs/); what each version did is in
[`docs/versions/`](docs/versions/).

> The full README (architecture, trade-offs, figures) is written in V11.

## Running locally

```bash
npm install
cp .env.example .env   # then fill OPENAI_API_KEY and the secrets
npm run dev            # Postgres + Redis (empty, tmpfs) and the 5 apps in watch mode
```

UI: http://localhost:3000 — the demo panel at the top drives the e-mail stream.

## Tracing: Langfuse Cloud or self-hosted

The Mastra server exports its traces to Langfuse: one trace and one session per case (initial run
and every resume), with the model, the prompt version and the e-mail language on the agents' spans,
and tokens and cost on every LLM call. The UI's audit log links to the trace.

- **Cloud**: set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` in `.env`,
  then `npm run dev`.
- **Self-hosted**: `npm run dev:langfuse` starts the same stack plus Langfuse (web UI on
  http://localhost:3100, worker, ClickHouse, MinIO, Redis; Compose profile `langfuse`, no volume).
  The project and its keys are created on startup: point `.env` to it (see `.env.example`) — same
  code, only the URL and the keys change. Going back to Cloud only means editing `.env` again.

### Why self-host in a regulated sector — and what it costs

- Traces contain prompts, claim e-mails, policy numbers and client names: personal and
  commercially sensitive data. Self-hosting keeps them inside the brokerage's infrastructure (and
  its hosting region), under its own access control and retention rules, with no extra
  sub-processor to declare.
- The cost is operational: five more containers (web, worker, ClickHouse, object storage, Redis)
  on top of Postgres, to size, monitor, upgrade (Langfuse ships often and ClickHouse migrations run
  on startup), secure (SSO, network policies) and back up (Postgres, ClickHouse and the bucket —
  deliberately not done here: the demo runs on tmpfs). Cloud is the better default until the data
  or contractual constraints require self-hosting.
