# Docstrings vertical extractor

**Action:** `docstrings`

Parses docstrings from raw source files. Supports TypeScript, JavaScript, Python, and Rust.

**Matches:** source file URLs ending in `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`

### Examples

```
# TypeScript file
web_extract action=docstrings url="https://raw.githubusercontent.com/vitejs/vite/main/packages/vite/src/node/server/index.ts"

# Python file
web_extract action=docstrings url="https://raw.githubusercontent.com/psf/requests/main/src/requests/api.py"

# Rust file
web_extract action=docstrings url="https://raw.githubusercontent.com/rust-lang/rust/master/library/std/src/fs.rs"

# JavaScript file
web_extract action=docstrings url="https://raw.githubusercontent.com/expressjs/express/master/lib/application.js"
```

**Returns:** file, exports[{name, kind, signature, description, parameters[{name, type?, optional?, description?}], returns?, examples[]}]

### Notes

- Works on raw source URLs (GitHub raw, unpkg, esm.sh, etc.) — any URL ending in a supported extension
- Determines language from file extension: `.ts`/`.tsx`/`.[cm]js`/`.jsx` → JSDoc/TSDoc, `.py` → Python docstrings, `.rs` → Rust doc comments
- Extracts all exported symbols with full parameter and return type annotations
- Use `format=raw` + `linesMatching` on the same URL if you need to grep the raw source body instead

## Instead of

If you're tempted to reach for:
- `curl -s <raw-source-url> | grep -A 10 "@param"` (fragile, one language)
- `python -c "import ast; ..."` (Python-only, extra runtime)
- `typedoc --json ... | jq '...'` (TypeScript-only, heavy tool install)
- `npm install -g documentation && documentation read ...` (heavy JS tooling)

**Stop.** This vertical parses TS/JS/Py/Rust source files server-side and returns structured export symbols with full parameter/return type annotations in one call. Language auto-detection, no CLI tools, no extra installs.

## Browser fallback

Default to this vertical's API/direct HTTP path; it is faster and more reliable than browser rendering. Add `mode=browser` only as an explicit fallback when JS-rendered page state, bot mitigation, or a logged-in CloakBrowser session is needed. In browser mode, pi-scraper pre-renders the page with CloakBrowser and passes that rendered page to the extractor's page-fetch path.
