# Validação das integrações — 2026-10-11

Escopo: Sentinela/SARIF, JS/PostgreSQL, Forgejo/Gitea e instalação Claude/Codex.
Fonte de referência: checkout local FastList, branch main,
commit `587e267de52400f7d45154b62579638d6bb537e9`, Node 24.12.0.
Não equivale a auditoria do deploy atual nem autorização de promoção.

## Blindar

15 testes aprovados, nenhum pulado:

```sh
FASTLIST_SOURCE=/caminho/fast_list node --test tests/sentinela-ingest.test.mjs tests/fastlist-regressions.test.mjs tests/install-runtime.test.mjs
```

- Exportador real do Sentinela → ingestão → SECURITY: crítico bloqueia;
  entrada inválida substitui aprovação anterior; alvo/SHA divergente rejeitado.
- Evidência vazia só passa com execução concluída, data fresca e SHA implantado;
  ausência de login confirmado não vira autenticação.
- JS/MJS/CJS e preço desestruturado; negativo com catálogo/comentário.
- Estoque read/modify/write; controles com UPDATE atômico e FOR UPDATE em tx.
- Pool compartilhado com SET search_path/fallback public; controle por schema.
- SQL interpolado/parametrizado, teste em test/ com nome isolamento.
- Forgejo/Gitea/GitHub .yaml: comando E2E presente/ausente, pipeline reconhecido.
- Instalação idempotente, CODEX_HOME, drift e preservação de arquivos pessoais.
- Contrato de mapeamento dos gates: 9 verificações aprovadas.
- SKILL.md aprovado pelo quick_validate.py; sintaxe PowerShell validada.

A suíte completa local foi interrompida na etapa Semgrep do Windows (rc=2,
sem evidência SAST). A CI Linux executa a suíte completa; consultar seu resultado
no commit publicado. Não tratar a execução local interrompida como aprovada.

## Sentinela

`npm test` aprovado: 108 tipos com mapeamento OWASP/CWE, 17 geradores de
verificação e 2 testes SARIF. Sintaxe do auditor e daemon validada. Sessão
autenticada com navegador e operador não executada nesta validação.

## FastList com PostgreSQL real

Servidor PostgreSQL 16.13 temporário, exclusivo desta validação, em loopback.
Autenticação SCRAM para os papéis criados pelos testes. Nenhum banco de
produção acessado. `FASTLIST_EXIGE_POSTGRES=1`; 8 arquivos aprovados, 86 testes
aprovados e 1 pulado: permissão POSIX do arquivo de credenciais, inaplicável no
Windows. Os testes PostgreSQL de isolamento e concorrência executaram.

```sh
node node_modules/vitest/vitest.mjs run --reporter=verbose test/isolamento-clientes.test.js test/instagram-isolamento.test.js test/estoque-integridade.test.js test/routes/estoque-corrida-balcao.test.js test/photo-pipeline-security.test.js test/capacidade-de-conexoes.test.js test/ci-actions-pinadas.test.js test/registro-lojas.test.js
```

Casos exercitados: senha exigida, separação entre clientes e catálogos de lojas,
20 ajustes concorrentes com cadeia exata de histórico, última unidade disputada
entre balcão e pedido digital, estoque negativo/fracionado recusado, troca de
pools, orçamento de conexões, SSRF/redirecionamento/limite de imagem e actions
Forgejo fixadas por SHA. Isso não comprova capacidade para 50 lojas nem CI
remota do FastList verde. O código do FastList não foi alterado.
