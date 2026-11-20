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
