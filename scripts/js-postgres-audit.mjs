#!/usr/bin/env node
// Heurísticas estáticas conservadoras: estrutura presente nunca prova concorrência/isolamento.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ignored = new Set(['.git', 'node_modules', '.blindar', 'coverage', 'dist', 'build', '.next', '.nuxt']);
export function inspectProject(root = process.cwd()) {
  const sources = [], isolationTests = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink() || ignored.has(e.name) || e.name.startsWith('.blindar.')) continue;
      const file = path.join(dir, e.name), rel = path.relative(root, file).replaceAll('\\', '/');
      if (e.isDirectory()) { walk(file); continue; }
      if (/(?:^|\/)(?:test|tests|__tests__|e2e)\//.test(rel) && /(?:tenant.*iso|iso.*tenant|cross[-_.]?tenant|isolamento|multi[-_.]?(?:loja|tenant)).*\.(?:[cm]?[jt]sx?|py)$/i.test(e.name)) isolationTests.push(rel);
      if (!/\.(?:[cm]?[jt]sx?|py|sql|prisma)$/.test(e.name) || /(?:^|\/)(?:test|tests|__tests__|e2e)\//.test(rel) || /\.(?:test|spec)\./.test(e.name)) continue;
      if (fs.statSync(file).size > 2 * 1024 * 1024) continue;
      const raw = fs.readFileSync(file, 'utf8');
      // Evita que documentação em comentários satisfaça guardas ou gere achados.
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/^\s*(?:\/\/|#).*$/gm, '');
      sources.push({ file: rel, code });
    }
  }
  walk(root);
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { /* non-Node */ }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const all = sources.map(s => s.code).join('\n');
  return { sources, isolationTests, postgres: !!deps.pg || /\b(?:search_path|FOR UPDATE|pg\.Pool)\b/i.test(all),
    schemaTenancy: /\bsearch_path\b/i.test(all), multiTenant: /\b(?:tenantId|tenant_id|organization_id|organizationId|search_path|porLoja)\b/.test(all) };
}
export function auditProject(root, mode) {
  const project = inspectProject(root), findings = [];
  if (mode === 'tenant-tests' && project.multiTenant && !project.isolationTests.length)
    findings.push({ severity: 'high', message: 'Multi-tenant sem arquivo de teste de isolamento. Presença de arquivo é evidência estática; executar com PostgreSQL real continua obrigatório.', file: 'test/', line: '' });
  function add(severity, message, file, code, offset) {
    findings.push({ severity, message, file, line: String(code.slice(0, offset).split('\n').length) });
  }
  for (const { file, code } of project.sources) {
    if (mode === 'business') {
      for (const m of code.matchAll(/\b(?:amount|price|total|discount|preco|preço|desconto)\s*=\s*(?:(?:Number|parseFloat|parseInt)\s*\(\s*)?req\.(?:body|query|params)\.[\w]+/g))
        add('crit', 'Preço/desconto recebido diretamente do cliente: derive do catálogo e regras no servidor; revisar fluxo até a persistência.', file, code, m.index);
      for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.(?:body|query|params)/g))
        if (/\b(?:amount|price|total|discount|preco|preço|desconto)\b/.test(m[1]))
          add('crit', 'Preço/desconto desestruturado da requisição: revisar validação contra catálogo e regras do servidor.', file, code, m.index);
      if (project.postgres) {
        for (const m of code.matchAll(/\bSELECT\b[^;`]{0,350}\b(?:stock|estoque|quantidade)\b[^;`]{0,350}(?:;|`)[\s\S]{0,600}?\bUPDATE\b[^;`]{0,250}\b(?:stock|estoque|quantidade)\s*=\s*(?:\$\d+|\?)/gi)) {
          const context = code.slice(Math.max(0, m.index - 300), m.index + m[0].length);
          if (!/FOR UPDATE|\.tx\s*\(|\$transaction\s*\(|\bBEGIN\b/i.test(context))
            add('high', 'PostgreSQL: leitura e regravação de estoque sem trava/transação próxima. Revisar lost update e testar concorrência com banco real.', file, code, m.index);
        }
      }
    }
    if (mode === 'tenant' && project.multiTenant) {
      for (const m of code.matchAll(/\bpool\.query\s*\(\s*[`"']\s*SET\s+(?!LOCAL\b)search_path\b/gi))
        add('high', 'SET search_path em pool compartilhado pode vazar contexto entre lojas. Fixe no startup de pool por schema ou SET LOCAL em transação dedicada.', file, code, m.index);
      for (const m of code.matchAll(/\bsearch_path\s*(?:TO|=)[^\n;`]{0,160},\s*public\b/gi))
        add('high', 'search_path com fallback public: tabela ausente pode resolver para outra loja. Separe consultas globais explicitamente.', file, code, m.index);
      for (const m of code.matchAll(/\b(?:query|exec|run)\s*\(\s*`[^`]{0,700}\$\{\s*req\.(?:body|params|query)\.[^}]+\}[^`]*`/g))
        add('crit', 'SQL/identificador interpolado diretamente da requisição. Parametrize valores e valide identificadores com allowlist.', file, code, m.index);
    }
  }
  return { ...project, sources: undefined, findings };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  const result = auditProject(process.cwd(), mode);
  if (mode === 'metadata') console.log(JSON.stringify(result));
  else for (const f of result.findings) console.log([f.severity, f.message, f.file, f.line].map(s => String(s).replace(/[\t\r\n]/g, ' ')).join('\t'));
}
