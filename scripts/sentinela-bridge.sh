#!/usr/bin/env bash
# Ponte Blindar/Sentinela. Ingestão explícita; nunca escolhe relatório de outro alvo.
# --check | --url URL [--run] | --ingest arquivo.sarif --url URL [--git-sha SHA]
set -uo pipefail
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BLINDAR_DIR="${BLINDAR_DIR:-.blindar}"
MODE=check; URL=""; SARIF=""; SHA=""; RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check; shift ;;
    --url|--git-sha|--ingest)
      [ $# -ge 2 ] && [ -n "$2" ] && [[ "$2" != --* ]] || { echo "Falta valor: $1" >&2; exit 64; }
      case "$1" in --url) URL="$2" ;; --git-sha) SHA="$2" ;; --ingest) MODE=ingest; SARIF="$2" ;; esac
      shift 2 ;;
    --run) RUN=1; shift ;;
    -h|--help) sed -n '2,3p' "$0"; exit 0 ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 64 ;;
  esac
done
command -v node >/dev/null 2>&1 || { echo "Node obrigatório" >&2; exit 3; }
if [ "$MODE" = ingest ]; then
  ARGS=("$SARIF" --out "$BLINDAR_DIR/results/check-sentinela.json")
  [ -n "$URL" ] && ARGS+=(--target "$URL")
  [ -n "$SHA" ] && ARGS+=(--git-sha "$SHA")
  node "$SKILL_DIR/scripts/sentinela-ingest.mjs" "${ARGS[@]}"
  exit $?
fi
SENT=""
CONFIG_SENT=$(node -e 'try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).integrations?.sentinela_dir || ""); } catch {}' "$SKILL_DIR/.blindar-install.json")
for d in "${SENTINELA_DIR:-}" "$CONFIG_SENT" "${CODEX_HOME:-$HOME/.codex}/skills/sentinela" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/sentinela" "$SKILL_DIR/../Sentinela" "../Sentinela"; do
  if command -v cygpath >/dev/null 2>&1 && [ -n "$d" ]; then d=$(cygpath -u "$d"); fi
  [ -n "$d" ] && [ -f "$d/sentinela.mjs" ] && { SENT="$(cd "$d" && pwd)"; break; }
done
[ -n "$SENT" ] || { echo "Sentinela ausente: configure SENTINELA_DIR. Nenhum runtime foi verificado." >&2; exit 3; }
echo "Sentinela: $SENT"
if [ -n "$URL" ]; then
  # Consulta sessão antes de iniciar. Uma sessão existente exige escolha do operador.
  node "$SENT/sentinela.mjs" status --json
  if [ "$RUN" -eq 1 ]; then
    (cd "$SENT" && node sentinela.mjs start "$URL" --on-orphan=fail)
    exit $?
  fi
  echo "Para iniciar: node \"$SENT/sentinela.mjs\" start \"$URL\" --on-orphan=fail"
fi
echo "Após a sessão: node \"$SENT/sentinela.mjs\" report --json"
echo "Importe o caminho SARIF retornado com --ingest arquivo.sarif --url URL --git-sha SHA_IMPLANTADO."
