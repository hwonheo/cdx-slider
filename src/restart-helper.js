// Run only by an explicitly scheduled user restart. Never invoked by builds/tests.
ObjC.import('AppKit');
ObjC.import('Foundation');
function run(argv) {
  if (argv.length !== 1) throw new Error('Missing application path');
  var bundle = $.NSBundle.bundleWithPath($(argv[0]));
  if (!bundle || ObjC.unwrap(bundle.bundleIdentifier) !== 'com.openai.codex') throw new Error('Unexpected application');
  var apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.openai.codex');
  // JXA bridges NSUInteger as a string on some macOS versions.
  if (Number(apps.count) !== 1) throw new Error('Expected one running Codex application');
  var app = apps.objectAtIndex(0);
  if (ObjC.unwrap(app.bundleURL.path) !== ObjC.unwrap(bundle.bundlePath)) throw new Error('Application path mismatch');
  $.NSThread.sleepForTimeInterval(1);
  if (!app.terminate) throw new Error('Application declined termination');
  var deadline = Date.now() + 30000;
  while (!app.isTerminated && Date.now() < deadline) {
    // NSRunningApplication refreshes termination state through the run loop.
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.25));
  }
  if (!app.isTerminated) throw new Error('Application did not terminate; no force quit attempted');
  // Use Launch Services after the old process has fully exited.
  var opener = $.NSTask.alloc.init;
  opener.launchPath = '/usr/bin/open';
  opener.arguments = ['-a', argv[0]];
  opener.launch;
  opener.waitUntilExit;
  if (Number(opener.terminationStatus) !== 0) throw new Error('Could not relaunch Codex');
}
