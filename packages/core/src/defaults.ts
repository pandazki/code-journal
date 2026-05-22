/**
 * Project-level policy defaults — values that downstream code (CLI defaults,
 * Electron renderer fallbacks, agent prompts, scheduler orchestrators) all
 * need to agree on. Lives in core so every consumer can import it; renderer
 * code (browser, no module resolver) duplicates the literal value with a
 * sync-with-this-file comment.
 *
 * History: prior to 2026-05-19 the "default lookback window" lived in five
 * scattered places — `defaultProject` seeded 14, `parseReportConfig` field
 * default was 14, but `listPendingDaily` and the `list-pending-reports` CLI
 * still defaulted to a legacy 30, and `cmdSynthContext` had a 1-day
 * "config-unreadable" recovery floor. The mismatch was invisible day-to-day
 * because Electron always passed an explicit value from project config —
 * but `code-journal list-pending-reports` run by hand silently used a wider
 * window than the rest of the system. Consolidated here.
 */

/** Catch-up window default (days), used when no project-level override exists. */
export const DEFAULT_CATCHUP_LOOKBACK_DAYS = 14;

/** Minimum value accepted from UI / patches. */
export const MIN_CATCHUP_LOOKBACK_DAYS = 1;

/** Maximum value accepted from UI / patches — guards against absurd inputs. */
export const MAX_CATCHUP_LOOKBACK_DAYS = 365;
