/**
 * Compendium build tool.
 *
 * Drives the official Foundry CLI (`@foundryvtt/foundryvtt-cli`) over every pack
 * declared in `system.json`:
 *
 *   node tools/packs.mjs pack     packs/_source/<name>/*.json  ->  packs/<name>  (LevelDB)
 *   node tools/packs.mjs unpack   packs/<name>  (LevelDB)      ->  packs/_source/<name>/*.json
 *
 * `packs/_source/` is the source of truth and the only place to edit by hand;
 * `packs/<name>/` is a generated artifact rebuilt by `npm run packs:build`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FVTT = path.join(ROOT, 'node_modules', '.bin', 'fvtt');

const action = process.argv[2] ?? 'pack';
if (!['pack', 'unpack'].includes(action)) {
  console.error(`Unknown action "${action}". Use "pack" or "unpack".`);
  process.exit(1);
}

const system = JSON.parse(fs.readFileSync(path.join(ROOT, 'system.json'), 'utf8'));
const packs = system.packs ?? [];
if (!packs.length) {
  console.log('system.json declares no packs yet — nothing to do.');
  process.exit(0);
}

const sourceRoot = path.join(ROOT, 'packs', '_source');
const packRoot = path.join(ROOT, 'packs');

let failed = false;
for (const { name } of packs) {
  // The CLI appends the compendium name to whichever directory it writes into,
  // so `--out packs` yields `packs/<name>` and `--in packs/_source/<name>` reads
  // that pack's sources.
  const args = [
    'package',
    action,
    name,
    '--id',
    system.id,
    '--type',
    'System',
    action === 'pack' ? '--in' : '--out',
    path.join(sourceRoot, name),
    action === 'pack' ? '--out' : '--in',
    packRoot,
  ];
  // --recursive so a nested _source layout still packs; --clean so re-extracting
  // never leaves behind sources for documents deleted from the DB.
  if (action === 'pack') args.push('--recursive');
  else args.push('--clean');

  const result = spawnSync(FVTT, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
