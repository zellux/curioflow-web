# LLM context limits

Settings → Language model has separate **Context usage limit (tokens)** fields for
summaries/translations/briefings and Ask. Empty means automatic. A manual value
must be an integer between 2,048 and 10,000,000 and cannot exceed the known serving
capacity. Old mobile clients that omit these fields preserve existing limits.
Changing a model or endpoint resets its omitted limit; the Web UI clears it when
selecting a different model or provider.

At runtime the serving capacity takes precedence over a preset. The effective
window is the smaller of that capacity and the manual limit. Without detection,
use a known model preset; without either, use 16,384 tokens. Local endpoints use
the detected loaded context size, never a theoretical model preset.

## Common model presets

Checked November 2, 2026. The shared registry is `src/llm-context.ts`.

| Provider | Models | Tokens |
| --- | --- | ---: |
| OpenAI | GPT-6 Luna, GPT-6.1 Sol, GPT-6 Astra | 1,050,000 |
| Anthropic | Claude Opus/Sonnet/Haiku 5.5, Fable 5.1 | 1,000,000 |
| Meta | Muse Spark 1.3, Contributor, Muse Wonder 1.0 | 1,048,576 |
| OpenRouter | GLM 5.3 / Flash, DeepSeek V4.1 Flash, MiMo V2.6 Flash | 1,048,576 |
| OpenRouter | MiniMax M3 | 524,288 |
| OpenRouter | Nemotron 3 Ultra Free | 1,000,000 |

Sources: [OpenAI models](https://developers.openai.com/api/docs/models),
[Claude models](https://platform.claude.com/docs/en/models/overview),
[Meta models](https://dev.meta.ai/docs/models),
[OpenRouter model metadata](https://openrouter.ai/api/v1/models).
OpenRouter presets use `top_provider.context_length`, which can be lower than the
model's advertised `context_length` (for example MiniMax M3).

## Request budgets

Token counts are estimates, with a 10% safety margin and room for message framing.
Translation reserves space for its prompt, JSON structure, translation expansion,
and the reasoning tokens added by the LLM adapter. It replaces the old 1,200-character
and 20-node limits with a window-dependent batch size. Visible output is capped at
16,384 tokens per batch, so a very large window still produces bounded requests.
HTML, links, and skipped code/math are preserved. Completed translations are reused;
existing pending jobs retain their saved plans and refuse requests that exceed a
new, smaller limit. Restore the former limit to resume those jobs.

Ask reserves its 900-token response allowance and adapter reasoning allowance,
then budgets instructions, the question, history, and JSON tool observations
together. It drops old history/observations and shortens evidence when necessary,
retaining valid JSON and item IDs. `read_item` returns `nextOffset` when more text
is available; subsequent reads can continue at that character offset. Larger
windows can include full articles and more than six historical messages.
