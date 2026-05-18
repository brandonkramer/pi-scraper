# arXiv vertical extractor

**Action:** `arxiv`

**Matches:** `https://arxiv.org/abs/:id`, `https://arxiv.org/pdf/:id`

### Examples

```
# Abstract page
web_extract action=arxiv url="https://arxiv.org/abs/2301.00001"

# PDF URL (auto-redirected to abstract)
web_extract action=arxiv url="https://arxiv.org/pdf/2301.00001.pdf"

# Paper with many authors
web_extract action=arxiv url="https://arxiv.org/abs/2006.16668"

# Old arXiv ID format
web_extract action=arxiv url="https://arxiv.org/abs/1701.00001"
```

**Returns:** id, title, summary, published, updated, authors[], categories[], pdfUrl

### Notes

- Uses the arXiv API (`export.arxiv.org/api/query?id_list=:id`) — XML response parsed server-side
- `authors` is an array of author names
- `categories` is an array of category terms (e.g., "cs.LG", "stat.ML")
- `pdfUrl` is the direct PDF link (useful for downstream download/reference)
- PDF URLs are normalized: `.pdf` suffix is stripped for the API query, `pdfUrl` is provided separately
- Supports both new-style IDs (`2301.00001`) and old-style IDs (`1701.00001`)
