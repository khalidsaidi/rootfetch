/**
 * @typedef {{path: string, size: number, sha256: string}} ManifestFile
 *
 * @typedef {{
 *   run_id: string,
 *   model_version: string,
 *   snapshot_hash: string,
 *   snapshot_ts_utc: string,
 *   snapshot_utc_day: string,
 *   coverage?: {
 *     approved_tlds_count?: number,
 *     counted_ever_count?: number,
 *     counted_today_core_count?: number,
 *     counted_today_rolling_count?: number,
 *     missing_ever_count?: number
 *   }
 * }} LatestPointer
 *
 * @typedef {{
 *   runs: Array<{
 *     run_id: string,
 *     snapshot_ts_utc: string,
 *     snapshot_utc_day: string,
 *     snapshot_hash: string,
 *     model_version: string,
 *     dvi?: unknown,
 *     regime?: string,
 *     regime_confidence?: number
 *   }>
 * }} ReplayIndex
 *
 * @typedef {{
 *   run_id: string,
 *   model_version: string,
 *   snapshot_hash: string,
 *   snapshot_ts_utc: string,
 *   snapshot_utc_day: string,
 *   files: ManifestFile[]
 * }} Manifest
 *
 * @typedef {{
 *   run_id: string,
 *   manifest: Manifest,
 *   artifacts: Record<string, unknown>
 * }} RunBundle
 *
 * @typedef {{
 *   run_id: string,
 *   valid: boolean,
 *   expected_count: number,
 *   checked_count: number,
 *   checked_files: number,
 *   missing_files: string[],
 *   mismatched_files: Array<{
 *     path: string,
 *     expected_sha256: string,
 *     actual_sha256: string | null
 *   }>
 * }} VerificationResult
 */

export {};
