# Shared JS/PostgreSQL scanner. Also installed beside checks in project-local layout.
_JS_PG="$(dirname "$0")/../../scripts/js-postgres-audit.mjs"
[ -f "$_JS_PG" ] || _JS_PG="$(dirname "$0")/js-postgres-audit.mjs"
js_pg_findings() {
  command -v node >/dev/null 2>&1 && [ -f "$_JS_PG" ] || return 1
  local tmp sev msg file line
  tmp=$(mktemp)
  if ! node "$_JS_PG" "$1" > "$tmp"; then rm -f "$tmp"; return 1; fi
  while IFS=$'\t' read -r sev msg file line; do
    [ -n "$sev" ] && add_finding "$sev" "$msg" "$file" "$line"
  done < "$tmp"
  rm -f "$tmp"
}
