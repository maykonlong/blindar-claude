import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { installRuntime, runtimeTargets } from '../scripts/install-runtime.mjs';
test('auto não inventa runtime; ambas configurações e CODEX_HOME são respeitados', () => {
  const home = mkdtempSync(join(tmpdir(), 'blindar-runtimes-'));
  try {
    assert.throws(() => runtimeTargets('auto', { home, env: {} }));
    mkdirSync(join(home, '.claude')); mkdirSync(join(home, 'custom-codex'));
    const r = runtimeTargets('auto', { home, env: { CODEX_HOME: join(home, 'custom-codex') } });
    assert.equal(r.length, 2); assert.equal(r[1].target, join(home, 'custom-codex/skills/blindar'));
    assert.throws(() => runtimeTargets('gpt', { home, env: {} }));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('instalação idempotente, drift verificável, preserva dados e recusa checkout', () => {
  const home = mkdtempSync(join(tmpdir(), 'blindar-install-')), source = join(home, 'source');
  try {
    mkdirSync(source); execFileSync('git', ['init', source], { stdio: 'ignore' });
    for (const [name, text] of Object.entries({ 'SKILL.md': '---\nname: blindar\n---\n', VERSION: '0.84.0', '.last-check': 'private runtime state' })) writeFileSync(join(source, name), text);
    const opts = { source, home, runtime: 'both', env: {} };
    const first = installRuntime(opts); assert.equal(first.length, 2);
    const target = first[1].target; assert.ok(existsSync(join(target, 'SKILL.md'))); assert.equal(existsSync(join(target, '.last-check')), false);
    writeFileSync(join(target, 'personal.txt'), 'preserve');
    assert.ok(installRuntime({ ...opts, check: true }).every(r => r.changed === 0));
    writeFileSync(join(target, 'VERSION'), 'old'); assert.ok(installRuntime({ ...opts, check: true }).some(r => r.changed > 0));
    installRuntime(opts); assert.equal(readFileSync(join(target, 'personal.txt'), 'utf8'), 'preserve');
    mkdirSync(join(target, '.git')); assert.throws(() => installRuntime(opts), /checkout/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
