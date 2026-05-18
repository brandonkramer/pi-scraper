# Hugging Face vertical extractors

## `huggingface_model`

**Matches:** `https://huggingface.co/:owner/:model`

Excludes reserved roots: datasets, spaces, docs, models, organizations, pricing, login, join

### Examples

```
# Popular model
web_extract action=huggingface_model url="https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.2"

# Text embedding model
web_extract action=huggingface_model url="https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2"

# Vision model
web_extract action=huggingface_model url="https://huggingface.co/openai/clip-vit-large-patch14"

# Small model
web_extract action=huggingface_model url="https://huggingface.co/google-bert/bert-base-uncased"
```

**Returns:** id, author, pipelineTag, tags[], downloads, likes, private, gated, createdAt, updatedAt, cardData

---

## `huggingface_dataset`

**Matches:** `https://huggingface.co/datasets/:owner/:dataset`

### Examples

```
# Popular dataset
web_extract action=huggingface_dataset url="https://huggingface.co/datasets/cnn_dailymail"

# Fine-tuning dataset
web_extract action=huggingface_dataset url="https://huggingface.co/datasets/OpenOrca/OpenOrca"

# Image dataset
web_extract action=huggingface_dataset url="https://huggingface.co/datasets/ILSVRC/imagenet-1k"
```

**Returns:** id, author, tags[], downloads, likes, private, gated, createdAt, updatedAt, cardData

### Notes

- Both use the Hugging Face API: `huggingface.co/api/models/:id` and `huggingface.co/api/datasets/:id`
- `cardData` contains the model/dataset card metadata (configuration, training details, etc.) as a raw object
- `pipelineTag` (models only) indicates the task type: "text-generation", "text-classification", "image-classification", etc.
- `gated` can be boolean or string — indicates if the model requires login approval
- The `huggingface_model` extractor rejects reserved paths (e.g., `huggingface.co/datasets/...` goes to the dataset extractor)
