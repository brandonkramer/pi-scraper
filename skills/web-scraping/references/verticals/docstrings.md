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
