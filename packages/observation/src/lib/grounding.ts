/**
 * Grounding gate — a mechanical verifier for lens events, in the same spirit
 * as the forbidden-words gate: it does not trust the model's self-citation.
 *
 * The v3 re-validation showed the lenses (re)produce ungrounded events even on
 * a clean digest — quoting a proposal that lives at turn T126 under a "T85"
 * anchor, with a user "response" ~40 turns BEFORE the proposal exists. Prompt
 * tweaks can't be trusted to fix this; a gate can.
 *
 * For every event it checks, against the digest turn text:
 *   1. the AI-proposal verbatim actually appears in the transcript
 *   2. the user-response verbatim actually appears
 *   3. the proposal's real location matches the cited turn_anchor (±tolerance)
 *   4. (negative-space) the proposal precedes the response (chronology)
 *   5. (user-initiated-pivot) no AI fork preceded the user's direction (leg 1)
 *
 * Any failure → not grounded. Callers drop or flag ungrounded events.
 */

export interface TurnText {
  id: number;
  /** searchable text for this turn (text / tool_result body / tool_use input) */
  text: string;
  /** role/kind enable the pivot leg-1 check (preceding AI turn was not a fork) */
  role?: 'user' | 'assistant';
  kind?: string;
}

export interface GroundingCheck {
  name: string;
  pass: boolean;
  /** Fatal checks decide `grounded`; soft checks are reported but don't gate. */
  fatal: boolean;
  detail: string;
}

export interface GroundingResult {
  grounded: boolean;
  checks: GroundingCheck[];
}

/** Raw lens-event shape (as emitted in the JSON, pre-schema-parse). */
export interface LensEventLike {
  lens_id?: string;
  turn_anchor?: string;
  payload?: string;
}

const CITATION_TOLERANCE = 2; // block-level turn numbering can shift an anchor by a turn or two

function normalize(s: string): string {
  // Keep only letters (incl. CJK) and digits. Strips whitespace, line-wraps,
  // quote wrappers the lens adds (「」 "" '' etc.), and full-/half-width
  // punctuation differences (，vs ,) — all of which otherwise cause spurious
  // mismatches between the lens's verbatim and the source turn.
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** ALL turn ids whose text contains the snippet (normalized). */
export function locateAllSnippets(snippet: string, turns: TurnText[]): number[] {
  const n = normalize(snippet);
  if (n.length < 4) return [];
  // Probe from both ends: the lens sometimes drifts on a leading token
  // (e.g. an image marker) but the body still matches.
  const head = n.slice(0, Math.min(30, n.length));
  const tail = n.slice(-Math.min(30, n.length));
  const ids: number[] = [];
  for (const t of turns) {
    const tn = normalize(t.text);
    if (tn.includes(n) || tn.includes(head) || tn.includes(tail)) ids.push(t.id);
  }
  return ids;
}

/** id of the (first) turn whose text contains the snippet (normalized), or -1. */
export function locateSnippet(snippet: string, turns: TurnText[]): number {
  const all = locateAllSnippets(snippet, turns);
  return all.length ? all[0]! : -1;
}

function anchorRange(turnAnchor: string | undefined): [number, number] | null {
  if (!turnAnchor) return null;
  const nums = String(turnAnchor)
    .match(/\d+/g)
    ?.map(Number)
    .filter((n) => Number.isFinite(n));
  if (!nums || nums.length === 0) return null;
  return [Math.min(...nums), Math.max(...nums)];
}

interface Verbatims {
  proposal: string | null;
  response: string | null;
}

/**
 * A verbatim field runs until the NEXT payload field header — a line like
 * `\n**Stance**:` (bold text immediately followed by a colon). It must NOT stop
 * at inline bold inside the quote itself (e.g. a two-option block using
 * `**A.**` / `**B.**`), which the naive `\n**` terminator wrongly truncated
 * (pneuma-craft T479 false drop). Matches half- and full-width colons. Encoded
 * inline in each grab() pattern below as `(?=\n\*\*[^\n]+?\*\*\s*[:：]|$)`.
 */

/** Pull the proposal + response verbatim out of the lens payload, per lens. */
export function extractVerbatims(event: LensEventLike): Verbatims {
  const p = event.payload ?? '';
  const grab = (re: RegExp): string | null => {
    const m = p.match(re);
    return m && m[1] ? m[1].trim() : null;
  };
  if (event.lens_id === 'strict-negative-space') {
    return {
      proposal: grab(/Event \(AI proposal[^)]*\)\*\*:\s*([\s\S]*?)(?=\n\*\*[^\n]+?\*\*\s*[:：]|$)/),
      response: grab(/Event \(user response[^)]*\)\*\*:\s*([\s\S]*?)(?=\n\*\*[^\n]+?\*\*\s*[:：]|$)/),
    };
  }
  if (event.lens_id === 'user-initiated-pivot') {
    // The integrity-critical claim is the user's direction (turn_anchor points
    // at it). "proposal" here = that user-direction verbatim; "response" = the
    // preceding AI turn (soft, used only for response_found reporting).
    return {
      proposal: grab(/Event \(user direction[^)]*\)\*\*:\s*([\s\S]*?)(?=\n\*\*[^\n]+?\*\*\s*[:：]|$)/),
      response: grab(/Event \(preceding AI turn[^)]*\)\*\*:\s*([\s\S]*?)(?=\n\*\*[^\n]+?\*\*\s*[:：]|$)/),
    };
  }
  // anchored-deferral
  return {
    proposal: grab(/Anchor verbatim\*\*:\s*([\s\S]*?)(?=\n\*\*[^\n]+?\*\*\s*[:：]|$)/),
    response: grab(/User response verbatim\*\*:\s*([\s\S]*?)(?=\n\*\*[^\n]+?\*\*\s*[:：]|$)/),
  };
}

export function checkEventGrounding(event: LensEventLike, turns: TurnText[]): GroundingResult {
  const checks: GroundingCheck[] = [];
  const { proposal, response } = extractVerbatims(event);
  const range = anchorRange(event.turn_anchor);

  // A verbatim can recur across turns (the AI repeats a plan / patch list).
  // Pick the occurrence nearest the cited anchor so a far-away earlier copy
  // doesn't trigger a spurious citation failure (multi-occurrence false-kill).
  const propTurns = proposal ? locateAllSnippets(proposal, turns) : [];
  let propTurn = propTurns.length ? propTurns[0]! : -1;
  if (range && propTurns.length) {
    const inRange = propTurns.find((id) => id >= range[0] - CITATION_TOLERANCE && id <= range[1] + CITATION_TOLERANCE);
    if (inRange !== undefined) propTurn = inRange;
    else propTurn = propTurns.reduce((best, id) => (Math.abs(id - range[0]) < Math.abs(best - range[0]) ? id : best), propTurns[0]!);
  }
  const respTurn = response ? locateSnippet(response, turns) : -1;

  // The AI-proposal verbatim is the integrity-critical claim ("the AI proposed
  // X") — must be locatable. Fatal.
  checks.push({
    name: 'proposal_found',
    pass: propTurn >= 0,
    fatal: true,
    detail: proposal ? `proposal verbatim at T${propTurn}` : 'no proposal verbatim in payload',
  });
  // The user response can be an image / an action / terse — soft check (a real
  // event with an image-bearing reply must not be falsely killed).
  checks.push({
    name: 'response_found',
    pass: respTurn >= 0,
    fatal: false,
    detail: response ? `response verbatim at T${respTurn}` : 'no response verbatim in payload',
  });

  // citation accuracy: where the proposal REALLY is must match the cited anchor. Fatal.
  let citationPass = true;
  let citationDetail = 'skipped (proposal not found or no anchor range)';
  if (propTurn >= 0 && range) {
    citationPass = propTurn >= range[0] - CITATION_TOLERANCE && propTurn <= range[1] + CITATION_TOLERANCE;
    citationDetail = `proposal at T${propTurn}, cited anchor ${event.turn_anchor}`;
  }
  checks.push({ name: 'citation_accurate', pass: citationPass, fatal: true, detail: citationDetail });

  // leg-1 (user-initiated-pivot only): no AI fork may precede the user's
  // direction — a fork means the moment belongs to anchored-deferral. Checked
  // mechanically against the transcript, independent of the deferral run.
  if (event.lens_id === 'user-initiated-pivot') {
    const userTurn = propTurn >= 0 ? propTurn : range ? range[0] : -1;
    const fork = userTurn >= 0 ? precedingAiHasFork(userTurn, turns) : null;
    checks.push({
      name: 'no_preceding_fork',
      pass: fork !== true, // fail only when a fork is positively detected
      fatal: fork !== null, // undetermined (no role info) → don't gate
      detail:
        fork === true
          ? 'preceding AI turn exposed a decision point (belongs to anchored-deferral)'
          : fork === null
            ? 'skipped (no role info in turns)'
            : 'no preceding AI fork',
    });
  }

  // chronology (negative-space only): proposal must precede the response. Fatal
  // when both turns are located.
  if (event.lens_id === 'strict-negative-space') {
    let chronoPass = true;
    let chronoDetail = 'skipped (turn not located)';
    if (propTurn >= 0 && respTurn >= 0) {
      chronoPass = propTurn < respTurn;
      chronoDetail = `proposal T${propTurn} ${chronoPass ? '<' : '>='} response T${respTurn}`;
    }
    checks.push({ name: 'chronology', pass: chronoPass, fatal: true, detail: chronoDetail });
  }

  return { grounded: checks.filter((c) => c.fatal).every((c) => c.pass), checks };
}

/** Build the searchable turn list from a DigestResult.turns array. */
export function turnsFromDigest(
  digestTurns: { id: number; text?: string; toolInput?: string; role?: 'user' | 'assistant'; kind?: string }[],
): TurnText[] {
  return digestTurns.map((t) => ({
    id: t.id,
    text: t.text ?? t.toolInput ?? '',
    role: t.role,
    kind: t.kind,
  }));
}

/**
 * Does the AI turn(s) since the user's previous message expose a decision point
 * (a "fork": direct question / ≥2 named options / explicit uncertainty)?
 *
 * Mechanical leg-1 enforcement for user-initiated-pivot: a real pivot requires
 * NO AI fork in front of it. This is independent of the deferral run (the
 * earlier compose-only guard could miss a fork that deferral happened not to
 * anchor). Returns null when role info is unavailable (can't determine → don't gate).
 */
export function precedingAiHasFork(userTurnId: number, turns: TurnText[]): boolean | null {
  if (!turns.some((t) => t.role)) return null; // no role info — cannot determine
  let prevUser = 0;
  for (const t of turns) {
    if (t.role === 'user' && (t.kind === undefined || t.kind === 'text') && t.id < userTurnId && t.id > prevUser) {
      prevUser = t.id;
    }
  }
  for (const t of turns) {
    if (
      t.role === 'assistant' &&
      t.id > prevUser &&
      t.id < userTurnId &&
      (t.kind === undefined || t.kind === 'text' || t.kind === 'tool_use') &&
      isForkText(t.text)
    ) {
      return true;
    }
  }
  return false;
}

/** High-precision markers that an AI turn asked the user to make a decision. */
export function isForkText(text: string): boolean {
  const t = text;
  if (/还是[^。\n]{0,12}[?？]/.test(t)) return true; // "A 还是 B?"
  if (/要不要|你想怎|你想要|你想用|你希望|你来定|你决定|你想先|你倾向|怎么选|你选(哪|什么)?/.test(t)) return true;
  if (/(两|三|四|2|3|4)\s*个[^\n。]{0,10}(可选|选择|方案|方向|选项)/.test(t)) return true;
  if (/\b(which (one|approach|option)|should we|do you (want|prefer)|would you (like|prefer)|your call|up to you)\b/i.test(t)) return true;
  if (/不确定|not sure|either way|it depends|两可|看你的?|由你(来)?定/i.test(t)) return true;
  if (/[（(][aA][)）][\s\S]{0,400}[（(][bB][)）]/.test(t)) return true; // (a) ... (b)
  if (/(^|\n)\s*1[.、)][\s\S]{0,400}(^|\n)\s*2[.、)]/.test(t)) return true; // 1. ... 2.
  if (/(^|\n)Q:\s/.test(t) && (t.match(/(^|\n)\s*-\s/g) || []).length >= 2) return true; // AskUserQuestion render
  return false;
}
