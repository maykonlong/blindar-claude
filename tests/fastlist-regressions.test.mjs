import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { auditProject, inspectProject } from '../scripts/js-postgres-audit.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function fixture(files, run) {
  const dir = mkdtempSync(join(tmpdir(), 'blindar-fastlist-'));
  try { for (const [name, content] of Object.entries(files)) { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), content); } return run(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
function check(dir, name) {
  const p = spawnSync('bash', [join(root, 'templates/checks', name + '.sh')], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.ok([0, 1].includes(p.status), p.stdout + p.stderr);
  return JSON.parse(readFileSync(join(dir, '.blindar/results', name + '.json'), 'utf8'));
}
test('JS/MJS/CJS: preço de requisição dispara e preço do catálogo não', () => {
  for (const ext of ['js', 'mjs', 'cjs']) fixture({ ['server.' + ext]: 'const price = Number(req.body.price);' }, dir => {
    assert.equal(check(dir, 'check-business-logic').severities.crit, 1);
    writeFileSync(join(dir, 'server.' + ext), 'const price = catalogo.preco;');
    assert.equal(check(dir, 'check-business-logic').findings_count, 0);
  });
});
test('MAI-03: estoque read/modify/write dispara; UPDATE atômico e trava em tx não', () => {
  fixture({ 'package.json': '{"dependencies":{"pg":"*"}}', 'stock.js': 'const row = await db.get(`SELECT estoque FROM produtos WHERE id = ?`, [id]); await db.run(`UPDATE produtos SET estoque = ? WHERE id = ?`, [row.estoque + delta, id]);' }, dir => {
    assert.equal(auditProject(dir, 'business').findings[0].severity, 'high');
    writeFileSync(join(dir, 'stock.js'), 'await db.run(`UPDATE produtos SET estoque = estoque + ? WHERE id = ? RETURNING estoque`, [delta,id]);');
    assert.equal(auditProject(dir, 'business').findings.length, 0);
    writeFileSync(join(dir, 'stock.js'), 'await db.tx(async db => { const row = await db.get(`SELECT estoque FROM produtos WHERE id = ? FOR UPDATE`, [id]); await db.run(`UPDATE produtos SET estoque = ? WHERE id = ?`, [novo,id]); });');
    assert.equal(auditProject(dir, 'business').findings.length, 0);
  });
});
test('preço desestruturado é coberto; comentário de exemplo não dispara', () => {
  fixture({ 'pedido.js': 'const { price: preco } = req.body;' }, dir => {
    assert.equal(auditProject(dir, 'business').findings.length, 1);
    writeFileSync(join(dir, 'pedido.js'), '// const price = req.body.price;\nconst price = produto.preco;');
    assert.equal(auditProject(dir, 'business').findings.length, 0);
  });
});
test('schema por loja: SET em pool e fallback public disparam; pool fixo não', () => {
  fixture({ 'db.js': 'await pool.query(`SET search_path TO "loja_a", public`);', 'test/instagram-isolamento.test.js': 'test("lojas A/B", () => {});' }, dir => {
    const bad = check(dir, 'check-tenant-isolation'); assert.equal(bad.status, 'failed'); assert.equal(bad.severities.high, 2);
    writeFileSync(join(dir, 'db.js'), 'const pool = new pg.Pool({options: `-c search_path=loja_a`});');
    const good = check(dir, 'check-tenant-isolation'); assert.equal(good.status, 'passed'); assert.equal(good.evidence_kind, 'static');
    assert.equal(check(dir, 'check-tenant-isolation-tests').status, 'passed');
    rmSync(join(dir, 'test/instagram-isolamento.test.js'));
    assert.equal(check(dir, 'check-tenant-isolation-tests').status, 'failed');
  });
});
test('SQL direto: interpolação de req detectada, valores parametrizados preservados', () => {
  fixture({ 'db.js': 'const search_path = "loja"; pool.query(`SELECT * FROM pedidos WHERE id = ${req.params.id}`);' }, dir => {
    assert.equal(auditProject(dir, 'tenant').findings[0].severity, 'crit');
    writeFileSync(join(dir, 'db.js'), 'const search_path = "loja"; pool.query("SELECT * FROM pedidos WHERE id = $1", [req.params.id]);');
    assert.equal(auditProject(dir, 'tenant').findings.length, 0);
  });
});
test('Forgejo/Gitea .yaml: E2E configurado e higiene CI reconhecidos; sem job é finding', () => {
  for (const provider of ['.forgejo', '.gitea', '.github']) fixture({
    'package.json': '{"devDependencies":{"@playwright/test":"*"}}', 'e2e/smoke.spec.js': 'test("login", () => {});',
    [provider + '/workflows/test.yaml']: 'jobs:\n  e2e:\n    steps:\n      - run: npx playwright test\n',
  }, dir => {
    assert.equal(check(dir, 'check-functional-e2e').findings_count, 0);
    const git = check(dir, 'check-git-hygiene'); assert.ok(!git.findings.some(f => f.message.includes('sem pipeline')));
    writeFileSync(join(dir, provider + '/workflows/test.yaml'), '# playwright is not executed\njobs: {}\n');
    assert.ok(check(dir, 'check-functional-e2e').findings.some(f => f.severity === 'med'));
  });
});
const fastlist = process.env.FASTLIST_SOURCE;
test('checkout FastList real: reconhece PostgreSQL, schema por loja, test/ e Forgejo', { skip: !fastlist || !existsSync(fastlist) }, () => {
  const p = inspectProject(fastlist); assert.equal(p.postgres, true); assert.equal(p.schemaTenancy, true); assert.equal(p.multiTenant, true);
  assert.ok(p.isolationTests.some(f => f === 'test/instagram-isolamento.test.js'));
  assert.ok(existsSync(join(fastlist, '.forgejo/workflows/pull-request.yml')));
});
