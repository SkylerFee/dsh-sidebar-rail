# Usage guide

**[简体中文](usage.zh.md)** | English

This guide describes version 0.4.0 (source commit `de05173` on 2026-11-11). 0.4.0 has not been published to npm yet; when installing any published version, rely on what that version actually offers. See [README](../README.md#install) for installation and toggling, and the [acceptance report](desktop-audit-2026-11-11.md) for results and unverified paths from this round.

Screenshots were captured on 2026-11-11 against macOS Desktop `0.2.2-rc.1` with a Chinese UI, using **Catppuccin Latte** (light) and **Catppuccin Frappé** (dark). Each pair below keeps the whole icon rail and the flyout bounds shown; long lists appear twice, at the top and at the scrolled end. Business names and amounts are blurred, non-plugin page content is masked, and controls, times, groupings, state icons and action entries are not redrawn. Images open at full size; the [screenshot index](images/README.md) records scenes and coverage.

## Revealing and retracting

On **macOS Desktop, with the host sidebar collapsed and a viewport at least 768px wide**, the icon rail sits hidden against the left edge of the window. Focus the DSH window first, then move the pointer into the **12px left-edge hot zone** below the window controls to reveal the **56px icon rail**.

From top to bottom: workspaces, scheduled tasks, plugins, more, with account and settings at the bottom. Hovering an icon opens its flyout after about 120ms; moving away closes it after about 200ms. Clicking a session or panel entry navigates and retracts the rail. Clicking a top icon opens the host sidebar or panel directly, which is a different purpose from hovering to browse a flyout.

After switching to another application the rail retracts; coming back to DSH needs the hot zone again or keyboard focus. When the host sidebar is expanded, the viewport narrows below 768px, or you use the Web client, the plugin draws no rail and you keep using host navigation.

The rail in the screenshots is shown revealed; it is hidden by default and is not a permanent sidebar. Flyouts currently do not reach the full height described by the spec, so the blank area under a short flyout is real behaviour — see the acceptance report.

## Workspaces and projects

The workspace flyout orders pinned projects, then projects, then recent sessions. Clicking a section title folds or unfolds that group.

| Control | Action and result |
| --- | --- |
| Project name / folder | Clicking anywhere on the row expands or collapses that project's sessions; the folder icon follows the expanded state |
| `+` on the project row | Starts a new session under that project; it does not change the expanded state at the same time |
| Pin on the project row | Pins or unpins; pinned projects move to the upper section and do not appear twice in the normal project section, most recently pinned first |
| `+` beside the Projects title | Picks an existing directory and registers it as a project; it creates no directory on disk and does not navigate to the project. Cancelling registers nothing; on failure a hint appears and you can use the host's own add entry |
| Project sessions | Keep the host's member order; archived members are still listed and marked as archived; members with no summary produce no placeholder node |

A project with no displayable sessions shows an empty-state hint. The expanded state and pinned list are stored in the current client and survive closing the flyout or refreshing; **section folding is not stored** and resets to the default when reopened.

**Workspace overview**: three sections, the folder / new session / pin actions on a project row, and the Add project entry. The second half of recent sessions requires scrolling — see the next section.

<table>
  <tr><th>Light · Latte</th><th>Dark · Frappé</th></tr>
  <tr>
    <td><a href="images/workspace-light.png"><img src="images/workspace-light.png" alt="Light workspace overview: pinned projects, projects and recent sessions sections, plus Add project and row actions" width="330"></a></td>
    <td><a href="images/workspace-dark.png"><img src="images/workspace-dark.png" alt="Dark workspace overview: three sections and project actions, with the current session highlighted" width="330"></a></td>
  </tr>
</table>

**Expanded project**: the folder turns into its open state, child sessions are listed in host order, and the list ends with its own Show more. This round confirmed that closing and reopening keeps the project expanded while paging returns to the initial watermark; persistence across a refresh is covered only by offline storage tests.

<table>
  <tr><th>Light · Project sessions</th><th>Dark · Project sessions</th></tr>
  <tr>
    <td><a href="images/project-light.png"><img src="images/project-light.png" alt="Light expanded project: open folder, ten child sessions, Show more and the following project section" width="330"></a></td>
    <td><a href="images/project-dark.png"><img src="images/project-dark.png" alt="Dark expanded project: highlighted current child session, relative times and a project-scoped Show more" width="330"></a></td>
  </tr>
</table>

## Recent sessions, paging and marks

Recent sessions are ordered by update time descending, show relative times, and highlight the session the main view is displaying. Archived and subagent sessions stay out of the recent list. Both the recent list and each expanded project list keep **only the currently open blank session**; other blank sessions are hidden and no real data is deleted.

A list shows **10 non-blank sessions** by default, and Show more at the end adds another 10 each time; once everything is shown the button disappears. The recent list and each project count independently. Rows in the recent list that are running, waiting for input, completed but unread, or the current session can raise the watermark automatically; an expanded project list raises it only for the current session. The automatic ceiling is 50, so later rows need Show more. The current blank session always shows and does not consume an ordinary slot, so the first open may not be exactly 10 rows.

Paging lives only as long as one flyout opening; closing and reopening restores the default watermark. The old Recent count stepper and the plugin detail settings block have been removed.

The **clock** on a session row means the session is involved in an active scheduled task; in the current version it renders at the **row end**, which differs from the row-start position in the spec. When the row has a running, unread or waiting state dot, the dot takes precedence. The clock is absent while the task list is still loading or failed to load, and sessions stay browsable. Clicking the clock itself does not open the session; clicking the session title navigates. The verification boundary for the mark's position and the mutual exclusion rule is in the acceptance report.

Long lists scroll as one block inside a single content area, with section titles scrolling away with the content. Show more scrolls with the list instead of sitting in a fixed footer. See the [acceptance report](desktop-audit-2026-11-11.md) for how the speced flyout height differs from the current build.

**End of the recent list**: the screenshot shows all 10 sessions on this page plus Show more, with the clock visible at the right of the last row. Clicking Show more this round grew the list to 20 rows; the screenshot keeps the pre-click button and clock so the location is identifiable.

<table>
  <tr><th>Light · Recent sessions and paging</th><th>Dark · Recent sessions and paging</th></tr>
  <tr>
    <td><a href="images/recent-light.png"><img src="images/recent-light.png" alt="Light scrolled end: ten recent sessions with relative times, end-of-row task clock and Show more" width="330"></a></td>
    <td><a href="images/recent-dark.png"><img src="images/recent-dark.png" alt="Dark scrolled end: highlighted current session, task clock and the complete paging entry" width="330"></a></td>
  </tr>
</table>

## Scheduled tasks

The task flyout groups into running, paused and ended, with only running expanded by default. Each entry shows the task name and the timing information the host provides.

Clicking a task entry or Open panel at the bottom opens the host task panel; it never runs, pauses or deletes a task, and does not promise to locate one task's detail. Editing and management happen in the host panel.

A missing service, a failed response or a request past 5 seconds should show a failure hint, while a successful but empty result shows an empty state. See the [acceptance report](desktop-audit-2026-11-11.md) for this version's fast-switching loading issue and the default-closed section click limit; if loading never ends, close the flyout and reopen it.

**Default state**: only running is expanded, with Open panel at the bottom. The two active task names are blurred; their planned times are kept.

<table>
  <tr><th>Light · Default grouping</th><th>Dark · Default grouping</th></tr>
  <tr>
    <td><a href="images/tasks-default-light.png"><img src="images/tasks-default-light.png" alt="Light default task state: running list expanded, paused and ended collapsed, Open panel at the bottom" width="330"></a></td>
    <td><a href="images/tasks-default-dark.png"><img src="images/tasks-default-dark.png" alt="Dark default task state: planned task times and the three lifecycle groups" width="330"></a></td>
  </tr>
</table>

**All groups expanded**: shows the empty states for the paused and ended groups plus the bottom entry. Those two groups had no real entries this round, so their empty-state screenshots must not be read as verified paused or ended task rows. A default-closed section needs two clicks to expand (known K2). This is a **recorded decision**: the behaviour stays as-is by product request and is no longer tracked as a defect to fix.

<table>
  <tr><th>Light · All group content</th><th>Dark · All group content</th></tr>
  <tr>
    <td><a href="images/tasks-light.png"><img src="images/tasks-light.png" alt="Light fully expanded tasks: running entries, paused and ended empty states, complete bottom entry" width="330"></a></td>
    <td><a href="images/tasks-dark.png"><img src="images/tasks-dark.png" alt="Dark fully expanded tasks: content of all three groups and Open panel, with the flyout grown to its content" width="330"></a></td>
  </tr>
</table>

## My plugins

The plugin flyout has an enabled and a disabled section. Disabled means an installed user plugin that is switched off; host built-ins and uninstalled recommended plugins are not listed. Entries show the plugin name and version information when available, and an empty section says so.

Clicking an entry or Open panel opens the host plugin management page. The flyout has no enable switch; installing, enabling, disabling and uninstalling all happen on the host page.

This round showed 9 enabled user plugins with the disabled section empty; both screenshots keep the versions, the empty state and Open panel. No other plugin was toggled for the captures.

<table>
  <tr><th>Light · Two plugin sections</th><th>Dark · Two plugin sections</th></tr>
  <tr>
    <td><a href="images/plugins-light.png"><img src="images/plugins-light.png" alt="Light plugin list: nine enabled user plugins with versions, disabled empty state and Open panel" width="330"></a></td>
    <td><a href="images/plugins-dark.png"><img src="images/plugins-dark.png" alt="Dark plugin list: enabled and disabled groups both shown, bottom panel entry visible" width="330"></a></td>
  </tr>
</table>

## More

More lists the other panels the host provides, such as extension panels registered by the current profile; scheduled tasks and plugins already have dedicated entries and are not repeated. The content can therefore differ between profiles.

Expand sidebar restores the host's full sidebar, where native search, workspace management, the account menu and settings stay available.

<table>
  <tr><th>Light · More</th><th>Dark · More</th></tr>
  <tr>
    <td><a href="images/more-light.png"><img src="images/more-light.png" alt="Light More flyout: Expand sidebar, MCP connectors among other panels, and the account note" width="330"></a></td>
    <td><a href="images/more-dark.png"><img src="images/more-dark.png" alt="Dark More flyout: host extension panel entries and the complete note" width="330"></a></td>
  </tr>
</table>

## Account and settings

The bottom of the rail uses the host account avatar, falling back to a placeholder glyph when unavailable. The account flyout shows the main balance, bonus credit and the usage and top-up links as the data allows; when the main balance cannot be read it says the balance is unavailable, which does not mean zero. Signed out shows a sign-in hint.

These values are read when the component mounts and are not guaranteed to refresh live. Links open in a new window; sign-in, sign-out, payment and full account details are handled by the host or the target page. To open settings, click Expand sidebar and then the settings entry at the host sidebar's bottom left.

This round used a signed-in account; the screenshots include the balance and bonus labels, the usage and top-up links and the settings path, with amounts blurred. No payment flow was opened and no account was signed out for the captures.

<table>
  <tr><th>Light · Account and settings</th><th>Dark · Account and settings</th></tr>
  <tr>
    <td><a href="images/account-light.png"><img src="images/account-light.png" alt="Light account flyout: blurred balance and bonus credit, usage and top-up links, settings path and Expand sidebar" width="330"></a></td>
    <td><a href="images/account-dark.png"><img src="images/account-dark.png" alt="Dark account flyout: complete account information area, bottom settings note and host sidebar entry" width="330"></a></td>
  </tr>
</table>

## Keyboard

| Key | Purpose |
| --- | --- |
| `Tab` / `Shift+Tab` | Moves focus between icons and operable entries; focusing an icon reveals the rail and its flyout |
| `↓` / `→` on a top icon | Enters the first focusable control of that flyout |
| `Enter` / `Space` | Activates the focused button; on a top icon it navigates directly, on a project row it expands or collapses |
| `Escape` inside a flyout | Closes the flyout and returns focus to the trigger icon |

Focus moving between the rail and its flyout keeps both open; focus leaving both retracts them together. When the system is set to reduce motion, the rail slide and flyout entrance animation are disabled.

## Local data and troubleshooting

Preferences live in the current client's `localStorage['dsh.sidebar-rail.v1']` and hold only `pinnedWorkspaceIds` (pinned projects) and `expandedProjectIds` (expanded projects). The host owns the sidebar collapse state, and account profile and balance are never written to these preferences. A `recentCount` from older data is no longer read.

| Symptom | What to do |
| --- | --- |
| No rail | Focus DSH, confirm macOS Desktop, the plugin enabled, the sidebar collapsed and width ≥ 768px, then move into the left-edge hot zone |
| A session is not in the first 10 | Scroll to the end of its list and click Show more; also check the blank, archived and subagent filtering rules |
| Tasks keep loading, or no clock appears | Close and reopen the flyout, and use the host task panel if needed; see the acceptance report for the current fast-switching defect |
| Add project fails | Use the host add path from the hint; cancelling a picker never counts as a successful registration |
| The Add project dialog is in English | Known defect outside this plugin: the host hard-codes the title (`Select Workspace Directory`) and `NSOpenPanel.message` is not localized by the system. Picking a directory still registers the project |
| Balance or avatar missing | Rely on the host account page; never attach account credentials or balance screenshots to a report |
| The plugin breaks navigation | Expand the native sidebar, open plugin management and disable it, keeping the host version, plugin version and reproduction steps |

Screenshots only describe the appearance and content of the scene they capture; real network failures, signed-out accounts, every session state and other platforms are covered by the [acceptance report](desktop-audit-2026-11-11.md).
