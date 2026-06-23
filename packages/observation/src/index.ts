/**
 * @code-journal/observation — observation lens layer
 *
 * Three-layer architecture (see docs/archive/plans/mvp-ii.md):
 *
 *   Detection (continuous, system-internal)
 *      ↓ appends events
 *   Signal Store (append-only, growing)
 *      ↓ reads at compose-time
 *   Audit (episodic, frozen, user-facing)
 *
 * The lens itself is agent-agnostic (validated on claude-code + codex
 * transcripts in Phase 2 E4). The runtime layer dispatches isolated
 * subagents via `claude -p` (same pattern as packages/app's narrate.ts);
 * cost stays at zero marginal — no API key, no account.
 *
 * Hard rules carried forward from Phase 1 + 2 experiments:
 *   - Events are append-only; payloads are never modified post-write
 *   - Episodes are immutable once composed (new period → new episode)
 *   - Fate updates are append-only on prior events; original payloads
 *     are never rewritten
 *   - No system-side meta-pattern declarations (framework § 11.4)
 *   - No haiku in production (Phase 2 E1: ~50% recall)
 *   - Source-anchored or skip (framework § 7)
 */

export const VERSION = '0.1.0';

export * from './lib/schema';
export * from './lib/paths';
export * from './lib/digest';
export * from './lib/digest-codex';
export * from './lib/store';
export * from './lib/state';
export * from './lib/lens-runner';
export * from './lib/grounding';
export * from './lib/compose';
export * from './lib/fate-runner';
export * from './lib/language';
