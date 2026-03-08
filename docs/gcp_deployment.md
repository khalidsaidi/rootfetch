# RootFetch GCP Deployment (Canonical)

Status: Canonical runtime deployment reference.

## Project Scope

- GCP project ID: `rootfetch-prod-20260308`
- Region: `us-central1`
- Runtime platform: Cloud Run
- Artifact registry repo: `rootfetch`

## Cloud Run Services

- Web app: `rootfetch-web`
- MCP telemetry backend: `rootfetch-mcp-telemetry`

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

## Operational Notes

- RootFetch ingestion remains local (`scripts/local_run_hybrid.sh`).
- Hosted runtime stays read-only and serves committed artifacts.
- Historical run artifacts are immutable and are not rewritten for platform migration.

## Domain Cutover

Canonical public base URL remains `https://rootfetch.com`.

If DNS changes are required for Cloud Run custom domain mapping:

1. Create/verify domain mapping in GCP.
2. Apply required DNS records at registrar.
3. Verify `https://rootfetch.com/mcp`, `/api/mcp/stats`, `/rootfetch/artifacts/latest.json`.

## Vercel Decommission Checklist

1. Remove workflow: `vercel_deploy.yml`.
2. Remove Vercel env sync jobs and references.
3. Confirm all production traffic resolves to GCP runtime.
4. Remove stale Vercel project and tokens after successful cutover.
