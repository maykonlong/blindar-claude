#!/usr/bin/env bash
BLINDAR_AGENT="check-tenant-isolation-tests"
source "$(dirname "$0")/_lib.sh"
source "$(dirname "$0")/_js-postgres.sh"
log_section "Check: tenant-isolation-tests (JS/TS/Python/PostgreSQL)"
if ! command -v node >/dev/null 2>&1 || [ ! -f "$_JS_PG" ]; then
  BLINDAR_MISSING_TOOL="node/js-postgres scanner"
  emit_result "$BLINDAR_AGENT" "skipped" 0; exit 0
fi
META=$(node "$_JS_PG" metadata) || { emit_result "$BLINDAR_AGENT" "errored" 2; exit 2; }
if ! printf '%s' "$META" | grep -q '"multiTenant":true'; then
  emit_result "$BLINDAR_AGENT" "skipped" 0; exit 0
fi
js_pg_findings tenant-tests || { emit_result "$BLINDAR_AGENT" "errored" 2; exit 2; }
if [ "${#FINDINGS[@]}" -gt 0 ]; then emit_result "$BLINDAR_AGENT" "failed" 1; exit 1; fi
log_info "Arquivos de teste encontrados. Evidência estática; não comprova execução nem PostgreSQL real."
emit_result "$BLINDAR_AGENT" "passed" 0
