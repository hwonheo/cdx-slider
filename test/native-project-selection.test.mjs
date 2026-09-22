import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('native project identity survives duplicate names, shared profiles, and menu reordering', { skip: process.platform !== 'darwin' }, t => {
  const directory = mkdtempSync(join(tmpdir(), 'slider-native-selection-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = readFileSync(new URL('../native/SliderBar.swift', import.meta.url), 'utf8');
  const entry = source.lastIndexOf('\nlet app = NSApplication.shared');
  if (entry < 0) throw new Error('Native application entry point not found');
  const fixture = String.raw`
let bar = SliderBar()
let fixtureRows: [[String: Any]] = [
    ["profile": "personal", "id": "sample", "name": "Same"],
    ["profile": "personal", "id": "other", "name": "Same"],
    ["profile": "work", "id": "sample", "name": "Same"]
]
bar.render(["projects": fixtureRows, "bindings": [:], "selected": "work/sample"], nil)
precondition(bar.projects.numberOfItems == 3)
precondition(bar.selectedKey == "work/sample")
let chosen = bar.projects.selectedItem!
bar.projects.menu!.removeItem(chosen)
bar.projects.menu!.insertItem(chosen, at: 0)
bar.projects.select(chosen)
precondition(bar.selectedKey == "work/sample")
let process = Process()
process.executableURL = URL(fileURLWithPath: "/bin/sleep")
process.arguments = ["10"]
try process.run()
defer { process.terminate(); process.waitUntilExit() }
let pipe = Pipe()
bar.process = process
bar.input = pipe.fileHandleForWriting
bar.request("save") { _,error in precondition(error == nil) }
try pipe.fileHandleForWriting.close()
let request = try JSONSerialization.jsonObject(with: pipe.fileHandleForReading.availableData) as! [String: Any]
precondition(request["profile"] as? String == "work")
precondition(request["project"] as? String == "sample")
bar.render(["projects": fixtureRows.reversed().map { $0 }, "bindings": [:], "selected": "work/sample"], nil)
precondition(bar.projects.numberOfItems == 3)
precondition(bar.selectedKey == "work/sample")
print("Native selection regression passed")
`;
  const script = join(directory, 'selection.swift');
  writeFileSync(script, source.slice(0, entry) + fixture);
  const binary = join(directory, 'selection');
  execFileSync('/usr/bin/swiftc', ['-module-cache-path', join(tmpdir(), 'cdx-slider-swift-cache'), script, '-o', binary], { timeout: 120000, stdio: 'pipe' });
  execFileSync(binary, [], { timeout: 15000, stdio: 'pipe' });
});
