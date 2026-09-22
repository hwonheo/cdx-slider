# Installation

[한국어](Installation.ko.md) · [Documentation](../README.md)

## Prerequisites

Requires **Node.js 22.13+** and Codex with plugin support. Git is also required to clone the repository. The panel UI requires a Codex host that supports MCP Apps.

Check the installed tools in Terminal. The Node.js version must be 22.13 or newer.

```sh
node --version
npm --version
git --version
codex --version
```

Installing Slider Bar on macOS also requires Swift command-line tools. Check with `swift --version`. To install without the bar, append `--without-companion` to the staging command below.

## Clone, prepare, and enable the plugin

Clone the repository in Terminal, enter its folder, then run:

```sh
git clone https://github.com/hwonheo/cdx-slider.git
cd cdx-slider
npm ci
npm run build
node scripts/stage-plugin.mjs "$HOME/plugins/cdx-slider"
```

The final command prepares a separate plugin folder, including the bundled MCP server, skill, panel, and documentation. On macOS it also builds Slider Bar using Swift command-line tools, installs it in the staged folder, and registers its launch watcher. Keep this stable folder in place. It does not register or enable the plugin itself. Add `--without-companion` to the staging command for a bar-free installation.

In Codex, use the available `$plugin-creator` skill to request: “Register my prepared cdx-slider folder in my personal marketplace and install it as a local plugin.” Supply the absolute path printed by the staging command. Complete the host’s installation flow, then open a new task so its tools and skill can load.

The staged configuration records absolute Node and server paths. Keep that folder and Node installation in place; if either moves, stage and install again. Build and stage on each destination machine rather than distributing this machine-specific folder.

## Save and resume

1. In a new task, invoke `$cdx-slider:slider-continuity`. This requests the panel only.
2. On first use, enter a name and ID in **Create storage profile** in the panel. The new profile is selected immediately and the project registration form opens. For later projects, use **Register project**. A storage profile is a label for saved work, separate from your Codex account.
3. Select the project and choose **Save this conversation**. Wait for the agent to confirm successful checkpoint creation.
4. Open another task with access to the project folder, open the panel, and select **Resume saved work**.

To use another storage profile, explicitly ask to share the project with that profile first. Account changes are performed in Codex; the plugin does not automatically switch desktop accounts. If the plugin disappears after a change, enable it in that environment again.

If the host does not render MCP Apps, a returned panel resource is not a visible panel. Ask the skill to save or resume directly, or use the [CLI](Function.Details.md#cli). See [acceptance checks](acceptance.md) for live-host validation.

## Manual macOS bar installation and recovery

The staging command above already installs the bar. Requires macOS and Swift command-line tools. To install only the bar manually from a development checkout:

```sh
npm run build:companion
npm run install:companion
```

This builds `dist/CDX Slider.app` and registers its launch watcher. The bar appears when Codex runs. Do not also add a duplicate macOS login item. To remove the watcher:

```sh
npm run uninstall:companion
```

The app and saved project data remain. See [bar behavior and relay limits](Function.Details.md#macos-bar).

## Uninstall

### Remove in one command (default personal installation)

Run from the cloned repository:

```sh
npm run uninstall:all
```

This stops Slider Bar and removes its automatic launch registration, the `cdx-slider@personal` plugin, the default staged folder `~/plugins/cdx-slider`, and the development build at `dist/CDX Slider.app`. Repository source and saved profiles, memories, and checkpoints are preserved. Use the individual steps below for another installation path or marketplace. The marketplace listing may remain available for installation.

Preview without executing removal with `npm run uninstall:all -- --dry-run`. Finish save/resume operations before removal and close existing plugin tasks afterward to release remaining connections.

### Individual removal and data deletion


Finish any active save or resume operation first. The default removal preserves storage profiles, project registrations, memories, and checkpoints.

1. **Stop Slider Bar and remove automatic launch on macOS**. Run this from the cloned development repository; the staged plugin folder does not contain this npm script.

   ```sh
   npm run uninstall:companion
   ```

   If the development checkout is unavailable, run the following in Terminal. If the first command reports that the service is already unregistered, proceed with removing the plist. Resolve other permission errors before continuing.

   ```sh
   launchctl bootout "gui/$(id -u)/local.cdx-slider.companion"
   rm -f "$HOME/Library/LaunchAgents/local.cdx-slider.companion.plist"
   ```

   If a manually opened bar remains, use Quit in its app menu. Stop here to disable only automatic launch. Staging again on macOS registers automatic launch again; use `--without-companion` to keep it disabled.

2. **Remove the Codex plugin**. This command assumes the default personal marketplace. Replace `personal` if you installed from another marketplace.

   ```sh
   codex plugin remove cdx-slider@personal
   ```

   This removes the installed cache, leaving the staged source and saved data. If an existing task still has connected tools, close that task and check in a new one. Use `codex mcp remove cdx-slider` only if you separately registered the MCP-only setup.

3. **Optional: remove the app and staged folder**. Move the default `~/plugins/cdx-slider` folder to Trash in Finder; this also removes the Slider Bar inside it. Check the actual destination if you staged elsewhere. A development checkout's `dist/CDX Slider.app` is a separate copy. A retained personal-marketplace entry may still appear as available to install. Do not remove an entire marketplace used by other plugins.

4. **Optional: delete all saved data**. Close every Slider Bar and task using this plugin, back up anything needed, then move `~/.local/share/cdx-slider` to Trash. If `CDX_SLIDER_HOME` was configured, use that data location instead. This deletes memories, checkpoints, and project registrations across all storage profiles; it does not delete the registered projects' source files. Keep this folder to resume after reinstalling.

## MCP-only setup

For an environment that supports local MCP but not this plugin installation flow:

```sh
codex mcp add cdx-slider -- node /absolute/path/to/cdx-slider/dist/server.mjs
```

Replace the path with your built checkout. This registers only the MCP service; the skill must be installed separately. Avoid registering both the plugin and a duplicate MCP service.

## Updates

After installing a version that includes the updater, use the macOS menu bar **CDX → Check for updates…** to check and install a stable release. **CDX → Automatically install updates** enables automatic installation; it is off by default. While Codex and Slider Bar are running, the bar checks on startup and then periodically, with at least six hours between automatic attempts. Quitting the bar stops scheduled checks.

Updates come only from stable `vMAJOR.MINOR.PATCH` releases in `hwonheo/cdx-slider`, not every development push. The updater validates the exported file manifest, builds in a temporary folder, and replaces the staged plugin and bar together. Node.js 22.13+, npm, Git, and (for the macOS bar) Swift command-line tools must remain installed. The personal marketplace must point to the staged installation. Custom or Git marketplace installations are not updated by this local updater.

The bar restarts after installation. Open a new Codex task afterward; restart Codex manually if the old plugin remains loaded. Codex is never restarted automatically. Saved projects and checkpoints remain in their existing data directory.

From a source checkout, the same controls are available without opening the bar:

```sh
npm run update -- status
npm run update -- check
npm run update -- apply
npm run update -- auto-on
npm run update -- auto-off
```

Commands default to `$HOME/plugins/cdx-slider`; append an absolute staged-plugin path for another location. `auto-on` enables the bar's scheduler; it does not install a separate always-running scheduler on systems without the bar. Older installations need one manual build, staging, and plugin reinstall to acquire the updater.

Ordinary installation failures restore and reactivate the previous installation. If the updater or computer stops during replacement, recovery files are retained and further updates are blocked. Run `npm run update -- recover` from a source checkout to restore/reactivate the saved installation. If reactivation also fails, the old files remain available; inspect the reported error before retrying. Status, diagnostic logs, and recovery records are under `$CDX_SLIDER_HOME/updates` (default `~/.local/share/cdx-slider/updates`). The source checksums detect modified files; authenticity relies on HTTPS and control of the official GitHub repository, not a separate signing key.
