# 6 · Deployment: Azure Container Apps

## What gets deployed

One image runs as three roles; the container command picks the role. `infra/main.bicep` creates:

| App | Role | Ingress | Replicas |
|---|---|---|---|
| `carlease-api` | HTTP API + agent page | external HTTPS | 1–3 |
| `carlease-worker` | Temporal worker + SQLite | none | 1 |
| `carlease-mocks` | mock external services | internal HTTP | 1 |
| `carlease-temporal` | Temporal dev server * | internal TCP :7233 | 1 |
| `carlease-temporal-ui` | Temporal UI * | external, your IP only | 1 |

\* only when `TEMPORAL_MODE=devserver` (the default).

It also creates Log Analytics, an Azure Container Registry, a managed identity with AcrPull, and a
VNet. The VNet is needed for TCP ingress to the Temporal gRPC port. The worker gets
`AGENT_PAGE_URL` pointing at the API's public `/agent` page, so agent task links work from the
Temporal UI.

## Deploy

```bash
az login
./infra/deploy.sh    # creates the resource group, builds the image in ACR, deploys the apps
```

The script prints the API URL and the Temporal UI URL. The UI only accepts traffic from your
current public IP. The image is built with `az acr build`, so you don't need Docker locally.

**With Temporal Cloud** (recommended for anything beyond a quick demo):

```bash
TEMPORAL_MODE=cloud \
TEMPORAL_CLOUD_ADDRESS=my-ns.a1b2c.tmprl.cloud:7233 \
TEMPORAL_CLOUD_NAMESPACE=my-ns.a1b2c \
TEMPORAL_CLOUD_API_KEY=... \
./infra/deploy.sh
```

Inspect the worker's database:

```bash
az containerapp exec -g rg-carlease-poc -n carlease-worker --command "node dist/scripts/show-db.js"
```

## PoC limitations

- **The dev server is in-memory.** All workflow history is lost when its replica restarts. Use
  Temporal Cloud, or a self-hosted cluster with Postgres, for anything real.
- **SQLite lives on the worker replica's disk.** That pins the worker to one replica, and the data
  is lost when the revision changes. Move to Azure SQL or Postgres beyond the PoC. The activities
  already use idempotent upserts, so this is a contained change.
- **The mock services keep their state in memory**, and are pinned to one replica.
- **No authentication** on the API or the agent page.

---
Back to the [README](../README.md)
