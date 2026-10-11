#!/usr/bin/env node
// One source tree, runtime-specific destinations. No shell profiles/hooks are modified.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function runtimeTargets(runtime = 'auto', { home = os.homedir(), env = process.env } = {}) {
  const roots = { claude: env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), codex: env.CODEX_HOME || path.join(home, '.codex') };
  let selected = runtime === 'both' ? ['claude', 'codex'] : runtime === 'auto' ? Object.keys(roots).filter(k => fs.existsSync(roots[k])) : [runtime];
  if (!selected.length) throw Error('Nenhum runtime detectado. Escolha --runtime claude, codex ou both.');
  if (selected.some(k => !roots[k])) throw Error('Runtime inválido: auto|claude|codex|both');
  return selected.map(name => ({ name, target: path.resolve(roots[name], 'skills', 'blindar') }));
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const protectedPath = file => /^(?:\.git|\.blindar(?:\.[^/]*)?)(?:\/|$)|^\.last-check$|^\.blindar-install\.json$/.test(file);
function rejectLinks(target, dest) {
  for (let p = dest; p.length >= target.length; p = path.dirname(p)) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw Error(`Destino contém link: ${p}`);
    if (p === target) break;
  }
}
export function installRuntime({ source, runtime = 'auto', home, env = process.env, check = false, sentinelaDir }) {
  source = path.resolve(source);
  const sentinela = sentinelaDir || env.SENTINELA_DIR || path.resolve(source, '../Sentinela');
  if (sentinelaDir && !fs.existsSync(path.join(sentinela, 'sentinela.mjs'))) throw Error('Diretório Sentinela inválido');
  if (!fs.existsSync(path.join(source, 'SKILL.md'))) throw Error('Fonte sem SKILL.md');
  let files;
  try {
    files = execFileSync('git', ['-C', source, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  } catch {
    const manifest = JSON.parse(fs.readFileSync(path.join(source, '.blindar-install.json'), 'utf8'));
    files = Object.keys(manifest.files);
  }
  files = [...new Set(files)].filter(f => !protectedPath(f) && fs.existsSync(path.join(source, f)));
  const report = [];
  for (const { name, target } of runtimeTargets(runtime, { home, env })) {
    if (target === source) { report.push({ runtime: name, target, changed: 0 }); continue; }
    // Never overwrite a development checkout, or follow a redirected installation.
    if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || fs.existsSync(path.join(target, '.git')))) throw Error(`Destino é checkout/link; use sync-skill explicitamente: ${target}`);
    const manifest = { version: fs.readFileSync(path.join(source, 'VERSION'), 'utf8').trim(), runtime: name, files: {} };
    if (fs.existsSync(path.join(sentinela, 'sentinela.mjs'))) manifest.integrations = { sentinela_dir: path.resolve(sentinela) };
    let changed = 0;
    for (const file of files) {
      const src = path.resolve(source, file), dest = path.resolve(target, file);
      if (!src.startsWith(source + path.sep) || !dest.startsWith(target + path.sep)) throw Error('Caminho fora da instalação');
      rejectLinks(target, dest);
      if (fs.lstatSync(src).isSymbolicLink()) throw Error(`Link não suportado: ${file}`);
      manifest.files[file] = hash(src);
      if (!fs.existsSync(dest) || hash(dest) !== manifest.files[file]) {
        changed++;
        if (!check) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); fs.chmodSync(dest, fs.statSync(src).mode); }
      }
    }
    // Preserve runtime/user files; clean only files previously managed by this installer.
    const previous = path.join(target, '.blindar-install.json');
    if (fs.existsSync(previous)) {
      for (const file of Object.keys(JSON.parse(fs.readFileSync(previous, 'utf8')).files || {})) {
        const dest = path.resolve(target, file);
        if (!dest.startsWith(target + path.sep) || protectedPath(file)) throw Error('Manifesto contém caminho protegido/inválido');
        rejectLinks(target, dest);
        if (!(file in manifest.files) && fs.existsSync(dest)) { changed++; if (!check) fs.unlinkSync(dest); }
      }
    }
    if (!check) fs.writeFileSync(previous, JSON.stringify(manifest, null, 2) + '\n');
    report.push({ runtime: name, target, changed, version: manifest.version });
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = { source: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') };
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (key === '--check') options.check = true;
      else if (['--runtime', '--source', '--home', '--sentinela-dir'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) options[key === '--sentinela-dir' ? 'sentinelaDir' : key.slice(2)] = args[++i];
      else throw Error(`Argumento inválido: ${key}`);
    }
    const report = installRuntime(options);
    console.log(JSON.stringify(report, null, 2));
    if (options.check && report.some(r => r.changed)) process.exitCode = 1;
  } catch (e) { console.error(e.message); process.exitCode = 2; }
}
