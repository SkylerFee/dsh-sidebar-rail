**[English](README.md)** | [简体中文](README.zh.md)

# dsh-sidebar-rail

[![CI](https://github.com/SkylerFee/dsh-sidebar-rail/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/SkylerFee/dsh-sidebar-rail/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Node: >=22.19](https://img.shields.io/badge/Node-%3E%3D22.19-brightgreen.svg)](https://nodejs.org) [![Release: v0.4.0](https://img.shields.io/badge/release-v0.4.0-orange.svg)](https://github.com/SkylerFee/dsh-sidebar-rail/releases) [![npm downloads](https://img.shields.io/npm/dt/@skylerfee/dsh-sidebar-rail.svg?label=npm%20downloads)](https://www.npmjs.com/package/@skylerfee/dsh-sidebar-rail) [![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

Reach workspaces, recent sessions, scheduled tasks, plugins and your account while the DeepSeek Harness sidebar is collapsed on macOS Desktop.

The rail starts hidden. Focus the DSH window and collapse the host sidebar, then move the pointer into the 12px strip along the window's left edge to reveal a 56px icon rail. Hover an icon to browse its flyout and choose an entry to navigate. Expanding the sidebar keeps the host's search, workspace tree, account menu and settings.

<a id="screenshots"></a>
## Screenshots

Captured on macOS Desktop `0.2.2-rc.1` on 2026-11-11, using Catppuccin Latte (light) and Frappé (dark). Each preview combines real workspace and plugin captures; business names are blurred and unrelated conversation content is masked. See the [usage guide](docs/usage.md) for full feature screenshots, pagination, tasks and account details.

<table>
  <tr><th>Light preview · Latte</th><th>Dark preview · Frappé</th></tr>
  <tr>
    <td valign="top"><a href="docs/images/preview-light.png"><img src="docs/images/preview-light.png" alt="Light overview: complete icon rail, pinned projects, projects, recent sessions, plugin groups and Open panel" width="360"></a></td>
    <td valign="top"><a href="docs/images/preview-dark.png"><img src="docs/images/preview-dark.png" alt="Dark overview: workspace and plugin flyouts; expanded projects, pagination and other entries are documented in the usage guide" width="360"></a></td>
  </tr>
</table>

## Navigation

[Screenshots](#screenshots) · [Install and manage](#install) · [Usage](#usage) · [Preferences and local data](#preferences) · [Troubleshooting](#troubleshooting) · [Development and contributions](#development) · [Documentation](#docs)

<a id="support"></a>
## Support

| Environment / state | Behaviour |
| --- | --- |
| macOS Desktop, sidebar collapsed, viewport width ≥ 768px | Hidden rail, revealed by the edge strip or keyboard focus |
| macOS Desktop, sidebar collapsed, viewport width < 768px | No rail; the host button still expands the sidebar |
| macOS Desktop, sidebar expanded | No rail; the host sidebar remains available |
| Web, any platform | No rail; the host keeps its existing collapsed rail |
| Windows / Linux Desktop | No rail; support is untested |

Recorded Desktop checks used macOS Desktop `0.2.2-rc.1`. See `peerDependencies` in [package.json](package.json) for other compatible host versions. Version 0.4.0 is a full rewrite that ships the TypeScript source, the host-native flyout model, paged session lists and the scheduled-task mark together; it has not been published to npm yet (the registry still shows 0.3.3). See the [current acceptance report](docs/desktop-audit-2026-11-11.md) for results and limitations. The published package ships prebuilt `lib/` entries, so installing it needs no compiler. Source development and checks require Node.js ≥ 22.19.0 plus `npm ci` and a build step (see [Development](#development)).

<a id="install"></a>
## Install and manage

Requires the DSH **Desktop or Web client** and a profile. Installation only affects that profile; it never modifies DSH itself.

### Option 1: Plugins page (recommended)

Open the **Plugins** page from the DSH sidebar, choose **Add plugin** in the top right, enter the package name in the field and press **Install**:

```
@skylerfee/dsh-sidebar-rail
```

That field accepts an npm package name, a Git repository address or a local directory; this plugin needs only the npm name. Restart or reload DSH when prompted, then confirm Sidebar rail is enabled.

The npm package ships the prebuilt `lib/index.js` and `lib/client.js`, so installing or upgrading needs no compiler, no `node_modules` in the consuming profile beyond the package itself, and no local build step. Installing straight from a Git checkout instead depends on the target package manager running this repository's build script; when it does not, build locally or install the published tarball.

### Option 2: Command line

```sh
dsh plugin --profile desktop add @skylerfee/dsh-sidebar-rail
```

`dsh plugin` forwards its arguments to pnpm inside the profile directory. Replace `desktop` with the profile you actually use; a first run initializes it. You can also run `pnpm add` directly in the profile directory. Restart DSH afterwards.

### Option 3: Ask the assistant

A profile with plugin management enabled can install it for you (this is a tool request, not a terminal command):

```json
{
  "action": "install_bundle",
  "target": "@skylerfee/dsh-sidebar-rail"
}
```

For local development, replace `target` with this repository's absolute path — that installs a `link:` dependency, so the profile loads whatever `lib/` currently contains. Run `npm ci` once and `npm run build` (or keep `npm run dev` watching) after changing `src/`, then restart.

### Disable and uninstall

Enabling is a profile configuration switch and belongs to the Plugins page; the command line only installs and removes packages.

| Operation | How |
| --- | --- |
| Disable | Turn off the Sidebar rail switch on the Plugins page (the dependency stays installed, so re-enabling is instant) |
| Enable again | Turn the same switch on |
| Uninstall | Choose **Uninstall** on the detail page, or run `dsh plugin --profile desktop remove @skylerfee/dsh-sidebar-rail` |

The assistant can also call `plugin_manager` with `set_bundle` (enable/disable) or `remove_bundle` (uninstall). Local preferences in `localStorage` (pinned projects, expanded projects) survive disabling or uninstalling.

<a id="usage"></a>
## Usage

See the [usage guide](docs/usage.md) for detailed operations, state descriptions and paired light / dark feature screenshots. Actual results and known issues are in the [acceptance report](docs/desktop-audit-2026-11-11.md).

1. Collapse the sidebar with the host button. Move the pointer to the window's left edge, below the window controls, to reveal the rail.
2. Hover an icon for about 120ms to open its flyout. Leaving closes the flyout after about 200ms. Moving between rail icons switches the flyout without retracting the rail.
3. Choose an entry to navigate and retract the rail. Expand the host sidebar for native search, settings or workspace management.

| Entry | Available actions |
| --- | --- |
| Workspaces | Three sections — pinned projects, projects, recent sessions. A project row expands to its own session list (host order, paged, archived rows still listed) and can start a new session; Add project registers a directory without navigating |
| Recent sessions | Listed at the foot of the workspace flyout, newest first, excluding archived and subagent sessions; of blank sessions only the current one is listed. Open an existing session and see its relative time and host-provided status mark. A trailing clock glyph marks a session that has an active scheduled task (shown only while that row has no status mark of its own) |
| Scheduled tasks | Three sections — running, paused, ended; only running opens by default. Choose a row or Open panel to enter the task panel |
| My plugins | Two sections — enabled, and installed but switched off; host bundles are excluded and no switch is offered. Choose a row to enter the plugin manager |
| More | Open other host panels or expand the native sidebar |
| Account and settings | See the host avatar and available balances, bonuses, View usage and Top up links; signed-out accounts get a hint; the flyout also names the path to the host Settings panel (expand the sidebar, then Settings at its foot); sign-in, sign-out and payment remain in the host or destination page |

Keyboard: `Tab` to an icon reveals the rail. On a top-row function icon, press `↓` or `→` to enter its flyout, then `Tab` through the list. `Escape` inside the flyout returns focus to its trigger, but currently reopens the flyout as a known issue. `Enter` activates the focused button like a click; activating an icon navigates directly rather than entering its flyout list.

<a id="preferences"></a>
## Preferences and local data

Session lists initially show **10 non-blank sessions**; **Show more** appends 10 more each time. Recent sessions raise their watermark for running, waiting, unread-completion and current rows; project lists raise it only for the current session and count independently. Automatic growth stops at 50, so later rows still require Show more. The current blank session stays visible without consuming a regular place.

Workspace, task and plugin flyouts scroll as one list: sections are groupings with a title row, so a long list scrolls as a whole and the titles scroll with it. Show more is an ordinary row at the end of the list; it does not sit in a fixed footer. Paging is not persisted: closing and reopening a flyout starts again at 10 rows. Filling the available window height is the design goal; see the [acceptance report](docs/desktop-audit-2026-11-11.md) for current positioning, height and section-folding limitations.

Preferences belong to this client and use `localStorage['dsh.sidebar-rail.v1']`:

| Field | Purpose |
| --- | --- |
| `pinnedWorkspaceIds` | Pinned workspace IDs, most recently pinned first |
| `expandedProjectIds` | Project rows whose session list is expanded; kept across flyout opens |

The host owns the collapse state; the plugin only reads it. Account and balance data come from host services and are not written to these preferences. Clearing client storage loses local settings. A store written by an older version may still contain a `recentCount` field; nothing reads it any more and it is left untouched.

<a id="troubleshooting"></a>
## Troubleshooting and limitations

| Symptom | Check or recovery |
| --- | --- |
| No rail after installation | Confirm macOS Desktop, the enabled plugin, a collapsed sidebar and viewport width ≥ 768px; the rail starts hidden and needs the left-edge strip |
| A recent session is missing | Choose Show more at the end of the list; archived and subagent sessions are excluded, and blank sessions are listed only while they are the current session |
| Task or plugin loading fails | Requests fail after 5s and show a retry state. The task list is shared by the workspace and task flyouts; switching between them while a request is still in flight now restarts the request instead of leaving it stuck |
| No avatar or balance | A missing avatar uses a fallback glyph; unavailable balances get a hint. Account data are read on component mount and are not guaranteed to refresh live; use the host account page for full details |
| Add project opens an English dialog | Known defect, out of this plugin's reach. The native chooser is the host's `NSOpenPanel`, and the host sets its message text to the hard-coded string `Select Workspace Directory` (`directory-picker-native`), which AppKit never localizes — so the title stays English while its buttons follow the system language. The plugin cannot override it: a Client-only module has no Node access to spawn its own chooser. Picking a directory still registers the project normally |
| A revealed rail covers the page's left edge | It is a temporary overlay that reserves no host grid space; the hidden default preserves the conversation tab entry, and moving the pointer away lets the rail retract |
| Sidebar rail unavailable or a boot import error | Keep the visible error and host diagnostics, disable the plugin through the native sidebar, and report the host version, plugin version and reproduction steps in this repository; omit credentials and conversation content |

The plugin keeps the expanded host sidebar and its column width, reserves space for macOS window controls and respects reduced-motion preferences. See the [acceptance report](docs/desktop-audit-2026-11-11.md) for screenshot coverage, interaction issues and unverified paths such as real remote failures and funded accounts.

<a id="development"></a>
## Development and contributions

```bash
npm ci                 # Install the dev toolchain from package-lock.json
npm run typecheck      # tsc --noEmit — strict type checking of src/ and tests
npm run build          # esbuild → lib/index.js and lib/client.js
npm run dev            # Same build in --watch mode
npm run test:unit      # tsx runs test/*.test.ts against src/ directly
npm run test:artifact  # Node runs test/*.test.mjs against the built lib/
npm test               # Unit tests → build → artifact tests
npm run check:source   # Source rules and dictionary checks
npm run check:artifact # Entry, file list, external module and registration checks
npm run check          # typecheck → check:source → test:unit → build → check:artifact → test:artifact
npm run hooks:install  # Optional: enable this repository's commit hooks
```

Scripts are defined in [package.json](package.json), which is authoritative; the list above mirrors it. Source lives in `src/` as TypeScript / TSX split by responsibility, and esbuild only transpiles and bundles — it does not type-check. `lib/` is a generated directory: it is not committed to Git and must be rebuilt after any `src/` change, so a local checkout is no longer "edit and it runs". Runtime dependencies remain zero: the client only requires the host-provided `react` / `react-dom`. The registration test requires the factory ID to match the full scoped package name. These checks do not replace real Desktop validation.

Use Conventional Commits for PR titles, with the summary, description and verification results in Simplified Chinese. Keep code identifiers and original diagnostics in English. Follow the [PR template](.github/pull_request_template.md) for the problem, changes, validation and unverified items; update both README languages when behaviour changes. UI, loading or registration changes require real environment and operation results in [docs/verify.md](docs/verify.md). See [AGENTS.md](AGENTS.md) and [CODING_STANDARDS.md](CODING_STANDARDS.md) for the full rules.

Follow [ADR-0003](docs/adr/0003-release-pipeline.md) to release: update and push the version, then create a GitHub Release tagged `v<version>`. `publish.yml` validates it and uses npm OIDC trusted publishing; the npm Trusted Publisher must allow direct publishing. Publishing runs `npm publish --ignore-scripts`, so no build hook fires inside it: the full `npm ci` + `npm run check` (which builds and validates `lib/`) must already have passed before the release is created.

<a id="docs"></a>
## Documentation

| Document | Content |
| --- | --- |
| [Usage guide](docs/usage.md) ([中文](docs/usage.zh.md)) | All entries, pagination, state marks and keyboard operations and paired light / dark feature screenshots |
| [2026-11-11 acceptance report](docs/desktop-audit-2026-11-11.md) | Current-source checks, Desktop evidence, findings and unverified paths |
| [Product requirements](docs/PRD.md) | Use cases, interactions and acceptance criteria |
| [Design](docs/design.md) | Additive registration, layout, data sources, cleanup and local storage |
| [Verification log](docs/verify.md) | Recorded results, historical defects and unverified paths |
| [Glossary](GLOSSARY.md) | Shared terms for the rail, sidebar, flyout and current session |
| [TypeScript migration](docs/typescript-migration.md) | Module layout, build protocol, test migration and staged plan |
| [Architecture decisions](docs/adr/) | Narrow-window eligibility, TypeScript source plus build toolchain ([ADR-0006](docs/adr/0006-typescript-source-and-build.md)) and release workflow |

## License

MIT © 2026 SkylerFee. See [LICENSE](LICENSE).

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)