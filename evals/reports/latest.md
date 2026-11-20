# Eval report — seed-7 (21 cases)

Run `2026-11-20T05-42-18-141Z`, 2026-11-20T05:42:18.141Z → 2026-11-20T05:48:32.906Z. Models: triage `openai/gpt-5-nano`, coverage `openai/gpt-6-luna`, drafting `openai/gpt-6-luna`. Judge: `gpt-5-nano`.

| Agent | Scorer | Score | FR | EN | Cases |
| --- | --- | ---: | ---: | ---: | ---: |
| triage | request_type | 100.0 | 100.0 | — | 21 |
| triage | email_language | 100.0 | 100.0 | — | 21 |
| triage | fields | 100.0 | 100.0 | — | 11 |
| coverage | verdict | 90.9 | 90.9 | — | 11 |
| coverage | alerts | 86.4 | 86.4 | — | 11 |
| coverage | limit_deductible | 100.0 | 100.0 | — | 10 |
| coverage | citations | 100.0 | 100.0 | — | 10 |
| drafting | action_type | 95.2 | 95.2 | — | 21 |
| drafting | amounts | 100.0 | 100.0 | — | 11 |
| drafting | languages | 100.0 | 100.0 | — | 18 |
| workflow | outcome | 100.0 | 100.0 | — | 10 |
| workflow | handover_reason | 100.0 | 100.0 | — | 2 |
| workflow | effective_date | 100.0 | 100.0 | — | 4 |
| drafting | tone_completeness_judge | 66.7 | 66.7 | — | 18 |
| coverage | citations_judge | 58.8 | 58.8 | — | 17 |
| workflow | case_correct | 95.2 | 95.2 | — | 21 |

Average cost per case: $0.0025.
Latency per case: p50 44513 ms, p95 58454 ms.

## Failing cases (1)

- `eval-7-001` (covered, fr):  — [trace](http://localhost:3100/project/panora-demo/traces/01067cf30d8c4050a19f0f990e3f3584)
