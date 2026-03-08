# RootFetch GCP Deployment (Canonical)

Status: Canonical runtime deployment reference.

## Project Scope

- GCP project ID: `rootfetch-prod-20260308`
- Region: `us-central1`
- Runtime platform: Cloud Run
- Edge/public routing: Firebase Hosting rewrites
- Artifact registry repo: `rootfetch`

## Cloud Run Services

- Web app: `rootfetch-web`
- MCP telemetry backend: `rootfetch-mcp-telemetry`

## Firebase Hosting Sites

- API edge: `rootfetch-api` (`https://rootfetch-api.web.app`)
- MCP edge: `rootfetch-mcp` (`https://rootfetch-mcp.web.app`)

## Service Accounts

- Runtime: `rootfetch-runtime@rootfetch-prod-20260308.iam.gserviceaccount.com`
- Build: `rootfetch-build@rootfetch-prod-20260308.iam.gserviceaccount.com`
- GitHub deployer (WIF): `rootfetch-github-deployer@rootfetch-prod-20260308.iam.gserviceaccount.com`

## Secret Manager (GCP)

- `rootfetch-mcp-token`
- `rootfetch-admin-dash-pass`

Runtime secret wiring:

- `ROOTFETCH_MCP_TOKEN` <- `rootfetch-mcp-token`
- `ROOTFETCH_MCP_TELEMETRY_BACKEND_TOKEN` <- `rootfetch-mcp-token`
- `INGEST_TOKEN` (telemetry service) <- `rootfetch-mcp-token`
- `ADMIN_DASH_PASS` <- `rootfetch-admin-dash-pass`

## GitHub Repo Configuration

Workflow: `.github/workflows/gcp_deploy.yml`

### Required GitHub secrets

- `WIF_PROVIDER`
- `WIF_SERVICE_ACCOUNT`

### Required GitHub variables

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `ARTIFACT_REPO`
- `WEB_SERVICE`
- `TELEMETRY_SERVICE`
- `ADMIN_DASH_USER`
- `NEXT_PUBLIC_SITE_URL`
- `ROOTFETCH_MCP_ALLOWED_ORIGINS`
- `ROOTFETCH_MCP_TOKEN_SECRET`
- `ADMIN_DASH_PASS_SECRET`

## Deployment Flow

1. Build/push web image via Cloud Build.
2. Build/push telemetry image via Cloud Build.
3. Deploy telemetry service first.
4. Read telemetry URL from Cloud Run.
5. Deploy web service with telemetry backend URL + runtime secrets.
6. Deploy Firebase Hosting targets (`hosting:api`, `hosting:mcp`) to route public traffic to Cloud Run.

## Operational Notes

- RootFetch ingestion remains local (`scripts/local_run_hybrid.sh`).
- Hosted runtime stays read-only and serves committed artifacts.
- Historical run artifacts are immutable and are not rewritten for platform migration.

## Domain Cutover

Canonical public base URL remains `https://rootfetch.com`.

If DNS changes are required, map the domain to Firebase Hosting (same pattern as other MCP projects), then verify:

1. `https://rootfetch.com/mcp`
2. `https://rootfetch.com/api/mcp/stats?days=7`
3. `https://rootfetch.com/rootfetch/artifacts/latest.json`

## Decommission Checklist

1. Confirm all production traffic resolves to Firebase Hosting + GCP runtime.
2. Confirm legacy deployment projects are removed.
3. Keep domain, hosting targets, and Cloud Run services in sync.
