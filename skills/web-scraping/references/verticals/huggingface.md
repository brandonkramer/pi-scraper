# Hugging Face vertical extractors

## `huggingface_model`

**Tool call:** `web_extract action=vertical extractor=huggingface_model url="..."`

**Matches:** `https://huggingface.co/:owner/:model` and legacy single-slug model URLs like `https://huggingface.co/bert-base-uncased`

Excludes reserved roots: datasets, spaces, docs, models, organizations, pricing, login, join

### Examples

```
# Popular model
web_extract action=vertical extractor=huggingface_model url="https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.2"

# Text embedding model
web_extract action=vertical extractor=huggingface_model url="https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2"

# Vision model
web_extract action=vertical extractor=huggingface_model url="https://huggingface.co/openai/clip-vit-large-patch14"

# Small model
web_extract action=vertical extractor=huggingface_model url="https://huggingface.co/google-bert/bert-base-uncased"

# Legacy single-slug model URL (also supported)
web_extract action=vertical extractor=huggingface_model url="https://huggingface.co/bert-base-uncased"
```

**Returns:** id, author, pipelineTag, tags[], downloads, likes, private, gated, createdAt, updatedAt, cardData

---

## `huggingface_dataset`

**Tool call:** `web_extract action=vertical extractor=huggingface_dataset url="..."`

**Matches:** `https://huggingface.co/datasets/:owner/:dataset` and legacy single-slug dataset URLs like `https://huggingface.co/datasets/cnn_dailymail`

### Examples

```
# Popular dataset
web_extract action=vertical extractor=huggingface_dataset url="https://huggingface.co/datasets/cnn_dailymail"

# Fine-tuning dataset
web_extract action=vertical extractor=huggingface_dataset url="https://huggingface.co/datasets/OpenOrca/OpenOrca"

# Image dataset
web_extract action=vertical extractor=huggingface_dataset url="https://huggingface.co/datasets/ILSVRC/imagenet-1k"
```

**Returns:** id, author, tags[], downloads, likes, private, gated, createdAt, updatedAt, cardData

### Notes

- Both use the Hugging Face API: `huggingface.co/api/models/:id` and `huggingface.co/api/datasets/:id`
- `cardData` contains the model/dataset card metadata (configuration, training details, etc.) as a raw object
- `pipelineTag` (models only) indicates the task type: "text-generation", "text-classification", "image-classification", etc.
- `gated` can be boolean or string — indicates if the model requires login approval
- The `huggingface_model` extractor rejects reserved paths (e.g., `huggingface.co/datasets/...` goes to the dataset extractor)
- Use `action=vertical` plus `extractor=huggingface_model` or `extractor=huggingface_dataset`; do not put the extractor name in `action`.

## Instead of

If you're tempted to reach for:
- `curl -s https://huggingface.co/api/models/:owner/:model | jq ...` (raw API, no shaping)
- `curl -s https://huggingface.co/api/datasets/:owner/:dataset | jq ...` (same)
- Scraping Hugging Face HTML for model/dataset card data

**Stop.** This vertical calls the Hugging Face API internally and returns structured id/pipelineTag/downloads/likes/cardData in one call. No `curl | jq` needed.

## Browser fallback

Default to this vertical's API path; it is faster and more reliable than browser rendering. Use `mode=browser` only as an explicit fallback when the normal API path is blocked/rate-limited or when you need a logged-in CloakBrowser session (`sessionId` + `saveSession=true`).
