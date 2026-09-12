#!/usr/bin/env node
/**
 * One command to cut a release.
 *
 *   npm run ship              bump the patch version (0.0.1 -> 0.0.2)
 *   npm run ship minor        0.0.2 -> 0.1.0
 *   npm run ship major        0.1.0 -> 1.0.0
 *   npm run ship 1.2.3        that exact version
 *   npm run ship -- --dry-run show every step without writing, committing or pushing
 *
 * It bumps system.json, package.json and package-lock.json, writes the CHANGELOG
 * entry from the commits since the last tag, commits, tags and pushes. The push
 * of the tag is what triggers .github/workflows/release.yml, which builds the ZIP
 * and publishes the GitHub Release. Nothing here has to be done by hand.
 *
 * The very first run is a special case: with no version tag in the repository yet,
 * it releases the version already in system.json instead of bumping past it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bumpArg = args.find((a) => !a.startsWith('--')) ?? 'patch';

/** Runs a git command and returns its trimmed stdout. */
function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** Runs a git command that mutates the repository, or just prints it under --dry-run. */
function gitWrite(...gitArgs) {
  if (dryRun) {
    console.log(`  [dry-run] git ${gitArgs.join(' ')}`);
    return;
  }
  execFileSync('git', gitArgs, { cwd: ROOT, stdio: 'inherit' });
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// --- Preflight ---------------------------------------------------------------
// Every one of these would otherwise fail halfway through, leaving the version
// bumped in the working tree but nothing tagged or pushed.

try {
  git('rev-parse', '--is-inside-work-tree');
} catch {
  fail('Not a git repository.');
}

if (!dryRun && git('status', '--porcelain')) {
  fail('Working tree is dirty. Commit or stash your changes first, then ship.');
}

for (const key of ['user.name', 'user.email']) {
  let value = '';
  try {
    value = git('config', key);
  } catch {
    /* unset: git exits non-zero */
  }
  if (!value) {
    fail(
      `git ${key} is not set, so the release commit cannot be made. Set it with:\n` +
        `  git config --global user.name "Your Name"\n` +
        `  git config --global user.email "you@example.com"`,
    );
  }
}

let remote = '';
try {
  remote = git('remote', 'get-url', 'origin');
} catch {
  /* no origin */
}
if (!remote) fail('No "origin" remote. Add one with: git remote add origin <url>');

// --- Work out the version ----------------------------------------------------

const systemPath = path.join(ROOT, 'system.json');
const system = JSON.parse(readFileSync(systemPath, 'utf8'));

const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
const lastTag = tags.length ? git('describe', '--tags', '--abbrev=0', '--match', 'v*') : null;

let version;
if (!lastTag) {
  // Nothing has ever been released, so system.json's version is still unclaimed.
  version = system.version;
  console.log(`No version tag yet — releasing system.json's current version ${version}.`);
} else if (/^\d+\.\d+\.\d+$/.test(bumpArg)) {
  version = bumpArg;
} else {
  const [major, minor, patch] = system.version.split('.').map(Number);
  if ([major, minor, patch].some(Number.isNaN)) {
    fail(`system.json version "${system.version}" is not a plain x.y.z number.`);
  }
  if (bumpArg === 'major') version = `${major + 1}.0.0`;
  else if (bumpArg === 'minor') version = `${major}.${minor + 1}.0`;
  else if (bumpArg === 'patch') version = `${major}.${minor}.${patch + 1}`;
  else fail(`Unknown bump "${bumpArg}". Use patch, minor, major, or an exact x.y.z version.`);
}

const tag = `v${version}`;
if (tags.includes(tag)) fail(`Tag ${tag} already exists.`);

console.log(`\nShipping ${tag}${lastTag ? ` (previous: ${lastTag})` : ''}\n`);

// --- Version fields ----------------------------------------------------------
// package-lock.json carries the root version twice, and `npm ci` refuses to run
// when it disagrees with package.json — so all three files move together.

/** Rewrites a JSON file through a mutator, preserving two-space indentation. */
function patchJson(relPath, mutate) {
  const file = path.join(ROOT, relPath);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  mutate(json);
  if (!dryRun) writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`  version -> ${version}  ${relPath}`);
}

patchJson('system.json', (j) => {
  j.version = version;
});
patchJson('package.json', (j) => {
  j.version = version;
});
patchJson('package-lock.json', (j) => {
  j.version = version;
  if (j.packages?.['']) j.packages[''].version = version;
});

// --- CHANGELOG ---------------------------------------------------------------

const changelogPath = path.join(ROOT, 'CHANGELOG.md');
let changelog = readFileSync(changelogPath, 'utf8');
const today = new Date().toISOString().slice(0, 10);
const heading = `## [${version}]`;

if (changelog.includes(heading)) {
  // The section was written by hand already; just stamp it with a date.
  changelog = changelog.replace(
    new RegExp(`^${heading.replace(/[[\]]/g, '\\$&')}.*$`, 'm'),
    `${heading} — ${today}`,
  );
  console.log(`  CHANGELOG.md: dated the existing ${version} section`);
} else {
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const subjects = git('log', range, '--no-merges', '--pretty=%s')
    .split('\n')
    .map((s) => s.trim())
    // --no-merges drops real merge commits; the subject test also catches the ones
    // a squash or a rebase left behind with a merge-shaped message.
    .filter((s) => s && !/^Release v\d/.test(s) && !/^Merge /.test(s));
  const entries = subjects.length
    ? subjects.map((s) => `- ${s}`).join('\n')
    : '- Maintenance release.';
  const section = `${heading} — ${today}\n\n${entries}\n\n`;
  // Insert above the newest existing section, or append if there is none.
  const firstSection = changelog.indexOf('\n## [');
  changelog =
    firstSection === -1
      ? `${changelog.trimEnd()}\n\n${section}`
      : `${changelog.slice(0, firstSection + 1)}${section}${changelog.slice(firstSection + 1)}`;
  console.log(`  CHANGELOG.md: new ${version} section from ${subjects.length} commit(s)`);
}
if (!dryRun) writeFileSync(changelogPath, changelog);

// --- Commit, tag, push -------------------------------------------------------

console.log('');
gitWrite('add', 'system.json', 'package.json', 'package-lock.json', 'CHANGELOG.md');
gitWrite('commit', '-m', `Release ${tag}`);
gitWrite('tag', '-a', tag, '-m', `Release ${tag}`);

// The commit and the tag already exist by now, so a push failure is recoverable
// and worth saying so plainly rather than dumping a stack trace.
try {
  gitWrite('push', '--follow-tags');
} catch {
  fail(
    `The push failed, but ${tag} is committed and tagged locally — nothing is lost.\n` +
      `Fix the remote or your credentials, then finish with:\n` +
      `  git push --follow-tags`,
  );
}

const webUrl = remote.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
console.log(
  dryRun
    ? `\nDry run only. Nothing was written, committed or pushed.`
    : `\nPushed ${tag}. The release workflow is building it now:\n  ${webUrl}/actions\nIt will appear at:\n  ${webUrl}/releases/tag/${tag}`,
);
