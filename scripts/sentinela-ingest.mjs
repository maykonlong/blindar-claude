#!/usr/bin/env node
// SARIF Sentinela → evidência DAST. Falha de importação substitui aprovação antiga.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const LEVEL = { error: 'high', warning: 'med', note: 'low', none: 'low' };
const SEV = { critical: 'crit', crit: 'crit', high: 'high', medium: 'med', med: 'med', low: 'low', info: 'low' };
const targetUrl = value => { const u = new URL(value); if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw Error('alvo HTTP(S) sem credenciais obrigatório'); return u.href; };
export function sarifToResult(sarif, { target, gitSha, maxAgeHours = 24, now = Date.now() } = {}) {
  if (sarif?.version !== '2.1.0' || !Array.isArray(sarif.runs) || !sarif.runs.length) throw Error('SARIF 2.1.0 com runs não vazio obrigatório');
  const findings = [], reasons = [], evidence = [];
  for (const run of sarif.runs) {
    if (run?.tool?.driver?.name?.toLowerCase() !== 'sentinela' || !Array.isArray(run.results)) throw Error('run Sentinela com results explícito obrigatório');
    const p = run.properties || {};
    const timestamp = Date.parse(p.timestamp);
    let actualTarget;
    try { actualTarget = targetUrl(p.target); } catch { reasons.push('alvo ausente/inválido'); }
    if (target && actualTarget !== targetUrl(target)) throw Error('alvo do SARIF diverge de --target');
    if (!Number.isFinite(timestamp) || timestamp > now + 300000 || now - timestamp > maxAgeHours * 3600000) reasons.push('timestamp ausente, futuro ou vencido');
    if (!run.invocations?.length || run.invocations.some(i => i.executionSuccessful !== true)) reasons.push('execução bem-sucedida não comprovada');
    if (gitSha && p.git_sha !== gitSha) throw Error('SHA implantado do SARIF diverge de --git-sha');
    if (!p.git_sha || !/^[a-f0-9]{40}$/i.test(p.git_sha)) reasons.push('SHA implantado não informado');
    evidence.push({ target: actualTarget || null, timestamp: p.timestamp || null, git_sha: p.git_sha || null, session_id: p.sessionId || null, authenticated: p.authenticated === true });
    for (const r of run.results) {
      if (!r || typeof r.message?.text !== 'string' || !r.message.text.trim()) throw Error('finding SARIF sem message.text');
      const explicit = r.properties?.severity;
      const severity = explicit === undefined ? LEVEL[r.level || 'warning'] : SEV[String(explicit).toLowerCase()];
      if (!severity) throw Error('severidade SARIF desconhecida');
      const loc = r.locations?.[0]?.physicalLocation;
      const file = String(loc?.artifactLocation?.uri || '');
      const message = `${r.ruleId ? `[${r.ruleId}] ` : ''}${r.message.text}`.slice(0, 2000);
      findings.push({ severity, message, file, line: String(loc?.region?.startLine || ''),
        fp: createHash('sha256').update(`check-sentinela|${file}|${message}`).digest('hex').slice(0, 8) });
    }
  }
  const blocked = findings.some(f => ['crit', 'high'].includes(f.severity));
  const exercised = reasons.length === 0;
  return {
    schema: 'blindar/check-result@v1', agent: 'check-sentinela', ran_at: new Date(now).toISOString(),
    git_sha: evidence[0].git_sha || 'unknown', source: 'Sentinela SARIF (DAST; autenticação registrada separadamente)',
    status: blocked ? 'failed' : exercised ? 'passed' : 'skipped', exit_code: blocked ? 1 : exercised ? 0 : 3,
    missing_tool: null, evidence_kind: 'dynamic', exercised, not_exercised_reason: exercised ? null : [...new Set(reasons)].join('; '),
    evidence, findings_count: findings.length,
    severities: Object.fromEntries(['crit', 'high', 'med', 'low'].map(s => [s, findings.filter(f => f.severity === s).length])), findings,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let file, out = '.blindar/results/check-sentinela.json', target, gitSha, maxAgeHours = 24;
  try {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (['--out', '--target', '--git-sha', '--max-age-hours'].includes(a)) {
        const v = args[++i]; if (!v || v.startsWith('--')) throw Error(`valor obrigatório: ${a}`);
        if (a === '--out') out = v;
        else if (a === '--target') target = targetUrl(v);
        else if (a === '--git-sha') { if (!/^[a-f0-9]{40}$/i.test(v)) throw Error('SHA completo obrigatório'); gitSha = v; }
        else { maxAgeHours = Number(v); if (!(maxAgeHours > 0 && Number.isFinite(maxAgeHours))) throw Error('idade máxima inválida'); }
      } else if (!a.startsWith('--') && !file) file = a;
      else throw Error(`argumento desconhecido: ${a}`);
    }
    if (!file || !target) throw Error('uso: sentinela-ingest.mjs arquivo.sarif --target URL [--git-sha SHA] [--out path]');
    const raw = fs.readFileSync(file);
    const result = sarifToResult(JSON.parse(raw.toString('utf8')), { target, gitSha, maxAgeHours });
    result.artifact_sha256 = createHash('sha256').update(raw).digest('hex');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    console.log(`Sentinela → ${out}: ${result.status}, ${result.findings_count} findings, exercised=${result.exercised}`);
    process.exitCode = result.exit_code;
  } catch (e) {
    const result = { schema: 'blindar/check-result@v1', agent: 'check-sentinela', status: 'errored', exit_code: 2,
      ran_at: new Date().toISOString(), missing_tool: null, evidence_kind: 'dynamic', exercised: false,
      not_exercised_reason: e.message, findings_count: 0, severities: { crit: 0, high: 0, med: 0, low: 0 }, findings: [] };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    console.error(`Importação Sentinela falhou: ${e.message}`); process.exitCode = 2;
  }
}
