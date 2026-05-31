# Autoresearch: Reduce tool contract token usage

## Objective

Reduce the serialized token count of the 6 web tool definitions (`web_scrape`, `web_crawl`, `web_map`, `web_batch`, `web_extract`, `web_get_result`) that get sent to the LLM as tool definitions every turn. The contract is `JSON.stringify({name, label, description, parameters})` for each tool.

The LLM uses these definitions to decide when and how to call each tool. We must preserve:
- The LLM's ability to understand what each tool does and when to use it
- All parameter fields (no removing params)
- Discriminator regex patterns that the test enforces on tool descriptions
- All test constraints (token ceilings, field membership, discriminator checks)

## Metrics

- **Primary**: `total_tokens` (unitless, lower is better) — sum of approximate token counts across all 6 tools (chars/4, ceiling)
- **Secondary**: `scrape_tokens`, `crawl_tokens`, `map_tokens`, `batch_tokens`, `extract_tokens`, `get_tokens` — per-tool token counts

## How to Run

```bash
./autoresearch.sh
```

Outputs: `METRIC total_tokens=<number>` and `METRIC <tool>_tokens=<number>` for each tool.

## Files in Scope

- `src/tools/web-scrape.ts` — web_scrape schema properties (35 params, 13 with descriptions, ~492 tokens)
- `src/tools/web-extract.ts` — web_extract schema (42 params, 30 with descriptions, ~852 tokens — biggest target)
- `src/tools/web-crawl.ts` — web_crawl schema (25 params, 3 with descriptions, ~322 tokens)
- `src/tools/web-batch.ts` — web_batch schema (15 params, 4 with descriptions, ~224 tokens)
- `src/tools/web-map.ts` — web_map schema (2 params, 0 with descriptions, ~58 tokens)
- `src/tools/web-get-result.ts` — web_get_result schema (5 params, 5 with descriptions, ~120 tokens)
- `src/tools/infra/schemas.ts` — shared schema options (scrapeModeOptionSchema, sessionOptionSchema, etc.)

## Off Limits

- Do **NOT** remove or rename any parameter fields — the LLM must keep the same surface area
- Do **NOT** change parameter types (e.g., `Type.String()` → `Type.Integer()`)
- Do **NOT** change tool names, labels, or execution logic
- Do **NOT** modify test files (`src/tools/__tests__/*`)
- Do **NOT** modify TUI renderers, agentic context helpers, or tool result formatting
- Do **NOT** change `outputFormatSchema`, `scrapeModeSchema`, `urlProperty`, or `modelProviderOptionSchema` — these are well-structured enums

## Constraints

- All 6 existing tool names must be present
- Each tool's token count must stay below its per-tool ceiling (500/330/180/230/860/160)
- Total tokens must stay ≤ 2220
- Tool descriptions must pass the discriminator regex checks in `tool-contract.test.ts`
- `web_scrape` must keep all scrape-only fields: `maxChars`, `onlyMainContent`, `timeoutSeconds`, `refresh`, `chunks`, `maxTokens`, `overlapTokens`
- No tool may gain config-only fields: `browserProfile`, `osProfile`, `removeImages`, `cacheTtlSeconds`, `maxAgeSeconds`
- Types must check: `npm run typecheck`
- All tests must pass: `npm test`

## What's Been Tried

### Baseline (2026-05-31)
- Current state: 2068 total tokens (492+322+58+224+852+120)
- 152 tokens under budget ceiling (2220)
- web_extract is the biggest at 852 tokens with 42 params and 30 descriptions
- web_scrape has 35 params with 13 descriptions at 492 tokens

### Strategy: Description compression
Focus on descriptions that are:
1. **Redundant with key name**: `maxBytes: "Max bytes."`, `snapshotName: "Name."`, `snapshotTag: "Tag."`
2. **Too vague to help LLM**: `sessionId: "Consent session."`, `saveSession: "Persist."`, `clearSession: "Clear."`
3. **Verbose format docs**: Can expressions be condensed?
4. **Long descriptions that can be shortened**: `selectors`, `extract`, etc.

### Key insight: `Type.Unsafe<...>({description: "..."})` produces the same schema as `Type.String({description: "..."})` — the description is just a string field, so we can freely shorten or remove descriptions.

## Results (final)

**Baseline**: 2068 tokens → **Final**: 1769 tokens — **299 tokens saved (14.5%)**

| Tool | Before | After | Saved | Slack |
|------|-------:|------:|:----:|:----:|
| web_scrape | 492 | 428 | 64 (13.0%) | 72 |
| web_crawl | 322 | 301 | 21 (6.5%) | 29 |
| web_map | 58 | 57 | 1 (1.7%) | 123 |
| web_batch | 224 | 202 | 22 (9.8%) | 28 |
| web_extract | 852 | 668 | 184 (21.6%) | 192 |
| web_get_result | 120 | 113 | 7 (5.8%) | 47 |
| **Total** | **2068** | **1769** | **299 (14.5%)** | **451** |

### What was changed (10 experiments)

1. **Removed redundant descriptions**: maxBytes, snapshotName, snapshotTag, headers, autoSave, limit, extractor, extractSchema, prompt, sourceFormat, identifier, threshold, adaptive, content, length, respectRobots — all were restating the key name or too vague
2. **Removed vague descriptions**: sessionId, saveSession, clearSession — "Consent session.", "Persist.", "Clear." didn't help LLM decide when to use them
3. **Shortened format docs**: regexes({…}→{…}), sections({…}→{…}), excerpts({…}→{…}), diff({…}→{…}), saveToFile(true or {…}→true/{…}) — condensed field names, kept shape info
4. **Shortened remaining descriptions**: selectors(69→41), schema(47→18), extract(48→35), query(42→25), topN(35→29), minScore(41→34), flags(43→26), attribute(25→10), browserBackend(35→27), provider(23→22), map(35→29) — trimmed to minimum viable length

### Remaining descriptions (13 tool desc + 17 param desc = 30 total)
All remaining descriptions are genuinely essential for LLM understanding:
- **Format docs** (6): regexes, sections, excerpts, saveToFile, diff — only way LLM knows complex type shapes
- **Tool descriptions** (6): discriminator-required by tests
- **Default/info** (5): maxTokens, overlapTokens, flags, topN, minScore — help LLM make informed parameter choices
- **Type/value hints** (7): selector, selectorType, attribute, browserBackend, provider, extract, selectors — clarify accepted values
- **Schema docs** (2): schema, query, sourceFormat — clarify usage context
- **Shared** (2): Model provider, Backend — spread via shared schemas

### Key lessons
- `{description: "..."}` on any TypeBox type adds "description" to the JSON schema — directly to the LLM
- The LLM uses these descriptions to understand parameter semantics → removing them must be done carefully
- Format docs on `Type.Unsafe` array types are the only way the LLM knows the element shape
- The fastest wins came from descriptions that either restated the key name or were too vague to help
