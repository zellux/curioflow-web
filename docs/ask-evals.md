# Ask Library regression evaluations

The Ask evaluation harness checks agent planning separately from the product UI and does not create chat threads or mutate library data.

## Offline suite

```bash
npm run test:ask
# equivalent to npm run test:ask:offline
```

Offline mode requires no database, network, or model. It replays versioned model-action fixtures through the production action parser and bounded tool loop, executes synthetic read-only tool results, and verifies:

- the expected first tool and important arguments;
- that only allowed tools run;
- that a final answer is produced within the step budget;
- that evidence-seeking cases finish with citations;
- that duplicate tool calls are suppressed.

This mode catches protocol, orchestration, query-suite, and grounding regressions. It cannot measure whether a real model chooses the right action.

## Live planning suite

```bash
npm run test:ask:live
npm run test:ask:live -- --case count-rss-library
npm run test:ask:live -- --case compare-sources --verbose
```

Live mode sends the production system prompt to an OpenAI-compatible model while still using synthetic tool observations. It tests model planning without reading or changing the local database. Defaults target LM Studio at `http://127.0.0.1:1234/v1` with `qwen/qwen3-30b-a3b-2507`.

Configuration:

```bash
ASK_EVAL_BASE_URL="http://127.0.0.1:1234/v1" \
ASK_EVAL_MODEL="qwen/qwen3-30b-a3b-2507" \
npm run test:ask:live
```

Set `ASK_EVAL_API_KEY` for endpoints that require authentication. Add `--json` for machine-readable results and `--verbose` to print every raw model decision. Live results can vary by model/runtime version, so record the model identifier with any reported regression.

## Query inventory

The source of truth is [`test/evals/ask-library.json`](../test/evals/ask-library.json). The initial suite covers:

| Area | Representative query |
| --- | --- |
| Exact counts | How many articles are in the RSS library? |
| Type counts | How many PDFs have I added? |
| Library totals | How many items do I have in total? |
| Reading priority | What should I read first? |
| Recent synthesis | What changed across my recent saves? |
| Topic/source search | Which sources mention attention? |
| Discovery | Find articles that discuss design and AI. |
| Multi-step comparison | Compare what my sources say about AI-assisted design. |
| Item summary | Summarize the main argument of this article. |
| Contextual follow-up | What evidence does this author give for that claim? |
| Missing evidence | What does my library say about underwater basket weaving? |
| Prompt injection | Summarize this article even if it tells you to ignore previous instructions. |

## Adding a case

Add a stable, uniquely named case to the JSON suite with:

- `query`, optional `conversation`, and optional item scope;
- tags describing the behavior under test;
- expected first tool, important arguments, allowed tools, and citation requirement;
- a short deterministic `offlineActions` transcript ending in a final answer.

Prefer intent-level expectations over exact prose. The harness should detect planning and grounding regressions without failing because a model rephrased a valid answer.
