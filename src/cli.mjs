#!/usr/bin/env node
import { loadConfig, maskSecret } from './config.mjs';
import { discoverModels, openAiChatUrl, openAiModelsUrl } from './models.mjs';

const cfg = loadConfig();
const cmd = process.argv[2];
const arg = process.argv[3];

if (cmd === 'doctor') {
  for (const name of Object.keys(cfg.providers)) {
    const p = cfg.active(name);
    const mode = p?.mode ? ` (${p.mode})` : '';
    console.log(`${name} -> ${p?.kind}${mode} | key: ${maskSecret(cfg.apiKeyOf(p))}`);
    console.log(`   anthropic : http://${cfg.server.host}:${cfg.server.port}/${name}/v1/messages`);
    console.log(`   openai    : http://${cfg.server.host}:${cfg.server.port}/${name}/v1/chat/completions`);
  }
  console.log(`server: ${cfg.server.host}:${cfg.server.port}`);
} else if (cmd === 'models') {
  if (!arg) {
    for (const name of Object.keys(cfg.providers)) {
      const { ids, source, error } = await discoverModels(cfg, name, { timeoutMs: 4000 });
      console.log(`${name}\t${ids.length}\t${source}${error ? `\t${error}` : ''}`);
    }
  } else {
    const { ids, source, error } = await discoverModels(cfg, arg, { timeoutMs: 6000 });
    if (error) console.error(`# discovery failed: ${error}`);
    console.error(`# source: ${source}`);
    for (const id of ids) console.log(id);
  }
} else if (cmd === 'urls') {
  const names = arg ? [arg] : Object.keys(cfg.providers);
  for (const name of names) {
    const p = cfg.active(name);
    if (!p) {
      console.error(`# unknown provider: ${name}`);
      continue;
    }
    const base = `http://${cfg.server.host}:${cfg.server.port}/${name}/v1`;
    console.log(`${name}\t${base}\t${openAiChatUrl(p)}\t${openAiModelsUrl(p)}`);
  }
} else if (cmd === 'add-provider') {
  const { runWizard } = await import('./add-provider.mjs');
  const result = await runWizard();
  if (!result) process.exit(1);
  // Makine satırı: bin/proxy-run bunu yakalar. Sorular stderr'e gider.
  process.stdout.write(`ADDED_PROVIDER=${result.name}\n`);
} else if (cmd === 'remove-provider') {
  const { runRemoveWizard } = await import('./remove-provider.mjs');
  const result = await runRemoveWizard({ name: arg });
  if (!result) process.exit(1);
  // Makine satırı: bin/proxy-run bunu yakalar. Sorular stderr'e gider.
  process.stdout.write(`REMOVED_PROVIDER=${result.name}\n`);
} else {
  console.log('usage: cli.mjs [doctor|models [provider]|urls [provider]|add-provider|remove-provider [provider]]');
}
