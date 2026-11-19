# Eval report — seed-7 (10 cases)

Run `2026-11-19T11-11-53-792Z`, 2026-11-19T11:11:53.792Z → 2026-11-19T11:16:49.966Z. Models: triage `openai/gpt-5-nano`, coverage `openai/gpt-6-luna`, drafting `openai/gpt-6-luna`. Judge: `gpt-5-nano`.

| Agent | Scorer | Score | FR | EN | Cases |
| --- | --- | ---: | ---: | ---: | ---: |
| triage | request_type | 100.0 | 100.0 | — | 10 |
| triage | email_language | 100.0 | 100.0 | — | 10 |
| triage | fields | 100.0 | 100.0 | — | 9 |
| coverage | verdict | 88.9 | 88.9 | — | 9 |
| coverage | alerts | 88.9 | 88.9 | — | 9 |
| coverage | limit_deductible | 100.0 | 100.0 | — | 9 |
| coverage | citations | 100.0 | 100.0 | — | 9 |
| drafting | action_type | 88.9 | 88.9 | — | 9 |
| drafting | amounts | 100.0 | 100.0 | — | 9 |
| drafting | languages | 100.0 | 100.0 | — | 9 |
| drafting | tone_completeness_judge | 44.4 | 44.4 | — | 9 |
| coverage | citations_judge | 88.9 | 88.9 | — | 9 |
| workflow | case_correct | 90.0 | 90.0 | — | 10 |

Average cost per case: $0.0030.
Latency per case: p50 70574 ms, p95 90641 ms.

## Failing cases (1)

- `eval-7-004` (exclusion, fr): failed: coverage/verdict, drafting/action_type — [trace](http://localhost:3100/project/panora-demo/traces/91aa779e79d0481bb82975a2cdd482d0)
