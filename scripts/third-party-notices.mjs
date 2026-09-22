import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Use the actual bundle inputs, including transitive packages, instead of only
// package.json's direct dependencies. Keep upstream license/notice text intact.
export function thirdPartyNotices(metafiles, root = process.cwd()) {
  const packages = new Map();
  for (const metafile of metafiles) for (const input of Object.keys(metafile.inputs)) {
    if (!input.replaceAll('\\', '/').includes('node_modules/')) continue;
    let directory = dirname(resolve(root, input));
    while (true) {
      const manifest = join(directory, 'package.json');
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        if (pkg.name && pkg.version) { packages.set(directory, pkg); break; }
      }
      const parent = dirname(directory);
      if (parent === directory) throw new Error(`Cannot identify dependency: ${input}`);
      directory = parent;
    }
  }
  const sections = [...packages].sort((a, b) => `${a[1].name}@${a[1].version}`.localeCompare(`${b[1].name}@${b[1].version}`)).map(([directory, pkg]) => {
    const files = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile()
      && /^(licen[sc]e|copying|notice)(?:[.-].*)?$/i.test(entry.name)).map(entry => entry.name).sort();
    if (!files.some(name => /^(licen[sc]e|copying)/i.test(name))) {
      throw new Error(`Missing license text for ${pkg.name}@${pkg.version}; review before distributing.`);
    }
    return `## ${pkg.name}@${pkg.version}\n\n` + files.map(name => `### ${name}\n\n${readFileSync(join(directory, name), 'utf8')}`).join('\n\n');
  });
  return 'Third-party notices for bundled dependencies\n\nThe following upstream notices apply to bundled code. Bundling may remove unused code and minify or transform the original sources.\n\n' + (sections.length ? sections.join('\n\n---\n\n') : 'No third-party packages were included in this bundle.') + '\n';
}

export function noticesTemplate(notices) {
  const escaped = notices.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<template id="third-party-notices"><pre>${escaped}</pre></template>`;
}
