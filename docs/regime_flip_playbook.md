# Regime Flip Playbook

Status: Operational  
Scope: Applies when Regime_v1 classification changes between consecutive immutable runs.

## 1) Trigger Conditions

A Regime Flip Bulletin is triggered when:

- `regime_left != regime_right`
- OR
- DVI band changes between consecutive runs, as defined by DVI_v1 band thresholds in `strategy_2026.md`.

A single bulletin may be issued per consecutive run pair. Multiple triggers (for example, regime change + band change) are consolidated into one bulletin.

Detection source:

- consecutive immutable runs
- verified via `/compare`
- artifact-only diff logic

Not allowed as trigger source:

- pre-run alerts
- internal signal-only triggers without immutable run evidence

Time reference:

- snapshot UTC timestamp of the right-hand run
- `publish_commit_timestamp_utc` of the right-hand run (required incident metadata field)

## 2) Immediate Response SLA

Publication SLA:

- within 24 hours of run publish
- no exceptions

SLA clock start:

- `publish_commit_timestamp_utc` of the right-hand run (immutable run publish commit timestamp on `main`)

Temporal invariant (required):

- `publish_commit_timestamp_utc <= detection_timestamp_utc <= publication_timestamp_utc`
- if violated, bulletin is invalid, must not be published, and SLA must be recorded as `INVALID` (not `Y/N`)

If triggered outside business hours:

- draft prepared within 12 hours
- publish within 24 hours

No delay for narrative refinement.  
No “wait for clarity” step.

## 3) Artifact Validation Checklist (Must Complete Before Publish)

1. Verify both runs via SDK:
   - `verifyManifest(run_left)`
   - `verifyManifest(run_right)`
2. Confirm for both runs:
   - `valid=true`
   - `expected_count == checked_count`
3. Confirm compare page integrity:
   - `/compare?left=<run_left>&right=<run_right>`
   - no degraded state
   - no missing files
4. Confirm replay index updated and ordered correctly.
5. Confirm snapshot hash and `model_version` behavior:
   - if unchanged, proceed.
   - if changed, bulletin must explicitly state the version transition and reference version change documentation for the new version before publication.

6. No partial compare rule:
   - bulletin must not be published if compare output reflects degraded state.

If any validation fails:

- do not publish bulletin
- log internal incident
- remediate artifact integrity first

## 4) Regime Flip Bulletin Template

Title:

- `RootFetch Regime Change Bulletin — <UTC date>`

Required fields:

- left run ID
- right run ID
- `publish_commit_timestamp_utc` (right-hand run)
- compare link
- DVI old -> new
- band old -> new
- regime old -> new
- confidence old -> new
- delta HHI
- delta Top10 share
- coverage delta (if any)
- manifest hashes (both runs)

Evidence policy:

- include direct evidence links only

Prohibited content:

- forecasts
- interpretation beyond artifact deltas
- market implications
- policy implications

Tone:

- structural documentation

## 5) Distribution Checklist

1. Publish markdown bulletin under `docs/briefs/`.
2. Push commit to `main`.
3. Post minimal distribution thread containing only:
   - regime old -> new
   - DVI delta
   - compare link
   - manifest verified
4. Post reply containing only verification instructions:
   - SDK example command(s)
   - notebook link

No additional commentary.

## 6) KPI Logging

Log the following:

- timestamp of detection
- timestamp of publication
- `publish_commit_timestamp_utc` (right-hand run)
- SLA compliance (`Y/N/INVALID`)
- runs referenced (`left`, `right`)
- external citation count (manual log)

KPI log entry (including dashboard input update) must be completed within 24 hours of publication.

## 7) Post-Incident Review (Within 7 Days)

Review checklist:

- detection timeliness
- SLA compliance
- artifact validation cleanliness
- publication remained artifact-linked only
- narrative drift (`Y/N`)

Document findings internally.

No public postmortem unless artifact inconsistency occurred.

## 8) Guardrails

- no predictive language
- no subjective adjectives
- no expansion beyond structural delta
- no linking to external speculation
- no modification of artifact outputs
- no changes to prior briefs post-publication (errata require separate correction note)

RootFetch documents structure.  
RootFetch does not interpret it.
