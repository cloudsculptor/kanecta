#!/usr/bin/env bash
#
# Source-language guard for Kanecta.
#
#   * TypeScript only — no NEW .js / .cjs / .mjs source.
#   * SCSS only        — no NEW .css source.
#
# Existing files are grandfathered in scripts/allowed-js.txt and
# scripts/allowed-css.txt (migration ratchets). Any tracked file of a banned
# extension that is NOT in its allowlist fails this check. As files are migrated
# to .ts / .scss, delete their lines from the allowlists; the goal is zero.
#
# Run by the pre-commit hook and in CI. Exits non-zero on any violation.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# kanecta-app-community-hub is a LIVE PRODUCTION app with its own stack and release
# process — it is excluded from the TypeScript/SCSS migration and from this gate.
# Any change to it is change-controlled and authorised separately (do not touch it
# in repo-wide sweeps).
EXCLUDE='^(node_modules/|kanecta-ui/kanecta-apps/kanecta-app-community-hub/)'

fail=0

check() {
  local label="$1" allow="$2"; shift 2
  local current_f allowed_f new
  current_f="$(mktemp)"; allowed_f="$(mktemp)"
  # `|| true`: once a file-kind reaches zero non-excluded files, grep matches
  # nothing and exits 1, which would kill the script under `set -o pipefail`.
  git ls-files "$@" | { grep -vE "$EXCLUDE" || true; } | LC_ALL=C sort -u > "$current_f"
  { grep -vE '^[[:space:]]*(#|$)' "$allow" || true; } | LC_ALL=C sort -u > "$allowed_f"

  # New = tracked files of this kind not present in the allowlist.
  new="$(LC_ALL=C comm -23 "$current_f" "$allowed_f")"
  rm -f "$current_f" "$allowed_f"

  if [ -n "$new" ]; then
    fail=1
    echo "✗ ${label}: new file(s) are not allowed — Kanecta is TypeScript-/SCSS-only:"
    printf '    %s\n' $new
    echo "    → write the equivalent .ts/.tsx (or .scss) instead. If a file is genuinely"
    echo "      unavoidable, add its path to ${allow} with a comment explaining why."
    echo
  fi
}

check "TypeScript (no new JS)" scripts/allowed-js.txt '*.js' '*.cjs' '*.mjs'
check "SCSS (no new CSS)"      scripts/allowed-css.txt '*.css'

if [ "$fail" -ne 0 ]; then
  echo "Source-language check FAILED. New JavaScript/CSS is not permitted."
  exit 1
fi

js_left="$({ grep -vE '^[[:space:]]*(#|$)' scripts/allowed-js.txt || true; } | wc -l | tr -d ' ')"
css_left="$({ grep -vE '^[[:space:]]*(#|$)' scripts/allowed-css.txt || true; } | wc -l | tr -d ' ')"
echo "✓ source-language check passed — no new JS/CSS."
echo "  (${js_left} .js and ${css_left} .css files grandfathered, awaiting migration to TS/SCSS.)"
