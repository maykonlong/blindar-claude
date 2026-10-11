#!/usr/bin/env bash
# Shared installer. --runtime auto|claude|codex|both; --source LOCAL; --check.
set -euo pipefail
command -v node >/dev/null || { echo "Node obrigatório" >&2; exit 70; }
RUNTIME=auto; SOURCE=""; CHECK=0; TMP_SOURCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --runtime|--source)
      [ $# -ge 2 ] || exit 64
      case "$1" in --runtime) RUNTIME="$2" ;; --source) SOURCE="$2" ;; esac
      shift 2 ;;
    --check) CHECK=1; shift ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 64 ;;
  esac
done
if [ -z "$SOURCE" ] && [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/../SKILL.md" ]; then
  SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
if [ -z "$SOURCE" ]; then
  TMP_SOURCE="$(mktemp -d)"
  trap '[ -z "$TMP_SOURCE" ] || rm -rf -- "$TMP_SOURCE"' EXIT
  git clone --branch "${BLINDAR_BRANCH:-main}" --depth 1 "https://github.com/${BLINDAR_REPO:-maykonlong/blindar-claude}.git" "$TMP_SOURCE"
  SOURCE="$TMP_SOURCE"
fi
ARGS=(--source "$SOURCE" --runtime "$RUNTIME")
[ "$CHECK" -eq 0 ] || ARGS+=(--check)
node "$SOURCE/scripts/install-runtime.mjs" "${ARGS[@]}"
