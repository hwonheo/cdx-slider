# Acceptance checks

[한국어](acceptance.ko.md) · [Documentation](../README.md)

Automated tests restore saved state across different `CODEX_HOME` values and fresh MCP processes. They do not replace live checks of desktop sign-in, workspace selection, panel rendering, or agent completion. Use a test project whose context may be shared between the selected profiles.

## Installation and panel

1. Install and enable the plugin, then open a new Codex task.
2. Invoke `$cdx-slider:slider-continuity` without another request. It should call `slider_panel`; opening the panel must not save, sign in, or restart Codex.
3. Confirm the panel actually renders. Tool success and advertised UI support alone are insufficient.
4. Ask to list registered profiles and projects, and verify `profiles_list` and `projects_list` return data. An empty initial registry is valid.
5. If tools are missing, inspect plugin enablement and the configured Node/server paths. Report the missing connection instead of repeatedly changing the invocation wording.

## Language and controls

1. With no saved language preference, confirm EN is selected.
2. Select KR, then reload. The choice should persist when browser storage is available. If storage is blocked, changing language should still work during the current session.
3. Confirm labels, accessible names, statuses, and dates follow the selected language. User-authored project names and checkpoint text must remain unchanged.
4. Check keyboard tab navigation and a narrow panel. Unsupported host actions should be disabled with an explanation.
5. In the native bar, select the language separately from the CDX menu. Verify projects with identical names and projects shared between profiles keep distinct identities.

## Personal and team workspaces

1. Register `personal` and `team` storage profiles. These names are not verified account or workspace IDs.
2. Register a permitted test project under `personal`.
3. Save a checkpoint containing a decision and a concrete next step. Confirm tool success rather than only request delivery.
4. Share that project with `team` using `project_grant`.
5. Save and stop active work, then change the account/workspace through the official sign-in flow. Local OAuth completion does not prove the running desktop switched.
6. In a new connected task, call `project_resume` for `team`.
7. Compare the goal, decisions, next steps, and actual file access.

For two separate personal accounts, repeat with `account-a` and `account-b` on the same OS user and `CDX_SLIDER_HOME`. Record whether the plugin needs to be enabled again after switching accounts.

## Sharing, usage, and handoffs

- An unshared project must be absent from another profile's list and its resume request must fail. Do not silently retry using a different profile. This tests application sharing rules, not OS-user isolation.
- Register existing signed-in CLI homes and run `usage`. Compare with the same account at a similar time. Failed or unknown readings must not appear as zero usage; separate quotas must remain separate.
- Inspect an exported Markdown handoff before attaching it manually in ChatGPT. Provide needed files separately. Restoring native conversations or built-in memory is not a success criterion.

## Native relay and restart

- Link a native-bar project to a verified task, and open a rendered panel with that current `threadId`. Check resume delivery and the actual agent response separately. Repeat with a background or collapsed panel; uncertain deliveries must not resend automatically.
- Restart consent starts unchecked. Test countdown and cancellation in a mock host first. A real restart requires explicit confirmation that all tasks are saved and stopped. No live account switch or restart is implied by these instructions alone.

## Record results

Record app version, profile type, panel availability, tool responses, saved-context consistency, actual file access, and remaining unverified behavior. Observe sidebar/conversation continuity separately. Never record passwords, tokens, cookies, or OAuth URLs.
