#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sarifToResult } from '../scripts/sentinela-ingest.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = 'a'.repeat(40), target = 'https://fastlist.example/';
const sarif = (results = [], properties = {}) => ({ version: '2.1.0', runs: [{
  tool: { driver: { name: 'Sentinela' } }, invocations: [{ executionSuccessful: true }],
  properties: { target, timestamp: new Date().toISOString(), git_sha: sha, ...properties }, results
}] });
test('preserva crítico, CWE/regra, localização e contagem no contrato canônico', () => {
  const r = sarifToResult(sarif([{ ruleId: 'idor', level: 'error', properties: { severity: 'CRITICAL' },
    message: { text: 'Loja B acessa pedido da loja A' }, locations: [{ physicalLocation: { artifactLocation: { uri: target }, region: { startLine: 1 } } }] }]));
  assert.equal(r.agent, 'check-sentinela'); assert.equal(r.status, 'failed'); assert.equal(r.severities.crit, 1);
  assert.equal(r.findings[0].file, target); assert.match(r.findings[0].fp, /^[a-f0-9]{8}$/);
  assert.equal(r.exercised, true); assert.equal(r.evidence[0].authenticated, false);
});
test('zero findings só passa com uma execução completa, fresca e identificada', () => {
  assert.equal(sarifToResult(sarif()).status, 'passed');
  for (const p of [{ timestamp: '2000-01-01' }, { git_sha: undefined }, { timestamp: '2100-01-01' }]) {
    const r = sarifToResult(sarif([], p)); assert.equal(r.status, 'skipped'); assert.equal(r.exercised, false);
  }
  const s = sarif(); s.runs[0].invocations = [];
  assert.equal(sarifToResult(s).status, 'skipped');
});
test('estrutura inválida nunca significa auditoria limpa', () => {
  for (const s of [{}, { version: '2.1.0', runs: [] }, { version: '2.1.0', runs: [{}] }]) assert.throws(() => sarifToResult(s));
  assert.throws(() => sarifToResult(sarif([{ message: { text: 'x' }, properties: { severity: 'unknown' } }])));
});
test('alvo/SHA divergentes são rejeitados; achado antigo permanece visível', () => {
  assert.throws(() => sarifToResult(sarif(), { target: 'https://outra.example/' }));
  assert.throws(() => sarifToResult(sarif(), { gitSha: 'b'.repeat(40) }));
  const r = sarifToResult(sarif([{ level: 'error', message: { text: 'Falha real' } }], { timestamp: '2000-01-01' }));
  assert.equal(r.status, 'failed'); assert.equal(r.exercised, false); assert.equal(r.severities.high, 1);
});
test('importação CLI → gate SECURITY: crítico bloqueia; erro substitui aprovação anterior', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blindar-sentinela-'));
  try {
    const input = join(dir, 'scan.sarif');
    writeFileSync(input, JSON.stringify(sarif([{ level: 'error', properties: { severity: 'CRITICAL' }, message: { text: 'IDOR' } }])));
    const ingest = () => spawnSync(process.execPath, [join(root, 'scripts/sentinela-ingest.mjs'), input, '--target', target, '--git-sha', sha], { cwd: dir, encoding: 'utf8' });
    assert.equal(ingest().status, 1);
    const gate = () => {
      const p = spawnSync('bash', [join(root, 'templates/checks/check-release-gates.sh')], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
      assert.ok([0, 1, 2].includes(p.status), p.stderr + p.stdout);
      return JSON.parse(readFileSync(join(dir, '.blindar/gates.json'), 'utf8'));
    };
    let g = gate(); assert.equal(g.verdict, 'NO-GO'); assert.equal(g.gates.find(x => x.gate === 'SECURITY').status, 'BLOCKED');
    writeFileSync(input, JSON.stringify(sarif())); assert.equal(ingest().status, 0);
    g = gate(); assert.equal(g.gates.find(x => x.gate === 'SECURITY').status, 'PASS');
    const resultFile = join(dir, '.blindar/results/check-sentinela.json');
    const old = JSON.parse(readFileSync(resultFile, 'utf8'));
    old.evidence[0].timestamp = '2000-01-01T00:00:00Z';
    writeFileSync(resultFile, JSON.stringify(old));
    g = gate(); assert.equal(g.gates.find(x => x.gate === 'SECURITY').status, 'NOT EXERCISED');
    // Um result aprovado na semana passada não continua valendo no gate de hoje.
    assert.equal(ingest().status, 0);
    writeFileSync(input, '{}'); assert.equal(ingest().status, 2);
    assert.equal(JSON.parse(readFileSync(join(dir, '.blindar/results/check-sentinela.json'))).status, 'errored');
    g = gate(); assert.equal(g.verdict, 'NO-GO'); assert.equal(g.gates.find(x => x.gate === 'SECURITY').status, 'BLOCKED');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
const exporter = process.env.SENTINELA_SOURCE ? join(process.env.SENTINELA_SOURCE, 'src/report/sarif-export.mjs') : resolve(root, '../Sentinela/src/report/sarif-export.mjs');
test('contrato real entre exporter Sentinela e ingest Blindar', { skip: !existsSync(exporter) }, async () => {
  const { generateSarif } = await import(pathToFileURL(exporter));
  const s = generateSarif({ meta: { target, timestamp: new Date().toISOString(), git_sha: sha, executionSuccessful: true },
    findings: [{ type: 'IDOR', severity: 'CRITICAL', label: 'Vazamento entre lojas', cwe: 'CWE-639' }] });
  const r = sarifToResult(s, { target, gitSha: sha }); assert.equal(r.severities.crit, 1); assert.equal(r.exercised, true);
});
