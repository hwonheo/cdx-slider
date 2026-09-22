import { thirdPartyNotices, noticesTemplate } from './third-party-notices.mjs';
import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
const ui = await build({ entryPoints: ['ui/panel.mjs'], bundle: true, platform: 'browser', format: 'esm',
  target: 'es2022', write: false, minify: true, metafile: true });
const html = readFileSync('ui/panel.html', 'utf8')
  .replace('</body>', () => noticesTemplate(thirdPartyNotices([ui.metafile])) + '</body>')
  .replace('/* PANEL_STYLES */', () => readFileSync('ui/panel.css', 'utf8'))
  .replace('/* PANEL_SCRIPT */', () => ui.outputFiles[0].text.replaceAll('</script', '<\\/script'));
mkdirSync('dist', { recursive: true });
writeFileSync('dist/panel.html', html);
copyFileSync('src/restart-helper.js','dist/restart-helper.js');
// The unbundled development server resolves the same resource beside itself.
writeFileSync('src/panel.html', html);
const server = await build({ entryPoints: ['src/server.mjs'], bundle: true, platform: 'node', format: 'esm',
  target: 'node22', metafile: true, outfile: 'dist/server.mjs', packages: 'bundle',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
writeFileSync('dist/THIRD-PARTY-NOTICES.txt', thirdPartyNotices([ui.metafile, server.metafile]));
console.log('Built dist/server.mjs (no npm install needed in plugin cache).');

await build({ entryPoints: ['src/update-worker.mjs'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: 'dist/update-worker.mjs' });
copyFileSync('scripts/install-companion.mjs', 'dist/install-companion.mjs');
copyFileSync('scripts/launch-agent.mjs', 'dist/launch-agent.mjs');
