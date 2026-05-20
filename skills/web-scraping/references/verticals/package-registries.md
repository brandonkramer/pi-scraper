# Package registry verticals: npm, PyPI, crates.io

## `npm`

**Matches:** `npmjs.com/package/:name`, `www.npmjs.com/package/:name[/v/:version]`, `npmx.dev/package/:name[/v/:version]`

### Examples

```
# Latest version
web_extract action=npm url="https://www.npmjs.com/package/express"

# Specific version
web_extract action=npm url="https://www.npmjs.com/package/typescript/v/5.3.0"

# Scoped package
web_extract action=npm url="https://www.npmjs.com/package/@angular/core"

# Via npmx.dev
web_extract action=npm url="https://npmx.dev/package/zod"
```

**Returns:** name, description, version, latestVersion, requestedVersion, homepage, license

---

## `pypi`

**Matches:** `https://pypi.org/project/:name`

### Examples

```
# Standard package
web_extract action=pypi url="https://pypi.org/project/requests/"

# Package with hyphens
web_extract action=pypi url="https://pypi.org/project/scikit-learn/"

# Package with unusual name
web_extract action=pypi url="https://pypi.org/project/pydantic/"
```

**Returns:** name, version, summary, homepage, license, projectUrls

---

## `crates_io`

**Matches:** `https://crates.io/crates/:name`

### Examples

```
# Popular crate
web_extract action=crates_io url="https://crates.io/crates/serde"

# CLI tool
web_extract action=crates_io url="https://crates.io/crates/ripgrep"

# Utility crate
web_extract action=crates_io url="https://crates.io/crates/anyhow"
```

**Returns:** id, name, description, latestVersion, homepage, repository, documentation, downloads, recentDownloads, license, createdAt, updatedAt

### Notes

- All three use upstream registry APIs (`registry.npmjs.org`, `pypi.org/pypi/.../json`, `crates.io/api/v1/crates/...`)
- No HTML scraping — fast and reliable
- npm supports scoped packages (`@scope/name`) and specific version queries

## Browser fallback

Default to this vertical's API path; it is faster and more reliable than browser rendering. Use `mode=browser` only as an explicit fallback when the normal API path is blocked/rate-limited or when you need a logged-in CloakBrowser session (`sessionId` + `saveSession=true`).
