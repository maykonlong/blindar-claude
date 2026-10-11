# Workflow configuration discovery only. A file is not evidence of a successful run.
ci_workflows() {
  local wf
  for wf in .github/workflows/*.yml .github/workflows/*.yaml .forgejo/workflows/*.yml .forgejo/workflows/*.yaml .gitea/workflows/*.yml .gitea/workflows/*.yaml; do
    [ -f "$wf" ] && printf '%s\n' "$wf"
  done
  return 0
}
ci_has() {
  local wf
  while IFS= read -r wf; do
    grep -vE '^[[:space:]]*#' "$wf" | grep -qiE "$1" && return 0
  done < <(ci_workflows)
  return 1
}
