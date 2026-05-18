# DeepWiki vertical extractor

**Action:** `deepwiki`

**Matches:** `https://deepwiki.com/:owner/:repo`

DeepWiki provides AI-generated documentation for open-source GitHub repos. This extractor parses DeepWiki's HTML to extract section navigation, source file listings, and repo metadata.

### Examples

```
# Popular repo wiki
web_extract action=deepwiki url="https://deepwiki.com/facebook/react"

# Small repo
web_extract action=deepwiki url="https://deepwiki.com/can1357/oh-my-pi"

# Infrastructure repo
web_extract action=deepwiki url="https://deepwiki.com/vercel/next.js"
```

**Returns:** owner, repo, lastIndexed, commit, sections[], activeSection, sourceFiles[], githubUrl

### Notes

- Parses text from DeepWiki's HTML (after tag stripping) — not a structured API
- `sections` are navigation headings extracted from the page sidebar (e.g. "Repository Structure", "System Architecture", "Core Components")
- `sourceFiles` are relevant source paths extracted from the "Relevant source files" section
- `activeSection` is the currently selected section in DeepWiki's menu
- `githubUrl` is always `https://github.com/:owner/:repo`
- Use `github_repo` first for metadata/README; use `deepwiki` when you need the AI-generated navigation and source file breakdown that DeepWiki provides
