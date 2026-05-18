# Docker Hub vertical extractor

**Action:** `docker_hub`

**Matches:** `hub.docker.com/r/:namespace/:repo`, `hub.docker.com/_/:repo` (official images)

### Examples

```
# Official image (the `_` prefix maps to "library" namespace)
web_extract action=docker_hub url="https://hub.docker.com/_/nginx"

# Community image
web_extract action=docker_hub url="https://hub.docker.com/r/jupyter/datascience-notebook"

# Official Node image
web_extract action=docker_hub url="https://hub.docker.com/_/node"

# Organization image
web_extract action=docker_hub url="https://hub.docker.com/r/bitnami/postgresql"
```

**Returns:** namespace, name, type, description, stars, pulls, private, owner, createdAt, updatedAt
