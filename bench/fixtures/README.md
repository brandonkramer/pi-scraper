# Bench fixtures

Tracked input snapshots for real-world DOM adapter comparisons. These files are inputs, not benchmark outputs.

`npm run capture:dom:real` refreshes these snapshots from public URLs and writes `manifest.json` with source URL, final URL, status, filename, and byte count.

| Fixture                   | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `article-page.html`       | Small article/static-page shape.           |
| `docs-site.html`          | Documentation site navigation and content. |
| `github-repo.html`        | GitHub repository HTML shape.              |
| `marketing-page.html`     | Commercial marketing page.                 |
| `npmx-package.html`       | npm package frontend page.                 |
| `spa-json-hydration.html` | JavaScript/SPAs with hydration data.       |
| `manifest.json`           | Capture provenance for the fixture set.    |
