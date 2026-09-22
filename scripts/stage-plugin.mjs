import { publicDocs, publicAssets } from './public-docs.mjs';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node scripts/stage-plugin.mjs /absolute/destination/cdx-slider');
const target = resolve(destination);
if (basename(target) !== 'cdx-slider' || target === root || (existsSync(target) && realpathSync(target) === root)) {
  throw new Error('Use a separate destination directory named cdx-slider.');
}
for (const file of ['server.mjs', 'panel.html', 'THIRD-PARTY-NOTICES.txt']) {
  if (!existsSync(join(root, 'dist', file))) throw new Error('Run npm run build first (including third-party notices).');
}
const runtimeIndex = process.argv.indexOf('--runtime-root');
if (runtimeIndex !== -1 && !process.argv[runtimeIndex + 1]) throw Error('--runtime-root requires a path.');
const runtimeRoot = runtimeIndex === -1 ? target : resolve(process.argv[runtimeIndex + 1]);
const manifestFile = join(target, '.codex-plugin/plugin.json');
if (existsSync(target) && !existsSync(manifestFile)) throw new Error('Existing destination is not a recognized plugin.');
if (existsSync(manifestFile) && JSON.parse(readFileSync(manifestFile, 'utf8')).name !== 'cdx-slider') throw new Error('Destination contains a different plugin.');
// Read all documents before changing an existing staged installation.
const documents = [...publicDocs, ...publicAssets].map(file => [file, readFileSync(join(root, file))]);
// Build on the destination machine: runtime.json contains local runtime paths.
// Tests and MCP-only installs must not register a desktop LaunchAgent.
const withCompanion = process.platform === 'darwin' && !process.argv.includes('--without-companion');
if (withCompanion) execFileSync(process.execPath, [join(root, 'scripts/build-companion.mjs')], { cwd: root, stdio: 'inherit' });
mkdirSync(target, { recursive: true });
for (const file of ['LICENSE', '.codex-plugin', 'skills', 'dist', 'README.md', 'README.ko.md']) {
  cpSync(join(root, file), join(target, file), { recursive: true });
}
// docs is a generated part of this recognized plugin. Replace the old set so
// previous staging runs cannot retain archived or renamed documents.
rmSync(join(target, 'docs'), { recursive: true, force: true });
for (const [file, contents] of documents) {
  mkdirSync(dirname(join(target, file)), { recursive: true });
  writeFileSync(join(target, file), contents);
}
const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
mcp.mcpServers['cdx-slider'].command = process.execPath;
// This desktop build does not expand plugin-root variables inside MCP args.
// Bind local installs to their stable source directory, not a versioned cache.
mcp.mcpServers['cdx-slider'].args = [join(runtimeRoot, 'dist/server.mjs')];
try {
  const binary = process.env.CDX_CODEX_BIN || execFileSync('/usr/bin/which', ['codex'], { encoding: 'utf8' }).trim();
  if (binary) mcp.mcpServers['cdx-slider'].env = { ...mcp.mcpServers['cdx-slider'].env, CDX_CODEX_BIN: binary };
} catch {}
writeFileSync(join(target, '.mcp.json'), JSON.stringify(mcp, null, 2) + '\n');
if (withCompanion) {
  const runtimeFile = join(target, 'dist/CDX Slider.app/Contents/Resources/runtime.json');
  const runtime = JSON.parse(readFileSync(runtimeFile, 'utf8'));
  runtime.installRoot = runtimeRoot;
  writeFileSync(runtimeFile, JSON.stringify(runtime));
}
if (withCompanion && !process.argv.includes('--prepare-only')) {
  execFileSync(process.execPath, [join(root, 'scripts/install-companion.mjs'), '--app', join(target, 'dist/CDX Slider.app')], { cwd: root, stdio: 'inherit' });
}
console.log(`Prepared plugin at ${target}. Marketplace registration and installation are separate.`);
