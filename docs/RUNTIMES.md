# Claude e Codex

O núcleo de scripts, checks, schemas e playbooks é o mesmo. O assistente sabe
qual runtime está usando pelo contexto e ferramentas disponíveis; não pelo
modelo responder que é Claude ou Codex. A instalação apenas escolhe destinos.

```sh
node scripts/install-runtime.mjs --runtime both
node scripts/install-runtime.mjs --runtime codex --check
```

`auto` instala nos diretórios de configuração existentes. Se os dois existem,
atualiza os dois. Sem diretório existente, exige escolha explícita. Respeita
`CODEX_HOME` e `CLAUDE_CONFIG_DIR`; os defaults são `~/.codex` e `~/.claude`.
`--source` seleciona checkout local. A instalação preserva estado de runtime e
arquivos do usuário, registra hashes e recusa sobrescrever checkout Git/link.
O instalador registra a pasta irmã `Sentinela` se encontrada; pode selecionar
outra com `--sentinela-dir`. A ponte lê esse registro local e respeita
`SENTINELA_DIR` como override. Nenhum segredo é salvo nesse registro.

No Codex, invoque `$blindar`. No Claude, invoque a skill `blindar`. Reinicie a
sessão se o catálogo de skills já tiver sido carregado. Use a pasta que contém
este SKILL.md como `BLINDAR_SKILL_ROOT`, sem hardcode de `~/.claude`.

Adapte ferramentas, não critérios de aprovação: shell → terminal disponível;
subagentes → mecanismo nativo se permitido, limitado às vagas disponíveis.
Sem delegação permitida, execute playbooks em sequência e registre a limitação.
Nunca invente Workflow API, paralelismo, execução ou revisão independente.
Não altere hooks/permissões/configuração de outro runtime automaticamente.

## Sentinela

1. Execute `status --json` antes de iniciar outra sessão; login é do operador.
2. Informe `SENTINELA_GIT_SHA` com o SHA completo realmente implantado no alvo.
   Não use o HEAD local como se fosse prova da identidade remota.
3. Termine a sessão e obtenha `reports.sarif` com `report --json`.
4. No projeto auditado:

```sh
bash "$BLINDAR_SKILL_ROOT/scripts/sentinela-bridge.sh" --ingest relatorio.sarif --url https://homolog.example/ --git-sha SHA_COMPLETO
bash "$BLINDAR_SKILL_ROOT/templates/checks/check-release-gates.sh"
```

O resultado canônico é `.blindar/results/check-sentinela.json`, gate SECURITY.
SARIF inválido gera `errored`, substitui resultado anterior e bloqueia o gate.
Sem data fresca (24h), SHA implantado ou execução concluída: não conta como
runtime exercitado. Achados críticos/altos continuam visíveis. `authenticated`
é separado; ausência de confirmação de login nunca vira sessão autenticada.
Importe após os checks estáticos e recalcule os gates antes de emitir veredito;
o run-report do orquestrador descreve sua execução, não importações posteriores.

## Forgejo e FastList

Workflows `.forgejo/workflows`, `.gitea/workflows` e `.github/workflows`, em
`.yml` ou `.yaml`, são configuração estática. Não comprovam job verde, merge,
homologação nem promoção. Verifique a execução remota no SHA e todos os jobs
obrigatórios antes de afirmar CI verde. Não exige GitHub Actions num projeto
que já usa Forgejo.

Os checks JS/PostgreSQL reconhecem schema por loja, `search_path`, SQL direto,
estoque read/modify/write e testes em `test/`, inclusive nomes `isolamento`.
São heurísticas estáticas, não análise completa de fluxo nem prova de ausência
de SQLi. Entradas monetárias são triagem `med`: podem ser legítimas
em cadastro/financeiro e não viram `crit` sem prova do fluxo e da autorização.
Comentários preservam linhas para apontar a evidência no arquivo original.
Atomicidade/isolamento precisam de testes com PostgreSQL real. Testes
pulados por falta de banco e falhas de infraestrutura não provam segurança.
Os casos locais FastList de referência estão nos testes `fastlist-regressions`.
