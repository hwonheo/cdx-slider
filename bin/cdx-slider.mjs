#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { Store, dataHome } from '../src/store.mjs';
import { execute } from '../src/service.mjs';

const [command, ...args] = process.argv.slice(2);
if (!command || command === '--help' || command === 'help') {
  console.log(`CDX Slider — local project continuity (Node >=22.13)

  profile add <id> <label> [absolute-codex-home]
  profile list
  project add <id> <profile> <absolute-directory> [name]
  project list <profile>
  project grant <project> <source-profile> <target-profile>
  memory put <project> <profile> <key> <text-file>
  checkpoint save <project> <profile> <json-file>
  resume <project> <profile>
  export <project> <profile> <new-markdown-file>
  usage [profile]              All registered profiles if omitted
  call <tool> <json-file>      Same contract as MCP tools
  doctor                      Local paths and runtime only

CDX_SLIDER_HOME overrides storage independently of CODEX_HOME.
Profile labels are not verified account identities. This does not change desktop login.
No arguments accept passwords, tokens, or API keys.`);
  process.exit(0);
}
let store;
try {
  store = new Store();
  let tool, input, outputFile;
  const [action, ...a] = args;
  if (command === 'profile' && action === 'add') {
    tool = 'profile_register'; input = { id: a[0], label: a[1], codexHome: a[2], kind: a[2] ? 'cli' : 'desktop' };
  } else if (command === 'profile' && action === 'list') {
    tool = 'profiles_list'; input = {};
  } else if (command === 'project' && action === 'add') {
    tool = 'project_register'; input = { project: a[0], profile: a[1], path: a[2], name: a[3] || a[0] };
  } else if (command === 'project' && action === 'list') {
    tool = 'projects_list'; input = { profile: a[0] };
  } else if (command === 'project' && action === 'grant') {
    tool = 'project_grant'; input = { project: a[0], profile: a[1], targetProfile: a[2] };
  } else if (command === 'memory' && action === 'put') {
    tool = 'memory_put'; input = { project: a[0], profile: a[1], key: a[2], content: readFileSync(a[3], 'utf8') };
  } else if (command === 'checkpoint' && action === 'save') {
    tool = 'checkpoint_save'; input = { ...JSON.parse(readFileSync(a[2], 'utf8')), project: a[0], profile: a[1] };
  } else if (command === 'resume' || command === 'export') {
    tool = command === 'resume' ? 'project_resume' : 'handoff_export';
    input = { project: args[0], profile: args[1] };
    if (command === 'export') {
      outputFile = args[2];
      if (!outputFile) throw new Error('Provide a new Markdown output file.');
    }
  } else if (command === 'call') {
    tool = args[0]; input = JSON.parse(readFileSync(args[1], 'utf8'));
  } else if (command === 'doctor') {
    console.log(JSON.stringify({ node: process.version, dataHome: dataHome(), database: 'ok',
      registeredProfiles: store.profiles().length, nativeChatRestore: false, chatgptRemoteMcp: false }, null, 2));
  } else if (command === 'usage') {
    const profiles = args[0] ? [store.profile(args[0])] : store.profiles();
    // Bound concurrency for users with many registered profiles.
    const rows = [];
    for (let i = 0; i < profiles.length; i += 4) {
      rows.push(...await Promise.all(profiles.slice(i, i + 4).map(p => execute(store, 'usage_read', { profile: p.id }))));
    }
    console.log(JSON.stringify({ profiles: rows, quotasAreSeparate: true }, null, 2));
  } else throw new Error('Unknown command. Run with --help.');
  if (tool) {
    const result = await execute(store, tool, input);
    if (outputFile) {
      writeFileSync(outputFile, result.content, { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ exported: outputFile }));
    } else console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(`cdx-slider: ${error.message}`);
  process.exitCode = 1;
} finally { store?.close(); }
