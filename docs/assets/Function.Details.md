# Feature details

[한국어](Function.Details.ko.md) · [Installation](Installation.md) · [Documentation](../README.md)

## Why use CDX Slider?

Ever started a new conversation and had to explain what you finished and what comes next? The same thing can happen when you change accounts.

CDX Slider saves that explanation for you. Save your work summary before leaving, then load it in your next conversation.

For example: “The login screen is done. Next, add password reset.” A saved work summary like this is called a **checkpoint**.

## Save and resume work

Keep a record for each project so the next conversation knows what you have done and what remains.

A checkpoint holds your goal, progress, decisions, and next steps. Each save adds a new record. Resume reads the latest one. You can also keep separate project notes for rules you want to remember.

Projects belong to **storage profiles**: names you choose, such as “Personal” or “Team.” These are separate from your Codex login. To use a project from another profile, explicitly share it with that profile.

The next conversation reads your summary; it does not recover the original chat. Supply any missing details and files it needs.

## Conversation panel

Use buttons to save and resume without remembering commands.

1. Choose your project. For a new one, select **Register project**.
2. Before leaving, select **Save this conversation**.
3. Wait for the agent to confirm that it saved your work.
4. In a new conversation, choose the same project and select **Resume saved work**.

A button sends a request to the agent. Clicking it does not mean the save is complete.

The interface starts in English. Choose **KR** for Korean. Your own notes and summaries are not translated. Set the panel and bar languages separately.

Your app must support MCP Apps to display the panel. Save and resume buttons are unavailable if the app cannot deliver messages.

## Account and usage

If you use several accounts, you may want to check which one is signed in and how much usage remains.

CDX Slider reads the Codex login and usage information on this computer. It may differ from the account in the desktop app. Workspace lookup shows the returned ID, not its name or a list of all workspaces.

Checking usage does not start an AI task or spend reset credits. A failed lookup is shown as a failure, not as zero remaining usage.

Commands for checking an already signed-in CLI profile are in the technical notes below.

## Sign in and restart

When you need another account, use the **Switch** tab to start sign-in. You can check progress or cancel. Sign-in takes place on the official authentication page.

A successful sign-in does not mean the desktop app has switched accounts too. Check the app yourself.

Before restarting, you must confirm that your work is saved and running tasks have stopped. The confirmation box starts unchecked.

A scheduled restart waits 15 seconds. You can cancel before the quit request is sent; closing the panel does not cancel it. **Restart affects every open task.**

## macOS bar

In a long conversation, the save button can scroll out of view. The optional macOS bar keeps project actions in a separate window.

Choose a project and select the conversation to link. The bar does not automatically detect the conversation on screen.

- **Open CDX Slider:** opens a standalone control panel inside Codex directly, without changing the clipboard or requiring a linked conversation. It passes the selected profile and project. Register projects and inspect checkpoints here; use the panel inside the relevant conversation to save or resume that conversation. Requires Codex support for MCP app deep links and global entrypoints.
- **Save:** after confirmation, copy a request and open the linked conversation. Paste and send it yourself.
- **Resume:** send a request to the linked conversation using the experimental feature below.

With automatic startup installed, the bar appears when Codex starts and hides when Codex exits. If you close just the bar window, reopen it through **CDX → Show bar**. If you quit the bar app, launch it yourself or wait until your next login.

You can change its language and transparency. Both settings are kept for the next launch.

## Resume from the bar — experimental

This feature aims to save you the copy-and-paste step. Select **Resume** in the bar to send a request through the conversation panel.

The panel must be open in the same conversation linked to the bar. Without that connection, the request cannot be sent. “Delivered” means the app received it; check the agent’s reply to confirm it is ready to continue.

Further checks are needed to establish whether this keeps working when the panel is in the background in Codex. It is still experimental.

## CLI

If you prefer a terminal or cannot use the panel, you can save and resume with commands. You can also export a Markdown document to continue in another tool.

This example uses a separate demo folder. Run it from the source checkout.

```sh
export CDX_SLIDER_HOME="$PWD/.local/demo"
node bin/cdx-slider.mjs profile add personal Personal
node bin/cdx-slider.mjs profile add team Team
node bin/cdx-slider.mjs project add demo personal "$PWD" Demo
node bin/cdx-slider.mjs checkpoint save demo personal examples/checkpoint.json
node bin/cdx-slider.mjs project grant demo personal team
node bin/cdx-slider.mjs resume demo team
node bin/cdx-slider.mjs export demo team /tmp/cdx-slider-handoff.md
```

For real use, replace the sample checkpoint with your own work. Run `node bin/cdx-slider.mjs --help` for all commands.

Attach the exported document to ChatGPT or another tool yourself. Nothing is uploaded automatically. Provide any needed code and files separately. Export will not overwrite an existing file.

## Where your data stays

Work records live in a separate folder so you can keep using them after changing accounts or reinstalling the plugin.

The default location is `~/.local/share/cdx-slider`. Removing the plugin leaves your records in place. They do not sync automatically to other computers.

Records are not encrypted, and passwords or tokens are not automatically removed. Do not save them. Separate profiles do not stop other programs running as the same OS user from reading the files.

Stop all running Slider processes before backing up, moving, or deleting the data folder.

## Technical notes

You do not need to change these settings for everyday use.

<details>
<summary>Storage and panel behavior</summary>

- Checkpoints are appended; project notes are updated by key. Saved content is reference material for the agent, not instructions to execute.
- Conversation IDs, sidebar state, and ChatGPT built-in memory are not restored. Git records include branch, commit, and project-scoped file status, not file contents or full transcripts. `workspaceChanged: false` does not guarantee identical file contents.
- Save asks the current conversation’s agent to create a checkpoint. The panel does not read the full conversation or copy an earlier checkpoint itself.
- The panel does not modify Codex’s toolbar or sidebar. The app controls display modes. It does not enter picture-in-picture (PiP) automatically; unsupported controls are hidden. Collapsing and expanding preserve selection.
- Language preferences are stored on the device, but app storage restrictions may prevent the panel from keeping them.

</details>

<details>
<summary>Account lookup, sign-in, and restart</summary>

Register the Codex home of an already signed-in CLI profile to check it:

```sh
node bin/cdx-slider.mjs profile add cli-work Work "$HOME/.codex-profiles/work"
node bin/cdx-slider.mjs usage cli-work
node bin/cdx-slider.mjs usage
```

- Lookups use App Server read calls. They do not sign in or out; Codex manages its authentication cache. Set `CDX_CODEX_BIN` to choose an executable.
- Results distinguish `ok`, `signed_out`, `unavailable`, `timeout`, and `error`. Separate usage limits remain separate. This does not cover all ChatGPT web model limits.
- Profile names do not verify account identity. Account information and tokens are not automatically saved in checkpoints.
- Sign-in uses OAuth at HTTPS `auth.openai.com`. Pending state stays in memory and expires after five minutes. It does not copy credentials, sign out the old account first, or change workspace policy.
- Restart is scheduled on the server. The macOS helper verifies the app and bundle ID, then reopens it only after graceful exit. It does not force-quit after a 30-second timeout.

</details>

<details>
<summary>Bar and experimental request delivery</summary>

- NSWorkspace notifications detect Codex launches and exits. When Codex exits, the window, menu icon, and backend stop. If installed, the launch watcher waits without running Node/App Server.
- Stable profile, project, and conversation IDs distinguish items with the same name. App Server only reads conversation information; it does not call `thread/resume` or `turn/start`.
- Project links live in `companion.json`; language and transparency live in macOS preferences. Transparency ranges from 0–60%, including text and buttons. The app uses Node/Codex paths from build time; rebuild if those executables move.
- Delivery requires a rendered panel and thread, profile, project, and path verified for the current task. It uses the panel’s MCP Apps `sendMessage`.
- The panel polls each second. Only panels responsive within six seconds can receive requests. Unreceived requests expire after 15 seconds. A new panel replaces the previous one for the same context.
- Received requests are never redelivered or sent to another context. Uncertain delivery is not retried.
- Mock tests do not verify real background delivery or agent replies. After updating tools, reconnect the MCP service and open a new panel.

</details>

<details>
<summary>Data paths and permissions</summary>

- `CDX_SLIDER_HOME` changes the data location independently of `CODEX_HOME` and the plugin cache. Data does not sync automatically across OS users either.
- Database files default to `0600`; new data folders use `0700`. Codex authentication and session databases are not shared or linked.
- CLI `call <tool> <json-file>` calls the same tools as MCP.
- This is a local stdio service. Remote deployment needs authentication, project permissions, storage, and deployment design. Profile names cannot serve as remote credentials.

</details>
