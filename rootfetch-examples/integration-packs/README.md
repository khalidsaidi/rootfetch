# RootFetch Integration Packs

Copy-ready scaffolding for integrating RootFetch immutable run evidence into existing tooling.

Available packs:

- `splunk/`
- `sentinel/`
- `soar-webhook/`

These packs are intentionally minimal:

- they do not fetch secrets
- they do not perform server-side recompute
- they attach run IDs, compare links, and manifest evidence paths
