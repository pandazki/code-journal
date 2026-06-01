/**
 * Domain types (L1) + parse/serialize helpers.
 *
 * Port of code_journal/models.py. Each model is:
 *   - An interface describing the runtime shape
 *   - A `parseX(obj)` function that validates + fills defaults + captures
 *     unknown keys into `_extra` (forward-compat passthrough)
 *   - A `serializeX(x)` function that emits the JSON-friendly dict with
 *     keys in the same order the Python `to_dict` produced.
 *
 * Field-omission rules are preserved verbatim:
 *   - Entry: optional scalars (work_started_at, motivation, ...) omitted when
 *     null/undefined; optional lists (attempts, lessons, ...) omitted when empty.
 *   - Project: `schema` block dropped when both custom_kinds and custom_fields
 *     are empty. (Caller-side rule applied in storage.writeProject.)
 *   - ReportMeta: `language` key absent when unset.
 *
 * Unknown top-level keys ride `_extra` and round-trip losslessly.
 */

import { DEFAULT_CATCHUP_LOOKBACK_DAYS } from './defaults';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

// -----------------------------------------------------------------------------
// EntryRefs
// -----------------------------------------------------------------------------

export interface EntryRefs {
  spec: string | null;
  plan: string | null;
  task: string | null;
  pr: string | null;
  commit_sha: string | null;
  _extra: JsonObject;
}

const ENTRY_REFS_KNOWN = ['spec', 'plan', 'task', 'pr', 'commit_sha'] as const;

export function parseEntryRefs(d: JsonObject | null | undefined): EntryRefs {
  const src = d ?? {};
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(src)) {
    if (!(ENTRY_REFS_KNOWN as readonly string[]).includes(k)) extra[k] = v;
  }
  return {
    spec: coerceStrOrNull(src.spec),
    plan: coerceStrOrNull(src.plan),
    task: coerceStrOrNull(src.task),
    pr: coerceStrOrNull(src.pr),
    commit_sha: coerceStrOrNull(src.commit_sha),
    _extra: extra,
  };
}

export function serializeEntryRefs(r: EntryRefs): JsonObject {
  const out: JsonObject = {};
  for (const k of ENTRY_REFS_KNOWN) {
    const v = r[k];
    if (v !== null && v !== undefined) out[k] = v;
  }
  for (const [k, v] of Object.entries(r._extra)) out[k] = v;
  return out;
}

// -----------------------------------------------------------------------------
// Artifact
// -----------------------------------------------------------------------------

export interface Artifact {
  path: string | null;
  url: string | null;
}

export function parseArtifact(d: JsonObject): Artifact {
  return {
    path: coerceStrOrNull(d.path),
    url: coerceStrOrNull(d.url),
  };
}

export function serializeArtifact(a: Artifact): JsonObject {
  const out: JsonObject = {};
  if (a.path !== null) out.path = a.path;
  if (a.url !== null) out.url = a.url;
  return out;
}

// -----------------------------------------------------------------------------
// CustomField
// -----------------------------------------------------------------------------

export type CustomFieldType = 'string' | 'number' | 'boolean' | 'list';

export interface CustomField {
  name: string;
  type: CustomFieldType;
}

export function parseCustomField(d: JsonObject): CustomField {
  if (!('name' in d) || !('type' in d)) {
    throw new Error("CustomField: 'name' and 'type' are required");
  }
  const t = d.type;
  if (t !== 'string' && t !== 'number' && t !== 'boolean' && t !== 'list') {
    throw new Error(`CustomField: invalid type ${JSON.stringify(t)}`);
  }
  return { name: String(d.name), type: t };
}

// -----------------------------------------------------------------------------
// SchemaExtensions
// -----------------------------------------------------------------------------

export interface SchemaExtensions {
  custom_kinds: string[];
  custom_fields: CustomField[];
  _extra: JsonObject;
}

export function parseSchemaExtensions(d: JsonObject | null | undefined): SchemaExtensions {
  const src = d ?? {};
  const known = new Set(['custom_kinds', 'custom_fields']);
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(src)) {
    if (!known.has(k)) extra[k] = v;
  }
  return {
    custom_kinds: asStringList(src.custom_kinds),
    custom_fields: asList(src.custom_fields).map((c) => parseCustomField(c as JsonObject)),
    _extra: extra,
  };
}

export function serializeSchemaExtensions(s: SchemaExtensions): JsonObject {
  const out: JsonObject = {
    custom_kinds: [...s.custom_kinds],
    custom_fields: s.custom_fields.map((c) => ({ name: c.name, type: c.type })),
  };
  for (const [k, v] of Object.entries(s._extra)) out[k] = v;
  return out;
}

// -----------------------------------------------------------------------------
// ReportConfig
// -----------------------------------------------------------------------------

export interface ReportConfig {
  catchup_lookback_days: number;
  language: string;
  _extra: JsonObject;
}

export function parseReportConfig(d: JsonObject): ReportConfig {
  const known = new Set(['catchup_lookback_days', 'language']);
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(d)) {
    if (!known.has(k)) extra[k] = v;
  }
  return {
    catchup_lookback_days:
      d.catchup_lookback_days !== undefined
        ? Number(d.catchup_lookback_days)
        : DEFAULT_CATCHUP_LOOKBACK_DAYS,
    language: typeof d.language === 'string' && d.language.length > 0 ? d.language : 'en',
    _extra: extra,
  };
}

export function serializeReportConfig(r: ReportConfig): JsonObject {
  const out: JsonObject = {
    catchup_lookback_days: r.catchup_lookback_days,
    language: r.language,
  };
  for (const [k, v] of Object.entries(r._extra)) out[k] = v;
  return out;
}

// -----------------------------------------------------------------------------
// ScheduleTrigger — per-project recurring synth schedule
// -----------------------------------------------------------------------------
//
// Lives at the top-level `schedule` key on Project. Honored exclusively by
// the Electron host's in-process scheduler. `mode = 'manual'` is the safe
// default: no recurring run, user drives via the manual skill instead.
// `daily` fires once per day at `time` (host local tz). `weekly` fires once
// per week at `time` on `weekday` (0 = Sunday … 6 = Saturday, mirroring
// JS's Date.getDay). Timezone is always the host's local tz; no override.

export type ScheduleMode = 'manual' | 'daily' | 'weekly';

export interface ScheduleTrigger {
  mode: ScheduleMode;
  /** HH:MM (24h, host local tz); meaningful only when mode ≠ 'manual'. */
  time: string | null;
  /** 0-6 (Sun…Sat); meaningful only when mode === 'weekly'. */
  weekday: number | null;
  _extra: JsonObject;
}

const SCHEDULE_KNOWN = new Set(['mode', 'time', 'weekday']);

function asMode(v: unknown): ScheduleMode {
  if (v === 'daily' || v === 'weekly' || v === 'manual') return v;
  return 'manual';
}

export function parseScheduleTrigger(d: JsonObject | null | undefined): ScheduleTrigger {
  const src = d ?? {};
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(src)) {
    if (!SCHEDULE_KNOWN.has(k)) extra[k] = v;
  }
  const weekdayRaw = src.weekday;
  let weekday: number | null = null;
  if (weekdayRaw !== null && weekdayRaw !== undefined && weekdayRaw !== '') {
    const n = Number(weekdayRaw);
    if (Number.isInteger(n) && n >= 0 && n <= 6) weekday = n;
  }
  return {
    mode: asMode(src.mode),
    time: coerceStrOrNull(src.time),
    weekday,
    _extra: extra,
  };
}

export function serializeScheduleTrigger(s: ScheduleTrigger): JsonObject {
  const out: JsonObject = { mode: s.mode };
  if (s.time !== null) out.time = s.time;
  if (s.weekday !== null) out.weekday = s.weekday;
  for (const [k, v] of Object.entries(s._extra)) out[k] = v;
  return out;
}

// -----------------------------------------------------------------------------
// Project
// -----------------------------------------------------------------------------

export interface Project {
  project_id: string;
  display_name: string;
  schema_: SchemaExtensions;
  /**
   * Always present. Legacy `--no-daily-reports` projects (config.json with
   * `report: null` or no `report` key) are auto-upgraded by the parser to a
   * fully-defaulted ReportConfig — see parseProject below. The flag has been
   * retired; toggling daily-report output is now a per-day concern handled
   * by the drafter's zero-entry-day skip rule.
   */
  report: ReportConfig;
  schedule: ScheduleTrigger;
  /**
   * IANA timezone this project reckons calendar days in — entry filing date,
   * "today"/"yesterday" query windows, and report staleness all resolve
   * through it. Empty string means "use the host's auto-detected zone"
   * (`init` writes the detected zone here so it's explicit and stable even if
   * the project is later opened from a machine in a different zone).
   */
  timezone: string;
  _extra: JsonObject;
}

export function parseProject(d: JsonObject): Project {
  if (!('project_id' in d)) throw new Error("Project: 'project_id' is required");
  // Accept both "schema" (JSON key) and "schema_" (Python attr) forms.
  const schemaDict = 'schema' in d ? d.schema : d.schema_;
  const known = new Set([
    'project_id',
    'display_name',
    'schema',
    'schema_',
    'report',
    'schedule',
    'timezone',
  ]);
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(d)) {
    if (!known.has(k)) extra[k] = v;
  }
  // `report` is always returned; a missing or `null` value (legacy
  // `--no-daily-reports` projects) silently upgrades to a fully-defaulted
  // ReportConfig — parseReportConfig({}) supplies every field's default.
  const report =
    d.report && typeof d.report === 'object' && !Array.isArray(d.report)
      ? parseReportConfig(d.report as JsonObject)
      : parseReportConfig({});
  return {
    project_id: String(d.project_id),
    display_name: d.display_name !== undefined ? String(d.display_name) : '',
    schema_: parseSchemaExtensions((schemaDict as JsonObject) ?? null),
    report,
    schedule: parseScheduleTrigger((d.schedule as JsonObject) ?? null),
    timezone: typeof d.timezone === 'string' ? d.timezone : '',
    _extra: extra,
  };
}

export function serializeProject(p: Project): JsonObject {
  const out: JsonObject = {
    project_id: p.project_id,
    display_name: p.display_name,
    schema: serializeSchemaExtensions(p.schema_),
    report: serializeReportConfig(p.report),
  };
  out.schedule = serializeScheduleTrigger(p.schedule);
  // Only persist a pinned zone; an empty string is the "use host" default and
  // stays out of the file to avoid churn on projects that never set one.
  if (p.timezone) out.timezone = p.timezone;
  for (const [k, v] of Object.entries(p._extra)) out[k] = v;
  return out;
}

// -----------------------------------------------------------------------------
// ReportMeta
// -----------------------------------------------------------------------------

export interface ReportMeta {
  window: string;
  format: string;
  created_at: string; // ISO-8601 with timezone — machine-comparable (UTC)
  /** Wall-clock generation timestamp in the host's local timezone (e.g. `2026-05-13T15:30:00+08:00`). */
  generated_at: string | null;
  source_entry_ids: string[];
  language: string | null;
  _extra: JsonObject;
}

export function parseReportMeta(d: JsonObject): ReportMeta {
  for (const req of ['window', 'format', 'created_at']) {
    if (!(req in d)) throw new Error(`ReportMeta: ${JSON.stringify(req)} is required`);
  }
  const known = new Set(['window', 'format', 'source_entry_ids', 'created_at', 'generated_at', 'language']);
  const extra: JsonObject = {};
  for (const [k, v] of Object.entries(d)) {
    if (!known.has(k)) extra[k] = v;
  }
  const lang = d.language;
  const gen = d.generated_at;
  return {
    window: String(d.window),
    format: String(d.format),
    created_at: String(d.created_at),
    generated_at: gen ? String(gen) : null,
    source_entry_ids: asStringList(d.source_entry_ids),
    language: lang ? String(lang) : null,
    _extra: extra,
  };
}

export function serializeReportMeta(m: ReportMeta): JsonObject {
  const out: JsonObject = {
    window: m.window,
    format: m.format,
    source_entry_ids: [...m.source_entry_ids],
    created_at: m.created_at,
  };
  if (m.generated_at) out.generated_at = m.generated_at;
  if (m.language) out.language = m.language;
  for (const [k, v] of Object.entries(m._extra)) out[k] = v;
  return out;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function coerceStrOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function asList(v: unknown): unknown[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v;
  return [];
}

function asStringList(v: unknown): string[] {
  return asList(v).map((x) => String(x));
}
