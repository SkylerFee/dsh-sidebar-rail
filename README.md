# dsh-sidebar-rail

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An **additive** icon rail for the [DeepSeek Harness](https://github.com/SkylerFee/deepseek-harness) sidebar on **macOS Desktop**.

On macOS the host folds the left column to zero width and clips it (`AppFrame: collapsedWidth = darwin ? 0 : 56`, plus `overflow: hidden` on the column), so the shipped build leaves no rail behind. This plugin fills exactly that one gap: while the sidebar is collapsed it draws a 56px rail on the left edge — Workspaces / Scheduled tasks / Plugins / More, plus an account seat at the foot. Hovering an entry opens its list after 120ms; leaving closes it after 200ms; `Escape` closes it too.

- **Additive**: never replaces the host `sidebar` slot, never touches the host's grid columns, never overrides host styles.
- **Every other state renders nothing**: the expanded sidebar and the Web build stay entirely the host's.
- Workspace pinning lives in `localStorage`; the collapse state belongs to the host — this plugin only reads it.

## Support matrix

| Environment / state | Behaviour |
| --- | --- |
| macOS Desktop, sidebar collapsed, viewport ≥ 768px | Draws the 56px floating rail (the plugin's only rendering branch) |
| macOS Desktop, sidebar collapsed, viewport < 768px | Renders nothing. The host keeps its own reopen control in `shell.leading`, so no way back is lost |
| macOS Desktop, sidebar expanded | Renders nothing. Search, view options, add-workspace, the settings seat and the account menu all stay shipped behaviour |
| Web (any platform) | Renders nothing. The Web build already ships its own 56px collapsed rail, so a second one would be a duplicate |
| Windows / Linux | Untested; renders nothing |

The decision is a pure function of three inputs, unit-tested in `test/data.test.mjs`:

```
platform === 'darwin'  &&  host sidebar collapsed  &&  viewport width >= 768
```

768 = 680 (the host's content floor) + 56 (rail) + 32 (breathing room).

## Install

The plugin is a bundle patch plus a client module (`dsh.bundle` + `dsh.client` in `package.json`). Install it into a DSH profile with `plugin_manager`:

```
plugin_manager  action: install_bundle
                target: @skylerfee/dsh-sidebar-rail      # published package
                # or: target: <absolute path to this repo>
```

Reload the page afterwards so the client module loads. Remove it with `plugin_manager action: remove_bundle`, or switch it off with `set_bundle enabled: false`.

## Features

| Entry | Behaviour |
| --- | --- |
| Workspaces | Rail entry keeps the shipped 36×36 button shape (20px glyph, `aria-label`); the flyout lists pinned projects, then projects, with recent sessions in the foot |
| Scheduled tasks | `remote.schedule.catalog()`, active tasks only; failure and empty states offer "Open panel" |
| Plugins | `remote.pluginInventory.list()`, skipping rows explicitly marked `enabled: false`; failure and empty states offer "Open panel" |
| More | "Expand sidebar" plus the remaining `sidebar.panellist` entries (read-only subscription) |
| Account | Explains that account and settings live in the host sidebar, and offers "Expand sidebar" |
| Pinning | In-row pin button; pinned projects lead the list and persist to `localStorage['dsh.sidebar-rail.v1'].pinnedWorkspaceIds` |
| Recent sessions | `updatedAt` descending, archived / blank / subagent sessions dropped, capped at 10 (the flyout foot shows the first 5) |

## Layout

```
dsh-sidebar-rail/
├─ client.js            # all UI logic (a __ModuleLoader__ static module)
├─ index.js             # host half (empty apply; install/display only)
├─ cordis.patch.yml     # bundle patch, inserts one row
├─ package.json         # dsh.bundle + dsh.client declarations
├─ locale/{en,zh}.json  # plugin-manager metadata
├─ icon.svg             # plugin icon (original)
├─ test/data.test.mjs   # pure-logic tests, sliced out of client.js
├─ test/client-registration.test.mjs # static bundle registration under the full package name
└─ docs/
   ├─ PRD.md            # requirements, interaction spec, acceptance checklist
   ├─ design.md         # architecture, constraints, data sources, known gaps
   ├─ verify.md         # verification log, including what stayed untested
   └─ desktop-validation-2026-11-04.md
```

## Known limitations

1. **The rail floats above the main column.** The host's collapsed column is zero-width with `overflow: hidden`, so the rail can only be `createPortal(document.body)` + `position: fixed`; it cannot be put back into the host grid. Below a 768px viewport it is not rendered at all, so it never sits on top of the conversation copy.
2. **The top 48px stay empty.** The macOS traffic lights (x ≈ 16–68) and the host's own reopen / new-session controls in `shell.leading` (`left: 88px`) occupy the `--dsh-frame-top-clearance` band, so the rail starts at 48px.
3. **Windows / Linux are untested.** The plugin renders nothing there and claims no support.
4. **Pinning is a local concept.** The host has no field for it, so clearing `localStorage` or switching browsers loses it.
5. **Task and plugin lists depend on optional remote services.** When the service is missing, unauthorized, or slow to answer (5s), the flyout shows a failure line plus "Open panel".
6. **No account data is copied.** Account details and usage stay in the host settings page.
7. **The plugin deliberately ships no expanded-column UI.** Replacing the host sidebar would unmount the host's settings shell, which makes Settings unreachable — including its shortcut.

## Development

```bash
npm test               # node --test test/*.test.mjs — 13 cases
npm run check          # scripts/check.mjs (repo rules) + node --check on both entries + tests
npm run hooks:install  # enable .githooks: pre-commit runs check, commit-msg enforces conventional commits
```

The logic tests slice pure helpers out of `client.js` between `#region` markers to cover grouping, pinning order, the recent-session cap, data normalisation, relative-time wording, locale resolution and the rail's render predicate. A separate registration test executes the complete static script against the host loader facade and requires its factory ID to match the complete package name, including the scope. Rendering and slot registration still require Desktop validation.

`scripts/check.mjs` carries the rules a linter would own here (region markers, manifest consistency, banned patterns, i18n key parity); [CODING_STANDARDS.md](CODING_STANDARDS.md) carries the judgement calls a script cannot express, and is what a reviewer reads.

## Docs

- Requirements and acceptance: [docs/PRD.md](docs/PRD.md)
- Design and constraints: [docs/design.md](docs/design.md)
- Verification log: [docs/verify.md](docs/verify.md)
- 中文说明: [README.zh.md](README.zh.md)

## License

MIT © 2026 SkylerFee — see [LICENSE](LICENSE).
