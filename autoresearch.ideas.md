# Deferred TUI LOC optimization ideas

## If retrying with higher risk tolerance
- **Extract shared "ctrl+o to expand" hint**: Create a small `expandHint(expanded?)` helper and replace the 6 inline occurrences. Likely break-even or marginal LOC save but improves consistency.
- **Merge re-export shims differently**: Instead of merging tool-text into tool-format (which added LOC), try merging the shims into their source files directly (inline tool-format exports into the consuming files). Risky because changes many import paths.
- **Extract shared check-keys pattern**: Several renderers check `!expanded && { text: ..., tone: "muted" }`. This could become a reusable helper but the LOC gain is tiny.

## If re-prioritizing to file_count
- **Merge tool-text into tool-format** would save 1 file at cost of ~3 LOC. Not worth it under primary LOC metric.
- **Merge tool-call into tool-format** would save 1 file. tool-call has `toolCall` and `renderText` which are fundamental; merging would introduce circular or distant deps.

## If behavior constraints relax
- **Remove deprecated file-result card export aliases** (toolIsFileResult, toolFileResultCard, toolBatchProgressCard, etc.) — these are pure re-exports for Pi naming. If they're not referenced externally, removing 5 lines each could save ~25 LOC.

## Structural (requires deeper analysis)
- **Consolidate addScrapeRow pattern**: The row-building pattern in scrape.ts is duplicated conceptually in batch.ts (batchItemGroup) and vertical.ts (buildVerticalSections). A shared row builder abstraction would add complexity but might save if used systematically.
- **Reduce addHeaderSections**: The cache/server/time section builder has ~60 lines for header parsing. If header handling could be simplified or delegated, significant savings possible.

## Already tried and failed
- Inlining medium-sized (10-20 line) helpers: renderResourceItemLines, batchItemGroup, paintBgLine, parseAgeSeconds — all increased LOC due to wrapper overhead.
- Merging tool-text → tool-format: saved file_count but added LOC.
