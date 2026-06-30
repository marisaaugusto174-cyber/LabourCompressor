# TagVision Entry, Launcher, and Finder Polish Design

## Goal

Fix four current review workflow problems without changing tagging, scanning, sorting, Plyr playback, or accepted-result data formats.

## Confirmed Changes

1. `/` entry page must match the current Liquid Glass visual language and provide an obvious path back to `/review.html`.
2. Review UI modules should feel rounder. Main surfaces use larger shared radii; controls and inner surfaces use consistent medium radii.
3. The macOS launcher must always start the server from the current launcher directory instead of reusing a stale process.
4. The launcher must not blindly kill every process on port `4312`. It may stop only a process that is verifiably a TagVision server.
5. If port `4312` is held by a non-TagVision process, the launcher exits with a clear safety message.
6. The launcher should not keep the Terminal open as the thing holding the background process; it starts TagVision detached, writes logs, opens the browser, and exits.
7. The local folder picker must no longer run `tell application "Finder" to activate`, because that raises all Finder windows. It should call the system choose dialog directly.

## Safety Boundary

The launcher treats a process as safe to stop only when both conditions are met:

- its command line contains `node apps/web/server.ts`;
- its current working directory is either the launcher directory or a directory whose `package.json` has `"name": "tagvision-macos"`.

If those checks fail, the launcher refuses to kill the process.

## Non-goals

- No auto `git pull`.
- No new app bundle or LaunchAgent in this pass.
- No backend API changes.
- No changes to review data, accepted sidecars, or taxonomy snapshots.
