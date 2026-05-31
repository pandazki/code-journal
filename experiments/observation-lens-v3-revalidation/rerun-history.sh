#!/usr/bin/env bash
# Re-run the observation pipeline over existing history with the CURRENT lenses
# (3 lenses, assented stance, grounding gate, analysis language).
#
# Why a reset: `sync` dedups already-scanned sessions and won't recompose
# existing episodes, so old audits would stick around. This backs up the old
# observation data, clears scan state, then re-syncs + re-composes.
#
# Language: reset PRESERVES each project's analysis_language config by default —
# so if you pinned a language in the web console's Settings, the rerun keeps it.
# Pass --redetect to instead re-enable auto-detection from your user turns.
#
# MUST be run in a real terminal — the lenses shell out to `claude -p`, which
# needs a TTY (it cannot run nested inside a Claude Code session).
#
# Usage:
#   rerun-history.sh [-n LIMIT] [--no-reset] [--redetect] [project ...]
#
#     -n LIMIT     scan at most LIMIT most-recent sessions per project
#                  (default: 20). Each session = 3 `claude -p` calls.
#     --no-reset   don't back up / wipe; sync + compose on top of existing state.
#     --redetect   on reset, re-enable language auto-detection (overrides a pin).
#     project ...  project ids (dir names under ~/.code-journal/observations/).
#                  Default: code-journal-7yyrpu.
#
# Examples:
#   rerun-history.sh                       # code-journal, 20 sessions, keep pinned lang
#   rerun-history.sh -n 40                 # deeper history
#   rerun-history.sh -n 10 tanka-work-memory-plugin-5lpzra
#   rerun-history.sh --redetect -n 20      # let it auto-detect language again
set -euo pipefail

ROOT="$HOME/.code-journal/observations"
CLI="node $(cd "$(dirname "$0")/../.." && pwd)/packages/cli/dist/index.js"

LIMIT="20"          # default: a long-ish run
RESET=1
REDETECT=0
PROJECTS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    -n|--limit) LIMIT="$2"; shift 2 ;;
    -n*)        LIMIT="${1#-n}"; shift ;;          # allow -n5
    --no-reset) RESET=0; shift ;;
    --redetect) REDETECT=1; shift ;;
    -h|--help)  sed -n '2,30p' "$0"; exit 0 ;;
    -*)         echo "unknown option: $1" >&2; exit 2 ;;
    *)          PROJECTS+=("$1"); shift ;;
  esac
done

if [ -n "$LIMIT" ] && ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "error: -n LIMIT must be a positive integer (got '$LIMIT')" >&2
  exit 2
fi

# Default project: code-journal itself.
if [ "${#PROJECTS[@]}" -eq 0 ]; then
  PROJECTS=("code-journal-7yyrpu")
fi

LIMIT_ARGS=()
[ -n "$LIMIT" ] && LIMIT_ARGS=(--limit "$LIMIT")

echo "Projects:"; printf '  %s\n' "${PROJECTS[@]}"
echo "Limit: ${LIMIT:-all}   Reset: $([ "$RESET" = 1 ] && echo yes || echo no)   Language: $([ "$REDETECT" = 1 ] && echo re-detect || echo keep-config)"
echo

if [ "$RESET" = 1 ]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BACKUP="$HOME/.code-journal/observations-backup-$STAMP"
  echo "Backing up → $BACKUP"
  mkdir -p "$BACKUP"
  for p in "${PROJECTS[@]}"; do [ -d "$ROOT/$p" ] && cp -R "$ROOT/$p" "$BACKUP/$p"; done
  echo "  done."; echo

  for p in "${PROJECTS[@]}"; do
    d="$ROOT/$p"
    [ -d "$d" ] || { echo "[$p] no such project dir — skipping reset"; continue; }
    echo "[$p] resetting episodes / signals / digests / scan state…"
    rm -f "$d/episodes/"*.md "$d/episodes/"*.json "$d/signals/"*.jsonl "$d/digests/"*.md 2>/dev/null || true
    REDETECT="$REDETECT" node -e '
      const fs=require("fs"); const f=process.argv[1];
      if(!fs.existsSync(f)) process.exit(0);
      const s=JSON.parse(fs.readFileSync(f,"utf8"));
      s.last_scan={at:"",sessions_scanned:[],_extra:(s.last_scan&&s.last_scan._extra)||{}};
      s.episodes=[]; s.next_episode_number=1; s.new_events_since_last_compose=0;
      // Preserve analysis_language / pin by default; only re-enable auto if asked.
      if(s.config && process.env.REDETECT==="1") s.config.analysis_language_auto=true;
      fs.writeFileSync(f, JSON.stringify(s,null,2)+"\n");
    ' "$d/state.json"
    node -e '
      const s=require(process.argv[1]);
      console.log("  language="+s.config.analysis_language+" (auto="+s.config.analysis_language_auto+")");
    ' "$d/state.json"
  done
  echo
fi

for p in "${PROJECTS[@]}"; do
  echo "=============================================================="
  echo "[$p] sync ${LIMIT:+(limit $LIMIT)}"
  echo "=============================================================="
  $CLI sync --project "$p" "${LIMIT_ARGS[@]}" --verbose || echo "  (sync non-zero — some sessions may have failed; continuing)"
  echo
  echo "[$p] compose"
  $CLI compose --project "$p" || echo "  (compose skipped — no events?)"
  echo
done

echo "Done. Open the console:  node packages/app/dist/main.js   →  /observe"
[ "$RESET" = 1 ] && echo "Restore:  rm -rf $ROOT/<project> && mv $BACKUP/<project> $ROOT/"
