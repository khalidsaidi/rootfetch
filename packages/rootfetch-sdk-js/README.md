# rootfetch-sdk-js

This SDK is a verifiable artifact wrapper.

## Runtime

- Node `>=18`
- Module format: ESM

## Install (local repo)

```bash
npm --prefix packages/rootfetch-sdk-js test
```

## Usage

```js
import { RootFetch } from "./src/index.js";

const rf = new RootFetch({ baseUrl: "https://rootfetch.vercel.app" });

const latest = await rf.latest();
const run = await rf.run(latest.run_id);
const verification = await rf.verifyManifest(latest.run_id);

console.log("run_id:", latest.run_id);
console.log("DVI:", run.artifacts["model_latest.json"].dvi?.score);
console.log("regime:", run.artifacts["model_latest.json"].regime);
console.log("valid:", verification.valid);
```

## API

- `latest()`
- `replay()`
- `run(runId)`
- `verifyManifest(runId)`

See [`docs/sdk_contract_v1.md`](../../docs/sdk_contract_v1.md) for the authoritative contract.
