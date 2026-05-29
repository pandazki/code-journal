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
 *
 * Any failure → not grounded. Callers drop or flag ungrounded events.
 */

export interface TurnText {
  id: number;
  /** searchable text for this turn (text / tool_result body / tool_use input) */
  text: string;
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

/** id of the turn whose text contains the snippet (normalized), or -1. */
export function locateSnippet(snippet: string, turns: TurnText[]): number {
  const n = normalize(snippet);
  if (n.length < 4) return -1;
  // Probe from both ends: the lens sometimes drifts on a leading token
  // (e.g. an image marker) but the body still matches.
  const head = n.slice(0, Math.min(30, n.length));
  const tail = n.slice(-Math.min(30, n.length));
  for (const t of turns) {
    const tn = normalize(t.text);
    if (tn.includes(n) || tn.includes(head) || tn.includes(tail)) return t.id;
  }
  return -1;
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

/** Pull the proposal + response verbatim out of the lens payload, per lens. */
export function extractVerbatims(event: LensEventLike): Verbatims {
  const p = event.payload ?? '';
  const grab = (re: RegExp): string | null => {
    const m = p.match(re);
    return m && m[1] ? m[1].trim() : null;
  };
  if (event.lens_id === 'strict-negative-space') {
    return {
      proposal: grab(/Event \(AI proposal[^)]*\)\*\*:\s*([\s\S]*?)(?:\n\*\*|$)/),
      response: grab(/Event \(user response[^)]*\)\*\*:\s*([\s\S]*?)(?:\n\*\*|$)/),
    };
  }
  // anchored-deferral
  return {
    proposal: grab(/Anchor verbatim\*\*:\s*([\s\S]*?)(?:\n\*\*|$)/),
    response: grab(/User response verbatim\*\*:\s*([\s\S]*?)(?:\n\*\*|$)/),
  };
}

export function checkEventGrounding(event: LensEventLike, turns: TurnText[]): GroundingResult {
  const checks: GroundingCheck[] = [];
  const { proposal, response } = extractVerbatims(event);
  const range = anchorRange(event.turn_anchor);

  const propTurn = proposal ? locateSnippet(proposal, turns) : -1;
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
  digestTurns: { id: number; text?: string; toolInput?: string }[],
): TurnText[] {
  return digestTurns.map((t) => ({ id: t.id, text: t.text ?? t.toolInput ?? '' }));
}
