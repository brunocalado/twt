#!/usr/bin/env node
/**
 * Packages the minimum runtime footprint of the system into a distributable ZIP —
 * exactly what Foundry needs to load and run it, and nothing from development
 * tooling, source SCSS, pack authoring JSON, or assistant material.
 *
 * Included: system.json, LICENSE, the README and CHANGELOG that system.json points
 * Foundry at, module/, the compiled stylesheet, templates/, lang/, fonts/,
 * assets/, and the compiled compendium packs declared in system.json
 * (packs/_source/ is never included — it is authoring input).
 *
 * The archive is named `<id>.zip` with no version in it, because the release
 * workflow attaches it to a tag and system.json's `download` URL carries the
 * version. Build the stylesheet and the packs first, or the ZIP ships stale ones:
 *
 *   npm run build && npm run packs:build && npm run release
 */
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist');

const system = JSON.parse(readFileSync(path.join(ROOT, 'system.json'), 'utf8'));
const STAGING_DIR = path.join(OUT_DIR, system.id);

/** Copies a root-relative file or directory into the staging area, warning (not failing) if missing. */
function copy(relPath) {
  const src = path.join(ROOT, relPath);
  const dest = path.join(STAGING_DIR, relPath);
  if (!existsSync(src)) {
    console.warn(`skip (missing): ${relPath}`);
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  // Compiled compendiums ship a LevelDB `LOCK` marker; if Foundry is running it
  // holds that file open exclusively. It is an empty lock handle, not data —
  // LevelDB recreates it on open — so skip it rather than fail the whole copy.
  cpSync(src, dest, {
    recursive: true,
    filter: (source) => path.basename(source) !== 'LOCK',
  });
}

rmSync(STAGING_DIR, { recursive: true, force: true });
mkdirSync(STAGING_DIR, { recursive: true });

copy('system.json');
copy('LICENSE');
copy('README.md');
copy('CHANGELOG.md');
copy('module');
copy('templates');
copy('lang');
copy('fonts');
copy('assets');
for (const style of system.styles ?? []) copy(style);
for (const pack of system.packs ?? []) copy(pack.path);

mkdirSync(OUT_DIR, { recursive: true });
const zipName = `${system.id}.zip`;
const zipPath = path.join(OUT_DIR, zipName);
rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', '-X', zipName, system.id], { cwd: OUT_DIR, stdio: 'inherit' });

rmSync(STAGING_DIR, { recursive: true, force: true });

console.log(`\nRelease package: ${path.relative(ROOT, zipPath)}`);
