import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function run(script, env = {}) {
  const r = spawnSync('bash', ['-c', `source bin/claude-env.sh; ${script}`], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test('apply_claude_env maps every alias to the selected model (NVIDIA NIM guide)', () => {
  const out = run(
    `apply_claude_env http://127.0.0.1:8790/nvidia tok z-ai/glm-5.3-flash nvidia/fast;
     echo "$ANTHROPIC_BASE_URL|$ANTHROPIC_AUTH_TOKEN|$ANTHROPIC_MODEL|$ANTHROPIC_CUSTOM_MODEL_OPTION|$ANTHROPIC_DEFAULT_HAIKU_MODEL|$ANTHROPIC_DEFAULT_SONNET_MODEL|$ANTHROPIC_DEFAULT_OPUS_MODEL|$CLAUDE_CODE_SUBAGENT_MODEL"`,
  );
  const m = 'z-ai/glm-5.3-flash';
  assert.equal(out, `http://127.0.0.1:8790/nvidia|tok|${m}|${m}|${m}|${m}|${m}|${m}`);
});

test('APPPROXY_USE_FAST_MODEL=1 sends only haiku to the fast model', () => {
  const out = run(`apply_claude_env b t main fast; echo "$ANTHROPIC_DEFAULT_HAIKU_MODEL $ANTHROPIC_DEFAULT_SONNET_MODEL"`, {
    APPPROXY_USE_FAST_MODEL: '1',
  });
  assert.equal(out, 'fast main');
});

test('ANTHROPIC_API_KEY is cleared so a real key never reaches the proxy', () => {
  const out = run(`apply_claude_env b t m; echo "[\${ANTHROPIC_API_KEY-unset}]"`, { ANTHROPIC_API_KEY: 'sk-real' });
  assert.equal(out, '[unset]');
});

test('print_claude_env_exports lists alias exports and never prints the key', () => {
  const out = run(`print_claude_env_exports http://h/nvidia m`);
  for (const name of ['ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL', 'ANTHROPIC_CUSTOM_MODEL_OPTION']) {
    assert.match(out, new RegExp(`export ${name}=`));
  }
  assert.match(out, /unset ANTHROPIC_API_KEY/);
});
