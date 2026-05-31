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

**Baseline**: 2068 tokens → **Final**: 1846 tokens — **222 tokens saved (10.7%)**

| Tool | Before | After | Saved |
|------|-------:|------:|-----:|
| web_scrape | 492 | 428 | 64 (13.0%) |
| web_crawl | 322 | 301 | 21 (6.5%) |
| web_map | 58 | 57 | 1 (1.7%) |
| web_batch | 224 | 202 | 22 (9.8%) |
| web_extract | 852 | 745 | 107 (12.6%) |
| web_get_result | 120 | 113 | 7 (5.8%) |
| **Total** | **2068** | **1846** | **222 (10.7%)** |

### What was changed

1. **Removed redundant descriptions**: maxBytes, snapshotName, snapshotTag, headers, autoSave, limit, extractor — all restated the key name
2. **Removed vague descriptions**: sessionId ("Consent session."), saveSession ("Persist."), clearSession ("Clear.") — didn't help LLM
3. **Shortened format docs**: regexes, sections, excerpts, diff, saveToFile — kept clarity while abbreviating field names
4. **Shortened remaining descriptions**: selectors, schema, extract, content, sourceFormat, query, topN, minScore, flags, attribute, identifier, adaptive, threshold, extractSchema, browserBackend, provider, map — trimmed to minimum viable length

### Remaining descriptions
All remaining descriptions (182 total chars of descriptions across 5 tools) are genuinely useful for LLM understanding. Further shortening would risk reducing the LLM's ability to correctly use the tools.
