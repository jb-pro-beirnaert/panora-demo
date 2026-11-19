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

## Cost, latency and model choice

Every model choice is backed by `npm run evals -- --matrix` (configurations in
[`evals/matrix.json`](evals/matrix.json)): each row changes one agent's model against the baseline,
or the architecture, or applies one optimisation. Models are switched **per case** (run options
passed from the eval runner through Core to Mastra), so the whole matrix runs against one server.
Cost comes from the Langfuse traces (sum of the LLM generations of the case), latency is the time
from `POST /emails` to the first proposal.

Sample: 6 cases per configuration (same cases for every row).

| Configuration             | Agent    | Model                                                       | Agent score |    FR |    EN | Cases correct | Cost / case | Latency p50 / p95 |
| ------------------------- | -------- | ----------------------------------------------------------- | ----------: | ----: | ----: | ------------: | ----------: | ----------------: |
| baseline                  | workflow | `openai/gpt-5-nano / openai/gpt-6-luna / openai/gpt-6-luna` |       100.0 | 100.0 | 100.0 |         100.0 |     $0.0034 |       78 s / 98 s |
| triage: gpt-4.1-mini      | triage   | `openai/gpt-4.1-mini`                                       |       100.0 | 100.0 | 100.0 |          66.7 |     $0.0033 |       32 s / 40 s |
| triage: gpt-5.4-nano      | triage   | `openai/gpt-5.4-nano`                                       |        97.2 |  95.8 | 100.0 |         100.0 |     $0.0018 |       31 s / 31 s |
| coverage: gpt-5.4-mini    | coverage | `openai/gpt-5.4-mini`                                       |        86.1 |  90.6 |  77.1 |         100.0 |     $0.0082 |       63 s / 65 s |
| coverage: gpt-4.1-mini    | coverage | `openai/gpt-4.1-mini`                                       |        83.3 |  87.5 |  75.0 |         100.0 |     $0.0096 |       64 s / 79 s |
| drafting: gpt-5-nano      | drafting | `openai/gpt-5-nano`                                         |        94.4 |  91.7 | 100.0 |          83.3 |     $0.0047 |      97 s / 107 s |
| drafting: gpt-4.1-mini    | drafting | `openai/gpt-4.1-mini`                                       |        88.9 |  91.7 |  83.3 |          83.3 |     $0.0036 |       56 s / 73 s |
| single agent (gpt-6-luna) | workflow | `openai/gpt-6-luna (one agent)`                             |       100.0 | 100.0 | 100.0 |         100.0 |     $0.0015 |       42 s / 65 s |
| reduced context           | workflow | `openai/gpt-5-nano / openai/gpt-6-luna / openai/gpt-6-luna` |        83.3 |  75.0 | 100.0 |          83.3 |     $0.0030 |       60 s / 73 s |

"Agent score" is the mean of the varied agent's scorers; "Cases correct" is the share of cases where
triage, verdict, action and amounts are all right.

**Reading it.** The sample is deliberately small (6 cases × 10 configurations ≈ $0.25 in API costs),
so one case flipping moves a column by 17 points: these numbers rank options, the full 60-case run
confirms them.

- **Triage**: `gpt-5.4-nano` scores like the baseline `gpt-5-nano` for **half the cost per case**
  ($0.0018 vs $0.0034) and less than half the latency: `gpt-5-nano` spends thousands of reasoning
  tokens on an extraction task. It is the next default to adopt once the full run confirms it.
  `gpt-4.1-nano` was also tried and is deprecated by OpenAI.
- **Coverage** is where quality is decided: the cheaper `gpt-5.4-mini` / `gpt-4.1-mini` keep the
  verdicts but lose points on alerts and citations, mostly on English cases, and cost _more_ per
  case (more tool round-trips and more tokens re-sent): `gpt-6-luna` stays.
- **Drafting**: `gpt-5-nano` and `gpt-4.1-mini` each picked a wrong action once: `gpt-6-luna` stays.
- **One agent vs three**: on this sample the single agent (same model, the three prompts merged) is
  as accurate and cheaper ($0.0015 vs $0.0034, one context instead of three). The three-agent
  design is kept for what the table does not show: a light model can do triage, each agent is
  evaluated and traced separately (a regression points to one prompt), the agents with tools are
  limited to read tools, and a rejected draft is rewritten without re-running the analysis.
- **Optimisations measured**:
  - _Prompt caching_: OpenAI caches stable prompt prefixes automatically; the agents' instructions
    come first and never change per case, so **62 %** of the input tokens of a baseline case are
    already served from the cache (75 % with the reduced context).
  - _Reduced context_ (photos dropped from the attachments, no attachments for the drafting agent):
    −12 % cost per case, 83 % of cases correct, above the 50 % threshold.
  - _Smaller model where the score holds_: triage on `gpt-5.4-nano` (above).
- **Local model**: `ollama/qwen3:4b` rows are in the matrix (`--with-ollama`, Compose profile
  `ollama`, `docker compose exec ollama ollama pull qwen3:4b`); not run here.
