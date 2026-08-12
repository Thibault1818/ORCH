#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const [command, ...args] = process.argv.slice(2);

if (command === 'versions') {
  const [root] = args;
  if (!root) usage();
  const packageJson = json(path.join(root, 'package.json'));
  const shrinkwrap = json(path.join(root, 'npm-shrinkwrap.json'));
  const cli = fs.readFileSync(path.join(root, 'src/bin/cli.ts'), 'utf8');
  const match = cli.match(/\.version\('([^']+)'\)/);
  const versions = [packageJson.version, shrinkwrap.version, shrinkwrap.packages?.['']?.version, match?.[1]];
  if (versions.some((version) => typeof version !== 'string') || new Set(versions).size !== 1)
    fail(`Version mismatch: ${versions.join(', ')}`);
  process.stdout.write(`${versions[0]}\n`);
} else if (command === 'set-version') {
  const [root, version] = args;
  if (!root || !version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) usage();
  const packageFile = path.join(root, 'package.json');
  const shrinkwrapFile = path.join(root, 'npm-shrinkwrap.json');
  const cliFile = path.join(root, 'src/bin/cli.ts');
  const packageJson = json(packageFile);
  const shrinkwrap = json(shrinkwrapFile);
  packageJson.version = version;
  shrinkwrap.version = version;
  if (!shrinkwrap.packages?.['']) fail('npm-shrinkwrap.json is missing packages[""]');
  shrinkwrap.packages[''].version = version;
  writeJson(packageFile, packageJson);
  writeJson(shrinkwrapFile, shrinkwrap);
  const cli = fs.readFileSync(cliFile, 'utf8');
  if (!/\.version\('[^']+'\)/.test(cli)) fail('CLI version declaration not found');
  fs.writeFileSync(cliFile, cli.replace(/\.version\('[^']+'\)/, `.version('${version}')`));
} else if (command === 'dist-manifest') {
  const [root, output] = args;
  if (!root || !output) usage();
  await writeManifest(root, output, 'dist');
} else if (command === 'package-manifest') {
  const [tarball, packJsonFile, output] = args;
  if (!tarball || !packJsonFile || !output) usage();
  await verifyPackage(tarball, packJsonFile, output);
} else if (command === 'sha256') {
  const [file] = args;
  if (!file) usage();
  process.stdout.write(`${await sha256(file)}\n`);
} else {
  usage();
}

async function verifyPackage(tarball, packJsonFile, output) {
  const pack = json(packJsonFile)[0];
  if (!pack || typeof pack.filename !== 'string' || !Array.isArray(pack.files))
    fail('Invalid npm pack JSON');
  if (path.basename(tarball) !== pack.filename) fail('npm pack filename does not match tarball');
  const digest = await fsp.readFile(tarball);
  const shasum = createHash('sha1').update(digest).digest('hex');
  const integrity = `sha512-${createHash('sha512').update(digest).digest('base64')}`;
  if (pack.shasum !== shasum || pack.integrity !== integrity)
    fail('npm pack checksums do not match the actual tarball');

  const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  if (entries.some((entry) => !entry.startsWith('package/') || entry.includes('/../')))
    fail('Tarball contains an unsafe path');
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'orch-release-package-'));
  try {
    execFileSync('tar', ['-xzf', tarball, '-C', temp]);
    const actual = await manifest(path.join(temp, 'package'), 'package');
    const actualFiles = actual.map((entry) => entry.path.replace(/^package\//, ''));
    const reported = pack.files.map((entry) => entry.path).sort(comparePath);
    if (JSON.stringify(actualFiles) !== JSON.stringify(reported))
      fail('npm pack JSON does not describe the complete actual tarball');
    for (const required of ['dist/cli.js', 'dist/index.js', 'dist/index.d.ts', 'npm-shrinkwrap.json', 'skills/orch/SKILL.md']) {
      if (!actualFiles.includes(required)) fail(`Tarball is missing required file: ${required}`);
    }
    for (const reportedFile of pack.files) {
      const actualFile = actual.find((entry) => entry.path === `package/${reportedFile.path}`);
      if (!actualFile || actualFile.size !== reportedFile.size || actualFile.mode !== octal(reportedFile.mode))
        fail(`npm pack metadata mismatch for ${reportedFile.path}`);
    }
    await fsp.writeFile(output, formatManifest(actual));
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
}

async function writeManifest(root, output, prefix) {
  await fsp.writeFile(output, formatManifest(await manifest(root, prefix)));
}

async function manifest(root, prefix) {
  const result = [];
  async function visit(directory, relative) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => comparePath(a.name, b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const nested = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = await fsp.lstat(absolute);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        if (stat.isDirectory()) await visit(absolute, nested);
        else fail(`Unsupported artifact type: ${nested}`);
        continue;
      }
      result.push({
        path: `${prefix}/${nested}`,
        mode: octal(stat.mode),
        size: stat.size,
        sha256: await sha256(absolute),
      });
    }
  }
  await visit(root, '');
  return result.sort((a, b) => comparePath(a.path, b.path));
}

function formatManifest(entries) {
  return entries.map((entry) => `${entry.path}\t${entry.mode}\t${entry.sha256}\t${entry.size}`).join('\n') + '\n';
}

function comparePath(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function sha256(file) {
  return createHash('sha256').update(await fsp.readFile(file)).digest('hex');
}

function octal(mode) {
  return (Number(mode) & 0o777).toString(8).padStart(3, '0');
}

function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function usage() {
  fail('Usage: verify-release-artifacts.mjs versions|set-version|dist-manifest|package-manifest|sha256 ...');
}
