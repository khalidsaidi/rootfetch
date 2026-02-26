# rootfetch-sdk-py

This SDK is a verifiable artifact wrapper.

## Runtime

- Python `>=3.10`

## Usage

```python
from rootfetch_sdk import RootFetch

rf = RootFetch(base_url="https://rootfetch.vercel.app")

latest = rf.latest()
run = rf.run(latest["run_id"])
verification = rf.verify_manifest(latest["run_id"])

print("run_id:", latest["run_id"])
print("dvi:", run["artifacts"]["model_latest.json"]["dvi"]["score"])
print("regime:", run["artifacts"]["model_latest.json"]["regime"])
print("valid:", verification["valid"])
```

## API

- `latest()`
- `replay()`
- `run(run_id)`
- `verify_manifest(run_id)`

See [`docs/sdk_contract_v1.md`](../../docs/sdk_contract_v1.md) for the authoritative contract.
