import { publicDocs, publicAssets } from './public-docs.mjs';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['LICENSE', 'README.md', 'README.ko.md', 'package.json', 'package-lock.json', '.gitignore',
  '.mcp.json', '.codex-plugin/plugin.json', ...publicDocs, ...publicAssets];
const trees = { bin: /\.mjs$/, src: /\.(mjs|js)$/, ui: /\.(mjs|html|css)$/, native: /\.swift$/,
  scripts: /\.mjs$/, test: /\.mjs$/, skills: /\.(md|yaml)$/, examples: /\.json$/ };

export function exportSource(destination, root = projectRoot) {
  const selected = [...files];
  function walk(relative, allowed) {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Source symlink must be reviewed: ${name}`);
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) walk(name, allowed);
      else if (entry.isFile() && allowed.test(entry.name)) selected.push(name);
    }
  }
  for (const [tree, allowed] of Object.entries(trees)) walk(tree, allowed);
  // Read and validate before creating the destination. Never replace an existing export.
  const contents = selected.sort().map(name => {
    if (!lstatSync(join(root, name)).isFile()) throw new Error(`Expected regular file: ${name}`);
    return [name, readFileSync(join(root, name))];
  });
  mkdirSync(destination, { mode: 0o700 });
  const manifest = {};
  for (const [name, bytes] of contents) {
    const target = join(destination, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: 'wx', mode: name.startsWith('bin/') ? 0o755 : 0o644 });
    manifest[name] = createHash('sha256').update(bytes).digest('hex');
  }
  writeFileSync(join(destination, 'SOURCE-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: npm run export:source -- /absolute/new-directory');
  const destination = resolve(process.argv[2]);
  const manifest = exportSource(destination);
  console.log(`Exported ${Object.keys(manifest).length} source files to ${destination}. Review before publication.`);
}
