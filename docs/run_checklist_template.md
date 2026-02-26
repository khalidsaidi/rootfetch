# RootFetch Next Run Checklist (Template)

Status: Operations Template  
Scope: Repeatable checklist for each local ingestion + publish cycle.

## 1) Pre-Run

- [ ] Confirm CZDS credentials are valid.
- [ ] Confirm local runner environment is loaded.
- [ ] Confirm `model_version` is unchanged or intentionally changed with governance docs prepared.
- [ ] Confirm no pending governance changes affecting this run.

## 2) Run

- [ ] Execute `scripts/local_run_hybrid.sh`.
- [ ] Confirm replay index updated.
- [ ] Confirm immutable run published.
- [ ] Confirm manifest verification is valid (`expected_count == checked_count`).

## 3) Post-Run

- [ ] Confirm `/runs` shows the new run.
- [ ] Confirm `/compare` works against prior run.
- [ ] Log run in KPI dashboard inputs.

## 4) Discipline

- [ ] No new interpretation step unless `meaningful delta` is triggered.
- [ ] If `meaningful delta` triggered, route to the required playbook and publication path.
