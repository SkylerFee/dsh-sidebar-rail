/**
 * dsh-sidebar-rail — Client half.
 *
 * Adds the icon rail macOS Desktop otherwise lacks. The plugin is additive: the
 * shipped sidebar is never replaced, so search, view options, add-workspace, the
 * settings seat and the account menu all stay shipped behavior.
 *
 *   - macOS Desktop, column collapsed: a 56px icon rail (Workspaces, Tasks,
 *     Plugins, More) with an account seat at the foot; hovering an entry opens
 *     its list in a flyout beside the rail.
 *   - expanded, or any other platform: nothing is drawn. The host owns the
 *     expanded column, and the Web build already ships its own 56px collapsed
 *     rail, so this entry must not draw a second one.
 *
 * Contract notes (verified against the shipped client):
 *   - The rail is mounted from the frame-wide `shell.overlay` seat (a `list`
 *     slot owned by ui-layout), the same additive seat other plugins use for
 *     floating surfaces. Overlay entries receive no owner props, so the fold
 *     state comes from the `data-sidebar-collapsed` attribute the host publishes
 *     on the frame.
 *   - macOS Desktop folds the column to zero width and clips it with
 *     `overflow: hidden` (`AppFrame: collapsedWidth = darwin ? 0 : 56`), so the
 *     rail is portalled beside `#root` and pinned below the 48px window-chrome
 *     strip (`--dsh-frame-top-clearance`) that holds the traffic lights and the
 *     host's own reopen controls.
 *   - Standard hooks (`useSessions`, `useWorkspaces`, `usePanelInfo`) arrive as
 *     props; navigation and list actions come from injected services instead
 *     (`layout`, `uiWorkspace`, `remote`). The Host is never written to.
 *
 * Pinned workspaces live in this plugin's own localStorage key.
 */
window.__ModuleLoader__.load({
  id: '@skylerfee/dsh-sidebar-rail',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React
    const h = React.createElement

    /**
     * Subscribe to one of this plugin's own observable snapshots.
     * @param source - Object exposing getSnapshot/subscribe.
     * @param selector - Maps the snapshot to the subscribed slice.
     * @returns The selected slice.
     */
    function useObservable(source, selector) {
      const read = useCallback(() => selector(source.getSnapshot()), [source, selector])
      return useSyncExternalStore(source.subscribe, read, read)
    }

    /** Identity selector for whole-snapshot subscriptions. */
    const identity = (value) => value

    // #region pure-helpers
    /** Fallback list state, so a missing standard hook degrades instead of throwing. */
    const EMPTY_SESSIONS = { ids: [], byId: {}, phase: 'empty', projectionsBySession: {} }
    /** Fallback workspace state for the same reason. */
    const EMPTY_WORKSPACES = { items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'empty', error: null }

    /**
     * Pick a standard selector hook, falling back to a constant reader.
     * @param candidate - The hook injected by the framework, when present.
     * @param fallbackValue - Value the stand-in hook returns.
     * @returns A selector hook with the same call shape.
     */
    function selectorHook(candidate, fallbackValue) {
      if (typeof candidate === 'function') return candidate
      return (select) => (typeof select === 'function' ? select(fallbackValue) : fallbackValue)
    }

    /** Locale namespace owned by this plugin (must not collide with a host one). */
    const NS = 'sidebarRail'
    /** The plugin's only localStorage key. */
    const STORE_KEY = 'dsh.sidebar-rail.v1'
    /** Hover dwell before a flyout opens. */
    const OPEN_DELAY_MS = 120
    /** Grace period before a flyout closes while the pointer crosses the gap. */
    const CLOSE_DELAY_MS = 200
    /**
     * Narrowest viewport that still fits the rail beside a readable column.
     * 680 (host content floor) + 56 (rail) + 32 (breathing room both sides).
     */
    const RAIL_MIN_VIEWPORT = 768
    /** Give up on an optional remote call after this long; a hung Host call must
     * still end in the failure state instead of an endless "loading" line. */
    const REMOTE_TIMEOUT_MS = 5000
    /** Hard cap on how many recent sessions a row list may render. */
    const RECENT_LIMIT = 20
    /** Default for the `recentCount` preference: how many rows the flyout shows. */
    const DEFAULT_RECENT_COUNT = 5
    /** Bounds the preference may take; the settings input clamps to this range. */
    const MIN_RECENT_COUNT = 1
    const MAX_RECENT_COUNT = RECENT_LIMIT
    /**
     * Pending-interaction kinds the host paints as `warning`.
     *
     * `ui-workspace/tree.ts#visiblePendingKind` whitelists exactly these three;
     * every other declared domain key is navigation-irrelevant there, so the
     * rail must not turn amber for one either.
     */
    const VISIBLE_PENDING_KINDS = new Set(['approval', 'plan-review', 'question'])

    // ---------------------------------------------------------------- locale --
    const zh = {
      'rail.label': '导航图标轨',
      'rail.workspace': '工作区',
      'rail.tasks': '定时任务',
      'rail.plugins': '插件',
      'rail.more': '更多',
      'rail.account': '账号与设置',
      'rail.expand': '展开侧栏',
      'section.pinned': '置顶项目',
      'section.workspaces': '项目',
      'empty.recent': '还没有最近会话',
      'section.recent': '最近会话',
      'settings.title': '侧栏图标轨',
      'settings.recentCount': '最近会话条数',
      'settings.recentCountHint': '范围 1–20；超过可视高度时可滚动查看。',
      'status.ongoing': '运行中',
      'status.warning': '等待你的操作',
      'status.done': '已完成，未查看',
      'status.idle': '空闲',
      'section.tasks': '已创建的任务',
      'section.plugins': '我的插件',
      'section.panels': '其他面板',
      'pin.pin': '置顶项目',
      'pin.unpin': '取消置顶',
      'empty.workspaces': '还没有工作区',
      'empty.tasks': '还没有定时任务',
      'empty.plugins': '还没有安装自己的插件',
      'state.loading': '加载中…',
      'state.failed': '加载失败，可打开面板查看',
      'action.openPanel': '打开面板',
      'account.hint': '账号信息与用量由设置中的账号页提供。',
      'account.settingsPath': '设置：展开侧栏后点左下角「设置」。',
      'account.balance': '余额',
      'account.bonus': '赠金',
      'account.usage': '查询用量',
      'account.topUp': '充值',
      'account.balanceUnavailable': '余额暂不可用',
      'account.signedOut': '未登录。登录后可查看余额与用量。',
    }
    const en = {
      'rail.label': 'Navigation rail',
      'rail.workspace': 'Workspaces',
      'rail.tasks': 'Scheduled tasks',
      'rail.plugins': 'Plugins',
      'rail.more': 'More',
      'rail.account': 'Account and settings',
      'rail.expand': 'Expand sidebar',
      'section.pinned': 'Pinned projects',
      'section.workspaces': 'Projects',
      'empty.recent': 'No recent sessions yet',
      'section.recent': 'Recent sessions',
      'settings.title': 'Sidebar rail',
      'settings.recentCount': 'Recent count',
      'settings.recentCountHint': 'From 1 to 20; the list scrolls once it exceeds the visible height.',
      'status.ongoing': 'Running',
      'status.warning': 'Waiting for you',
      'status.done': 'Finished, unread',
      'status.idle': 'Idle',
      'section.tasks': 'Scheduled tasks',
      'section.plugins': 'My plugins',
      'section.panels': 'Other panels',
      'pin.pin': 'Pin project',
      'pin.unpin': 'Unpin project',
      'empty.workspaces': 'No workspaces yet',
      'empty.tasks': 'No scheduled tasks',
      'empty.plugins': 'No plugins of your own yet',
      'state.loading': 'Loading…',
      'state.failed': 'Could not load; open the panel instead',
      'action.openPanel': 'Open panel',
      'account.hint': 'Account and usage details live in the Settings account page.',
      'account.settingsPath': 'Settings: expand the sidebar, then choose Settings at its foot.',
      'account.balance': 'Balance',
      'account.bonus': 'Bonus',
      'account.usage': 'View usage',
      'account.topUp': 'Top up',
      'account.balanceUnavailable': 'Balance unavailable',
      'account.signedOut': 'Signed out. Sign in to see balance and usage.',
    }

    // --------------------------------------------------------------- storage --
    /**
     * Read the persisted rail state.
     * @returns Parsed state, or an empty object when absent or unreadable.
     */
    function readStore() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? 'null')
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    /**
     * Merge a patch into the persisted rail state.
     * @param patch - Partial state to merge.
     * @returns Nothing. Storage failures only cost persistence.
     */
    function writeStore(patch) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...readStore(), ...patch }))
      } catch {
        // A blocked storage backend must never break rendering.
      }
    }

    // ------------------------------------------------- shared preference store --
    // The recent-session count has two surfaces (the plugin detail page and the
    // rail's flyout). They used to keep one `useState` each and read the value
    // once at mount, so editing in one place left the other showing — and then
    // writing back — a stale number: setting 8 on the detail page and pressing
    // "+" in the flyout persisted 7. One module-level store fixes both the stale
    // read and the clobbering write: every surface subscribes to the same value,
    // and `recentCount` is always re-read from storage before it is written.
    /** Current `recentCount`, or undefined before the first surface reads it. */
    let recentCountSnapshot
    /** Surfaces listening for a `recentCount` change. */
    const recentCountListeners = new Set()

    /**
     * Read the persisted `recentCount`, clamping whatever storage held.
     * @returns An integer between MIN_RECENT_COUNT and MAX_RECENT_COUNT.
     */
    function readRecentCountFromStore() {
      return readRecentCount(readStore().recentCount)
    }

    /**
     * Publish a new `recentCount` to every surface and to storage.
     *
     * Storage is re-read before the merge so a concurrent writer cannot be
     * clobbered by a value this surface merely had in memory.
     * @param next - Requested count; clamped before it is written.
     * @returns The clamped value that was published.
     */
    function setRecentCount(next) {
      const value = readRecentCount(next)
      recentCountSnapshot = value
      writeStore({ recentCount: value })
      for (const listener of recentCountListeners) listener()
      return value
    }

    /**
     * Subscribe to `recentCount` for `useSyncExternalStore`.
     * @param listener - Called after every publish.
     * @returns Unsubscribe function.
     */
    function subscribeRecentCount(listener) {
      recentCountListeners.add(listener)
      return () => { recentCountListeners.delete(listener) }
    }

    /**
     * Read the current `recentCount` snapshot.
     *
     * The first call materialises from storage so two surfaces mounted in the
     * same session agree immediately. Once published, the in-memory snapshot is
     * authoritative: storage can only change through this module.
     * @returns An integer between MIN_RECENT_COUNT and MAX_RECENT_COUNT.
     */
    function getRecentCountSnapshot() {
      if (recentCountSnapshot === undefined) recentCountSnapshot = readRecentCountFromStore()
      return recentCountSnapshot
    }

    // ---------------------------------------------------------------- styles --
    const CSS = `

.dsr-rail { display:flex; flex-direction:column; align-items:center; height:100%; padding:10px 0 8px; gap:4px; }
.dsr-rail-top { display:flex; flex-direction:column; align-items:center; gap:4px; }
.dsr-rail-spacer { flex:1 1 auto; min-height:8px; }
/* macOS Desktop only: the host clips the collapsed column to 0 width, so the
   rail is portalled beside #root and pinned below the window-chrome strip —
   the traffic lights and the host's own reopen controls live in the top 48px
   (--dsh-frame-top-clearance, declared on the root element so portalled
   overlays inherit it). Clicking must not drag the window: -webkit-app-region
   is opted out explicitly even though body-level portals already are. */
.dsr-rail-float { position:fixed; left:0; top:var(--dsh-frame-top-clearance, 48px); bottom:0; width:56px;
  z-index:60; display:flex; flex-direction:column; align-items:center;
  background:var(--dsw-specific-sidebar-fill);
  border-right:.5px solid var(--dsw-alias-border-l3);
  -webkit-app-region:no-drag; }
.dsr-rail-float .dsr-rail { width:100%; }
/* Default state: the rail is slid out of the window, leaving only a thin edge
   strip. It covers the host's first conversation tab otherwise — the frame's
   collapsed column is zero-width and the tab row carries no leading clearance
   (ui-conversation ConversationRoot.module.css ".tabs" rule), so anything wider
   than this strip hides the tab's text and hit area. */
.dsr-rail-float { transform:translateX(-100%); transition:transform 160ms ease; }
.dsr-rail-float[data-dsr-revealed="true"] { transform:translateX(0); }
@media (prefers-reduced-motion: reduce) { .dsr-rail-float { transition:none; } }
/* The edge strip stays clickable/hoverable while the rail is out, which is what
   lets the pointer "find" it without a visible handle. */
/* 12px rather than 8px: macOS keeps an invisible resize band along the window
   edge, so a narrower strip left the pointer on the resize cursor and its events
   never reached the page. This width stays clear of that band while still being
   far narrower than the 56px rail it reveals. */
.dsr-rail-hotzone { position:fixed; left:0; top:var(--dsh-frame-top-clearance, 48px); bottom:0;
  width:12px; z-index:59; -webkit-app-region:no-drag; }
.dsr-rail-btn { display:flex; align-items:center; justify-content:center; width:36px; height:36px; padding:0;
  border:none; background:transparent; border-radius:var(--dsw-radius-sm, 8px);
  color:var(--dsw-alias-label-primary); cursor:pointer;
  transition:background-color 120ms ease, color 120ms ease; }
.dsr-rail-btn:hover, .dsr-rail-btn:focus-visible { background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-primary); outline:none; }
.dsr-rail-btn[aria-current="page"], .dsr-rail-btn[data-dsr-open="true"] {
  background:var(--dsw-specific-sidebar-nav-item-active); color:var(--dsw-alias-label-primary); }
.dsr-avatar { display:flex; align-items:center; justify-content:center; width:26px; height:26px;
  border-radius:50%; overflow:hidden;
  background:var(--dsw-alias-interactive-bg-active); color:var(--dsw-alias-label-primary); }
.dsr-avatar-img { width:100%; height:100%; object-fit:cover; display:block; }

.dsr-flyout { position:fixed; z-index:2147483000; width:288px; max-height:calc(100vh - 32px);
  display:flex; flex-direction:column;
  background:var(--dsw-alias-bg-overlay); color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:var(--dsw-radius-lg, 16px);
  box-shadow:var(--dsw-shadow-lv3, 0 12px 32px rgba(0,0,0,.18));
  overflow:hidden; animation:dsr-in 120ms ease-out; }
@keyframes dsr-in { from { opacity:0; transform:translateX(-2px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) { .dsr-flyout { animation:none; } }
.dsr-flyout-head { padding:10px 12px 4px; font-size:12px; font-weight:600;
  color:var(--dsw-alias-label-primary); }
.dsr-flyout-body { overflow-y:auto; padding:2px 6px 8px; min-height:0; }
.dsr-flyout-foot { border-top:1px solid var(--dsw-alias-border-l1); padding:6px; }
/* The workspace flyout splits into two panes of equal height: workspaces above,
   recent sessions below. Each pane is a fixed header row plus its own scroller,
   so a header never scrolls away and the two panes never fight over height:
   flex:1 1 0 divides whatever is left after the head and the count stepper.
   The divider marks the boundary between them. */
.dsr-split-body { display:flex; flex-direction:column; flex:1 1 auto; min-height:0; padding:0; }
.dsr-pane { display:flex; flex-direction:column; flex:1 1 0; min-height:0; }
.dsr-pane + .dsr-pane { border-top:1px solid var(--dsw-alias-border-l1); }
.dsr-pane-head { flex:none; padding:10px 12px 4px; font-size:11px; font-weight:600;
  letter-spacing:.04em; text-transform:none; color:var(--dsw-alias-label-secondary); }
.dsr-pane-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; padding:0 6px 8px; }
.dsr-stepper { display:flex; align-items:center; gap:6px; padding:6px 6px 0; font-size:11px;
  color:var(--dsw-alias-label-primary); }
.dsr-stepper-label { flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsr-stepper-btn { display:flex; align-items:center; justify-content:center; width:20px; height:20px; flex:none;
  border:1px solid var(--dsw-alias-border-l1); background:transparent; border-radius:var(--dsw-radius-sm, 8px);
  color:var(--dsw-alias-label-primary); font:inherit; line-height:1; cursor:pointer; }
.dsr-stepper-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.dsr-stepper-btn:disabled { opacity:.4; cursor:default; }
.dsr-stepper-value { min-width:1.6em; text-align:center; font-variant-numeric:tabular-nums; }
/* Status markers: same shapes and tokens as the host's StateDot, so a session
   reads the same in the rail and in the shipped sidebar. */
.dsr-settings { display:flex; flex-direction:column; gap:2px; }
.dsr-settings-title { margin:0 0 2px; font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); }
.dsr-account-balance { display:flex; align-items:baseline; gap:8px; padding:6px 6px 2px; }
.dsr-account-balance-label { font-size:11px; color:var(--dsw-alias-label-primary); }
.dsr-account-balance-value { font-size:13px; font-weight:600; font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-primary); }
.dsr-account-links { display:flex; gap:10px; padding:6px 6px 0; }
.dsr-account-link { font-size:12px; color:var(--dsw-alias-brand-primary); text-decoration:none; }
.dsr-account-link:hover { text-decoration:underline; }
.dsr-dot { display:inline-flex; align-items:center; justify-content:center; width:10px; height:10px; flex:none; }
.dsr-dot::after { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; }
.dsr-dot-done { color:var(--dsw-alias-state-success-primary); }
.dsr-dot-warning { color:var(--dsw-alias-state-warn-primary); }
.dsr-dot-ongoing { color:var(--dsw-alias-label-tertiary); }
.dsr-dot-ongoing::after { content:none; }
.dsr-ring-track, .dsr-ring-arc { fill:none; stroke:currentColor; stroke-width:2; }
.dsr-ring-track { opacity:.25; }
.dsr-ring-arc { stroke-linecap:round; stroke-dasharray:14 46; transform-origin:12px 12px;
  animation:dsr-spin 1.5s linear infinite; }
@keyframes dsr-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dsr-ring-arc { animation:none; } }
.dsr-section-title { padding:10px 6px 4px; font-size:11px; font-weight:600; letter-spacing:.04em;
  text-transform:uppercase; color:var(--dsw-alias-label-primary); }
.dsr-row { display:flex; align-items:center; gap:6px; width:100%; min-height:30px; padding:4px 6px;
  border:none; background:transparent; border-radius:var(--dsw-radius-sm, 8px); color:inherit;
  font:inherit; font-size:13px; text-align:left; cursor:pointer; }
.dsr-row:hover, .dsr-row:focus-visible { background:var(--dsw-alias-interactive-bg-hover); outline:none; }
/* The session the main view is showing. The host paints its own selected
   session row with --dsw-alias-interactive-bg-hover (ui-workspace
   Rows.module.css), so matching that token keeps both surfaces consistent;
   --dsw-specific-sidebar-nav-item-active belongs to the settings nav. */
.dsr-row[data-dsr-current="true"] { background:var(--dsw-alias-interactive-bg-hover); }
.dsr-row-wrap { display:flex; align-items:center; border-radius:var(--dsw-radius-sm, 8px); }
.dsr-row-wrap:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dsr-row-wrap:hover .dsr-row { background:transparent; }
.dsr-row-main { display:flex; flex-direction:column; min-width:0; flex:1 1 auto; }
.dsr-row-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsr-row-meta { font-size:11px; font-weight:400; color:var(--dsw-alias-label-primary);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsr-row-action { display:flex; align-items:center; justify-content:center; width:22px; height:22px; flex:none;
  margin-right:4px; border:none; background:transparent; border-radius:var(--dsw-radius-sm, 8px);
  cursor:pointer; color:var(--dsw-alias-label-primary); opacity:0; }
.dsr-row-wrap:hover .dsr-row-action, .dsr-row-action:focus-visible { opacity:1; }
.dsr-row-action:hover { background:var(--dsw-alias-interactive-bg-active);
  color:var(--dsw-alias-label-primary); }
.dsr-row-wrap[data-pinned="true"] .dsr-row-action { opacity:1; }
.dsr-empty { padding:14px 8px; font-size:12px; color:var(--dsw-alias-label-primary); text-align:center; }
.dsr-hint { padding:4px 6px 8px; font-size:11px; line-height:1.5;
  color:var(--dsw-alias-label-primary); }

.dsr-fallback { padding:12px; font-size:12px; color:var(--dsw-alias-label-primary); }
`

    // ---------------------------------------------------------------- icons --
    /** Shared stroke icon frame. */
    function Icon({ size = 20, children }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: false,
      }, children)
    }
    const IconWorkspace = (p) => h(Icon, p,
      h('path', { d: 'M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.6.8l.9 1.2H19a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }),
      h('path', { d: 'M3 10.5h18' }))
    const IconTasks = (p) => h(Icon, p,
      h('circle', { cx: 12, cy: 12, r: 8.2 }),
      h('path', { d: 'M12 7.6V12l3 1.8' }))
    const IconPlugins = (p) => h(Icon, p,
      h('path', { d: 'M8.5 4.5v3M15.5 4.5v3' }),
      h('path', { d: 'M6.5 7.5h11v4.2a5.5 5.5 0 0 1-11 0z' }),
      h('path', { d: 'M12 17.4v2.1' }))
    const IconMore = (p) => h(Icon, p,
      h('circle', { cx: 6, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }),
      h('circle', { cx: 12, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }),
      h('circle', { cx: 18, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }))
    /** "More" ellipsis, the shape the host shows on a signed-out account seat. */
    const IconEllipsis = (p) => h(Icon, p,
      h('circle', { cx: 6, cy: 12, r: 1.4, fill: 'currentColor', stroke: 'none' }),
      h('circle', { cx: 12, cy: 12, r: 1.4, fill: 'currentColor', stroke: 'none' }),
      h('circle', { cx: 18, cy: 12, r: 1.4, fill: 'currentColor', stroke: 'none' }))

    /** Neutral user glyph for the account seat when no picture is available. */
    const IconUser = (p) => h(Icon, p,
      h('circle', { cx: 12, cy: 8.2, r: 3.4 }),
      h('path', { d: 'M5 19.4c0-3 3.1-5 7-5s7 2 7 5' }))

    /** Small trailing pin used by workspace rows. */
    const IconPin = () => h('svg', {
      viewBox: '0 0 24 24', width: 13, height: 13, fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    }, h('path', { d: 'M9 4.5h6l-.8 5.2 3.3 3.3v1.5H6.5V13l3.3-3.3z' }), h('path', { d: 'M12 14.5V20' }))

    // ------------------------------------------------------------- formatting --
    /**
     * Compact relative time in the reader's language.
     * @param value - Epoch milliseconds.
     * @param language - Active locale id.
     * @returns A short label such as "5 分钟前".
     */
    function relativeTime(value, language) {
      if (!Number.isFinite(value)) return ''
      const delta = Date.now() - value
      const minute = 60_000
      const chinese = String(language ?? '').toLowerCase().startsWith('zh')
      if (delta < minute) return chinese ? '刚刚' : 'now'
      if (delta < 60 * minute) {
        const n = Math.floor(delta / minute)
        return chinese ? `${n} 分钟前` : `${n} min ago`
      }
      if (delta < 24 * 60 * minute) {
        const n = Math.floor(delta / (60 * minute))
        return chinese ? `${n} 小时前` : `${n} h ago`
      }
      const n = Math.floor(delta / (24 * 60 * minute))
      return chinese ? `${n} 天前` : `${n} d ago`
    }

    /**
     * Resolve the active locale id from a host locale snapshot.
     *
     * The shipped client publishes `LocaleSnapshot.active`. Reading `id` or
     * `locale` instead (what this plugin did before the 2026-11-04 desktop
     * validation) always fell back to English, which is how a Chinese UI ended
     * up showing "min ago". Only a non-empty string is accepted so a malformed
     * snapshot cannot blank the column's copy; `id`/`locale` stay as defensive
     * fallbacks in case a synthetic snapshot ever carries them.
     * @param snapshot - Host locale snapshot, or anything that arrived instead.
     * @returns A locale id, defaulting to `'en'`.
     */
    function resolveLocaleId(snapshot) {
      if (snapshot === null || typeof snapshot !== 'object') return 'en'
      for (const key of ['active', 'id', 'locale']) {
        const value = snapshot[key]
        if (typeof value === 'string' && value !== '') return value
      }
      return 'en'
    }

    /**
     * Decide whether the rail should be drawn for one state of the world.
     *
     * The rail floats over the main column, so it may only appear while the
     * viewport can still fit a readable centre beside it (the host floors its
     * conversation column at 680px). Narrower than that, the host's own reopen
     * control in `shell.leading` stays available, so hiding the rail costs the
     * user no way back.
     * @param platform - `document.documentElement.dataset.platform`.
     * @param collapsed - True while the host sidebar is folded.
     * @param viewportWidth - Viewport width in CSS pixels.
     * @returns True when the rail should be rendered.
     */
    function shouldRenderRail(platform, collapsed, viewportWidth) {
      if (platform !== 'darwin' || collapsed !== true) return false
      return Number.isFinite(viewportWidth) && viewportWidth >= RAIL_MIN_VIEWPORT
    }

    /**
     * Trim an absolute path to its last two segments for hint text.
     * @param path - Canonical directory path.
     * @returns Shortened path.
     */
    function shortPath(path) {
      if (typeof path !== 'string' || path.length === 0) return ''
      const parts = path.split(/[\\/]+/).filter(Boolean)
      return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`
    }

    // #endregion pure-helpers

    // ------------------------------------------------------------ error gate --
    /**
     * Keeps one failing rail from abdicating the slot (which would silently
     * bring the shipped sidebar back mid-session).
     */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError(error) {
        // Surfacing the message is the only way to diagnose a render crash from
        // outside the app; it is behind the same fallback as before.
        return { failed: true, message: error !== null && typeof error === 'object' ? String(error.message ?? error) : String(error) }
      }

      componentDidCatch(error) {
        console.error('[dsh-sidebar-rail] render failed', error)
      }

      render() {
        return this.state.failed
          ? h('div', { className: 'dsr-fallback', role: 'status' },
            this.props.fallbackText,
            this.state.message === undefined ? null : h('div', { style: { fontSize: '10px', opacity: 0.8 } }, this.state.message))
          : this.props.children
      }
    }

    // ------------------------------------------------------------ primitives --
    /**
     * One workspace/list row with an optional trailing pin action.
     *
     * `current` marks the row the main view is showing, painted with the same
     * fill the host uses for its own selected session row. The host marks that
     * row with `aria-selected` inside a treeitem; these rows are plain buttons,
     * so `aria-current="page"` is the equivalent announcement here.
     * @param props - Row content, click handler, pin affordance and current flag.
     * @returns The row element.
     */
    function Row({ title, meta, onClick, onTogglePin, pinLabel, pinned, current, status, statusLabel }) {
      const main = h('button', {
        type: 'button',
        className: 'dsr-row',
        // No inline background: it used to outrank the hover, focus-visible and
        // current rules in CSS, so rows without a pin wrapper never showed any
        // state. Row backgrounds belong to the stylesheet now.
        style: { flex: '1 1 auto', minWidth: 0 },
        'aria-current': current === true ? 'page' : undefined,
        'data-dsr-current': current === true ? 'true' : undefined,
        onClick,
      },
      h('span', { className: 'dsr-row-main' },
        h('span', { className: 'dsr-row-title' }, title),
        meta === undefined || meta === '' ? null : h('span', { className: 'dsr-row-meta' }, meta)),
      status === undefined ? null : h(StateMark, { status, label: statusLabel ?? '' }))
      if (onTogglePin === undefined) return main
      return h('div', { className: 'dsr-row-wrap', 'data-pinned': pinned === true ? 'true' : undefined },
        main,
        h('button', {
          type: 'button',
          className: 'dsr-row-action',
          'aria-label': pinLabel,
          title: pinLabel,
          onClick: (event) => { event.stopPropagation(); onTogglePin() },
        }, h(IconPin)))
    }

    /**
     * Account seat avatar.
     *
     * Signed in with a picture: the host's own avatar URL. Otherwise the host's
     * fallback treatment — a neutral user glyph on the same field the shipped
     * sidebar uses. An "AI" monogram lived here before, which read as if the
     * plugin had its own identity rather than showing the signed-in account.
     * @param props - Avatar URL from the account profile, when one is available.
     * @returns The avatar element.
     */
    function AccountAvatar({ seat }) {
      const [broken, setBroken] = useState(false)
      const kind = seat?.kind ?? 'unknown'
      const url = seat?.avatarUrl
      const usable = typeof url === 'string' && url !== '' && !broken
      // Signed out is not "a person without a picture": the shipped sidebar drops
      // the avatar slot entirely and shows a "more" ellipsis. Render the same
      // shape here rather than inventing a face.
      const glyph = kind === 'signed-out' ? h(IconEllipsis, { size: 16 }) : h(IconUser, { size: 16 })
      return h('span', { className: 'dsr-avatar', 'data-dsr-seat': kind, 'aria-hidden': true },
        usable
          ? h('img', {
            className: 'dsr-avatar-img',
            src: url,
            alt: '',
            referrerPolicy: 'no-referrer',
            onError: () => setBroken(true),
          })
          : glyph)
    }

    /**
     * Session status marker, drawn to match the host's `StateDot`.
     *
     * The shapes are reimplemented rather than imported: this is a static module
     * that may only require react/react-dom, so `@deepseek-ai/dsh-client-ui-
     * primitives` is out of reach. Colours come from the same tokens the host
     * uses, so the two surfaces read alike: ongoing is a rotating ring in the
     * tertiary label colour, the rest are solid dots in the state tokens.
     * @param props - Status from `sessionStatusOf` and an accessible label.
     * @returns The marker element.
     */
    function StateMark({ status, label }) {
      if (status === 'idle') return null
      const title = label === '' ? undefined : label
      if (status === 'ongoing') {
        return h('span', { className: 'dsr-dot dsr-dot-ongoing', role: 'img', 'aria-label': label, title },
          h('svg', { viewBox: '0 0 24 24', width: 14, height: 14, 'aria-hidden': true },
            h('circle', { cx: 12, cy: 12, r: 9.5, className: 'dsr-ring-track' }),
            h('circle', { cx: 12, cy: 12, r: 9.5, className: 'dsr-ring-arc' })))
      }
      return h('span', {
        className: `dsr-dot dsr-dot-${status}`,
        role: 'img',
        'aria-label': label,
        title,
      })
    }

    /**
     * Settings surface for the plugin's own detail page.
     *
     * Registered into `plugins.bundle.config`, the seat the plugin manager gives
     * a bundle on its page (the host's cot-translation and voice-input bundles
     * use the same one). The rail's flyout offers the same control, and both
     * write one localStorage key, so the two cannot disagree.
     * @param props - Host-provided locale face.
     * @returns The settings block.
     */
    function RailSettings(props) {
      const t = typeof props?.t === 'function' ? props.t : (key) => String(key)
      // Shared store, not local state: the flyout stepper writes the same value,
      // and two independent `useState`s left whichever surface was not edited
      // showing (then re-writing) a stale count.
      const count = useSyncExternalStore(subscribeRecentCount, getRecentCountSnapshot, getRecentCountSnapshot)
      return h('div', { className: 'dsr-settings' },
        h('h4', { className: 'dsr-settings-title' }, t('settings.title')),
        h(RecentCountRow, {
          value: count,
          label: t('settings.recentCount'),
          onChange: setRecentCount,
          min: MIN_RECENT_COUNT,
          max: MAX_RECENT_COUNT,
        }),
        h('p', { className: 'dsr-hint' }, t('settings.recentCountHint')))
    }

    /**
     * One compact stepper row: the recent-session count preference.
     *
     * This is the second place the value can change (the plugin detail page is
     * the other); both write the same localStorage key, so the rail's flyout
     * offers the short path without owning the setting.
     * @param props - Current value, label, change callback and bounds.
     * @returns The stepper row.
     */
    function RecentCountRow({ value, label, onChange, min, max }) {
      const step = (delta) => { onChange(value + delta) }
      return h('div', { className: 'dsr-stepper' },
        h('span', { className: 'dsr-stepper-label' }, label),
        h('button', {
          type: 'button',
          className: 'dsr-stepper-btn',
          'aria-label': `${label} −`,
          disabled: value <= min,
          onClick: () => step(-1),
        }, '−'),
        h('span', { className: 'dsr-stepper-value', 'aria-live': 'polite' }, String(value)),
        h('button', {
          type: 'button',
          className: 'dsr-stepper-btn',
          'aria-label': `${label} +`,
          disabled: value >= max,
          onClick: () => step(1),
        }, '+'))
    }

    /** Grouped heading inside a flyout body. */
    function Section({ title, children }) {
      return h('div', null, h('div', { className: 'dsr-section-title' }, title), children)
    }

    /** Centered empty or status line. */
    function Empty({ children }) {
      return h('div', { className: 'dsr-empty' }, children)
    }

    /** Full-width action row. */
    function ActionRow({ children, onClick }) {
      return h('button', { type: 'button', className: 'dsr-row', onClick },
        h('span', { className: 'dsr-row-main' }, h('span', { className: 'dsr-row-title' }, children)))
    }

    // ---------------------------------------------------------- data adapters --
    // #region pure-data
    /**
     * Add one to a non-negative decimal integer string without going through
     * `Number`, so an amount far beyond `Number.MAX_SAFE_INTEGER` still carries.
     * @param digits - Decimal integer text such as `99` or `0`.
     * @returns The incremented text, with a new leading digit when it overflows.
     */
    function incrementDecimalDigits(digits) {
      const chars = digits.split('')
      let index = chars.length - 1
      while (index >= 0) {
        if (chars[index] === '9') {
          chars[index] = '0'
          index -= 1
        } else {
          chars[index] = String(Number(chars[index]) + 1)
          return chars.join('')
        }
      }
      return `1${chars.join('')}`
    }

    /**
     * Format one wallet balance the way the host does.
     *
     * Mirrors ui-settings-account `formatBalance` exactly: zero reads `¥0.00`, a
     * positive amount below one cent reads `<¥0.01`, negatives keep a leading
     * minus and never claim less than a cent, and everything else is truncated
     * (positives, `roundDown`) or half-up rounded (negatives, `toFixed`). String
     * math avoids the `Big` dependency this static module cannot load.
     *
     * The negative branch rounds the ABSOLUTE value, so it can carry into the
     * whole units: `-0.999` is `-¥1.00` and `-99.999` is `-¥100.00` on the host.
     * Padding the cent field alone produced `-¥0.100`, which is why the carry is
     * handled explicitly here.
     * @param amount - Decimal balance string from the wallet.
     * @param symbol - Currency symbol.
     * @returns Display text.
     */
    function formatWalletBalance(amount, symbol) {
      const raw = typeof amount === 'string' ? amount.trim() : ''
      if (raw === '') return ''
      // Platform's wire schema allows exponent notation (details.ts accepts
      // `0E-16`, `1e+3`), so expand it before doing fixed-point string math;
      // rejecting it silently dropped whole wallet rows.
      const text = expandExponent(raw)
      if (text === null) return ''
      const negative = text.startsWith('-')
      const [wholeRaw, fraction = ''] = (negative ? text.slice(1) : text).split('.')
      const whole = wholeRaw === '' ? '0' : wholeRaw
      const zero = /^0*$/.test(wholeRaw) && /^0*$/.test(fraction)
      if (zero) return `${symbol}0.00`
      const subCent = /^0*$/.test(wholeRaw) && fraction.padEnd(3, '0').slice(0, 2) === '00'
      if (subCent) return negative ? `-${symbol}0.01` : `<${symbol}0.01`
      let cents = fraction.padEnd(2, '0').slice(0, 2)
      let units = whole
      // The host rounds a negative balance (Big#toFixed) and truncates a
      // positive one (roundDown); only the negative branch can carry.
      if (negative && fraction.length > 2 && Number(fraction[2]) >= 5) {
        const bumped = Number(cents) + 1
        if (bumped === 100) {
          units = incrementDecimalDigits(units)
          cents = '00'
        } else {
          cents = String(bumped).padStart(2, '0')
        }
      }
      // `addCommas` in the host groups through `Number`, so this matches it.
      const grouped = Number(units).toLocaleString()
      return `${negative ? '-' : ''}${symbol}${grouped}.${cents}`
    }

    /**
     * Pick the platform links an account view carries.
     *
     * `getState` always answers `links`, signed in or not (the host builds them
     * from its platform origin). Only absolute http(s) URLs are accepted: a
     * malformed value must hide the entry rather than open something else.
     * @param view - `AccountView` from `remote.account.getState()`.
     * @returns `{ usageUrl?, topUpUrl? }`, each omitted when unusable.
     */
    function accountLinks(view) {
      const links = view !== null && typeof view === 'object' && 'value' in view ? view.value?.links : view?.links
      if (links === null || typeof links !== 'object') return {}
      const usable = (value) => (typeof value === 'string' && /^https?:\/\//i.test(value) ? value : undefined)
      // Only carry keys that survived validation, so callers can test `=== undefined`
      // without distinguishing "absent" from "present but unusable".
      const usageUrl = usable(links.usageUrl)
      const topUpUrl = usable(links.topUpUrl)
      return {
        ...(usageUrl === undefined ? {} : { usageUrl }),
        ...(topUpUrl === undefined ? {} : { topUpUrl }),
      }
    }

    /**
     * Expand a decimal string that may use exponent notation.
     *
     * String math only: the amounts arrive as decimal strings carrying server
     * precision, and Number would lose it. Returns null for anything that is not
     * a plain or exponent decimal so the caller can drop the row.
     * @param text - Candidate amount, e.g. `12.34`, `0E-16`, `1e+3`, `-0.000001`.
     * @returns Fixed-point decimal text, or null when the input is not a number.
     */
    function expandExponent(text) {
      const match = /^(-?)(\d+)?(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text)
      if (match === null) return null
      const sign = match[1] ?? ''
      const wholeRaw = match[2] ?? ''
      const fractionRaw = match[3] ?? ''
      const expRaw = match[4]
      if (wholeRaw === '' && fractionRaw === '') return null
      const exponent = expRaw === undefined ? 0 : Number(expRaw)
      if (!Number.isFinite(exponent) || Math.abs(exponent) > 100) return null
      let digits = `${wholeRaw}${fractionRaw}`
      let point = wholeRaw.length + exponent
      if (point <= 0) {
        digits = '0'.repeat(1 - point) + digits
        point = 1
      } else if (point > digits.length) {
        digits += '0'.repeat(point - digits.length)
      }
      const whole = digits.slice(0, point).replace(/^0+(?=\d)/, '') || '0'
      const fraction = digits.slice(point)
      return `${sign}${whole}${fraction === '' ? '' : `.${fraction}`}`
    }

    /**
     * Pick the wallet rows a person should see.
     *
     * `getBalance` answers `RemoteResult<AccountWallet[] | null>` where each
     * wallet is `{ currency, balance }`. Only positive rows are worth a line:
     * the host filters bonus wallets the same way before rendering them.
     * @param answer - Whatever the balance remote returned.
     * @returns Display rows `{ currency, text }`, newest first as given.
     */
    function balanceRows(answer) {
      // Three layers on the wire: RemoteResult{ value: AccountDetails['balance'] },
      // where that balance is `{ status:'ready', value: wallets, bonusWallets }`,
      // `{ status:'failed' }`, or null. Reading `answer.value` as an array here
      // made the real Host answer parse as "no wallets" while a hand-written
      // array fixture kept the unit test green.
      const remote = answer !== null && typeof answer === 'object' && 'value' in answer ? answer.value : answer
      if (remote === null || typeof remote !== 'object' || remote.status !== 'ready') return { wallets: [], bonusWallets: [] }
      const map = (list) => {
        if (!Array.isArray(list)) return []
        const out = []
        for (const wallet of list) {
          if (wallet === null || typeof wallet !== 'object') continue
          const currency = wallet.currency === 'USD' ? 'USD' : wallet.currency === 'CNY' ? 'CNY' : undefined
          if (currency === undefined) continue
          const text = formatWalletBalance(wallet.balance, currency === 'CNY' ? '¥' : '$')
          if (text === '') continue
          // Zero is kept: the host renders every wallet it receives, so a ¥0.00
          // row is part of "show what the host shows".
          out.push({ currency, text })
        }
        return out
      }
      return { wallets: map(remote.value), bonusWallets: map(remote.bonusWallets) }
    }

    /**
     * Resolve one session row's status marker.
     *
     * Mirrors the host's own precedence in ui-workspace `sessionStatuses`:
     * a pending interaction outranks live activity, which outranks the
     * unread-completion reminder, which is followed by plain idle. Keeping the
     * same order means the rail and the shipped sidebar never label the same
     * session differently.
     *
     * Two host details are reproduced exactly rather than approximated:
     *   - only `approval` / `plan-review` / `question` count as a visible pending
     *     interaction (`visiblePendingKind`); any other kind is ignored, so a
     *     future domain key cannot silently paint the rail amber;
     *   - `running` falls back to the SessionSummary when the status snapshot has
     *     no entry yet, which is how the tree resolves it (`status?.running ??
     *     s.running`).
     * Running subagents are deliberately not folded in. The host counts them as
     * `ongoing` too, but that needs `subagentCatalog` from `projectionsBySession`,
     * which this row projection does not carry. The PRD lists it as a non-goal:
     * the session's own running / pending / unread states already cover the
     * cases the rail is for, and reading the projection just for this is not
     * worth it.
     * @param summary - The row's SessionSummary (for the `running` fallback).
     * @param status - The SessionStatus entry from `useSessionStatus`, if any.
     * @returns 'warning' | 'ongoing' | 'done' | 'idle'.
     */
    function sessionStatusOf(summary, status) {
      const pending = status?.pendingInteraction
      if (pending !== undefined && pending !== null && VISIBLE_PENDING_KINDS.has(pending.kind)) return 'warning'
      const running = status?.running === undefined ? summary?.running : status.running
      if (running === true) return 'ongoing'
      // `summary.completed` deliberately does not participate: the host reads
      // `completionUnread` only (`SessionSummary` has no `completed` field).
      if (status?.completionUnread === true) return 'done'
      return 'idle'
    }

    /**
     * Clamp a stored recent-session count into its supported range.
     *
     * The value comes from localStorage, so it may be absent, a string (hand
     * edited), a float or out of range. Anything unusable falls back to the
     * default rather than rendering a surprise number of rows.
     * @param raw - Whatever the store held for `recentCount`.
     * @returns An integer between MIN_RECENT_COUNT and MAX_RECENT_COUNT.
     */
    function readRecentCount(raw) {
      // An empty or whitespace string is "unset", not zero: Number('') is 0 and
      // would clamp to 1, silently turning a cleared preference into "show one".
      if (typeof raw === 'string') {
        if (raw.trim() === '') return DEFAULT_RECENT_COUNT
        const parsed = Number(raw)
        if (!Number.isFinite(parsed)) return DEFAULT_RECENT_COUNT
        return Math.min(MAX_RECENT_COUNT, Math.max(MIN_RECENT_COUNT, Math.round(parsed)))
      }
      if (!Number.isFinite(raw)) return DEFAULT_RECENT_COUNT
      return Math.min(MAX_RECENT_COUNT, Math.max(MIN_RECENT_COUNT, Math.round(raw)))
    }

    /**
     * Which session is the one shown in the main view.
     *
     * The host answers this in `ui-workspace/tree.ts` and `ui-session`
     * (`publishMain`) by scanning the session list for the entry the main view
     * retains (`retainedBy.mainView > 0`), so reading the same flag keeps the
     * rail and the shipped sidebar from disagreeing. There is no
     * `activeSessionId` prop to read instead.
     *
     * Verified on Desktop 0.2.2-rc.1: while a session is open the host's own
     * sidebar row is NOT highlighted and this flag reads 0, so the rail shows no
     * highlight either — same source, same outcome. If a later host maintains
     * the count again, both surfaces light up together with no change here.
     * @param sessions - SessionListState from `useSessions`.
     * @returns The current SessionId, or undefined when no session is shown.
     */
    function currentSessionId(sessions, panelCovering) {
      // The host clears its own session highlight while another panel covers the
      // conversation; matching that keeps the rail from claiming a session that
      // nothing shows.
      if (panelCovering === true) return undefined
      const byId = sessions?.byId
      if (byId === null || typeof byId !== 'object') return undefined
      for (const entry of Object.values(byId)) {
        if (entry == null || typeof entry !== 'object') continue
        const retained = entry.retainedBy
        const mainView = retained === null || typeof retained !== 'object' ? 0 : retained.mainView
        if (Number.isFinite(mainView) && mainView > 0) return entry.id
      }
      return undefined
    }

    /**
     * Build the identity every account call carries.
     *
     * The host's `accountClientMetadata` sends `{ version, locale,
     * timezoneOffsetSeconds }`; the timezone is the rarer half — JS reports
     * minutes west of UTC while the platform wants seconds east, hence the sign
     * flip. Returning null when the build carries no version keeps us from
     * calling an endpoint with a malformed identity.
     * @param locale - Active locale id.
     * @param version - `process.env.DSH_CLIENT_VERSION` of this client build.
     * @param offsetMinutes - `Date#getTimezoneOffset()` for the current zone.
     * @returns The metadata, or null when it cannot be built.
     */
    /**
     * Client build version for account calls.
     *
     * A hand-written static module has no `process` (the renderer runs with
     * contextIsolation and no node integration), so `process.env.DSH_CLIENT_VERSION`
     * is only inlined into the host's own bundles. The boot graph the page
     * receives carries the same version the host was built with.
     * @returns The version string, or undefined when neither source provides one.
     */
    function clientBuildVersion() {
      const boot = typeof globalThis === 'undefined' ? undefined : globalThis.__DSH_BOOT__
      const release = boot !== null && typeof boot === 'object' ? boot.release : undefined
      if (release !== undefined && release !== null && typeof release.version === 'string' && release.version !== '') {
        return release.version
      }
      const env = typeof process === 'undefined' ? undefined : process.env?.DSH_CLIENT_VERSION
      return typeof env === 'string' && env !== '' ? env : undefined
    }

    function accountClientMetadata(locale, version, offsetMinutes) {
      if (typeof version !== 'string' || version === '') return null
      return {
        version,
        locale: typeof locale === 'string' && locale !== '' ? locale : 'en',
        timezoneOffsetSeconds: -Number(offsetMinutes ?? 0) * 60,
      }
    }

    /**
     * Decide what the account seat should show.
     *
     * The shipped sidebar renders exactly two shapes
     * (ui-settings-account AccountMenu): a signed-in avatar, or — when signed
     * out — a "more" ellipsis with no picture slot at all. The rail keeps that
     * split so it never invents a face for a signed-out person.
     * @param viewAnswer - `remote.account.getState()` answer (login state only).
     * @param profileAnswer - `remote.account.getProfile()` answer, when fetched.
     * @returns 'signed-out', 'signed-in' with an optional avatar URL, or 'unknown'.
     */
    function accountSeatState(viewAnswer, profileAnswer) {
      const view = viewAnswer !== null && typeof viewAnswer === 'object' && 'value' in viewAnswer
        ? viewAnswer.value : viewAnswer
      if (view === null || typeof view !== 'object') return { kind: 'unknown', avatarUrl: undefined }
      if (view.status !== 'credential-stored') return { kind: 'signed-out', avatarUrl: undefined }
      // Three layers before the URL: RemoteResult{ value: AccountProfileRead{ status,
      // value: AccountProfile{ avatarUrl } } }. The host reads exactly this path
      // (ui-settings-account: `result.value.value.avatarUrl`), so the status gate
      // and the picture sit on different levels.
      const read = profileAnswer !== null && typeof profileAnswer === 'object' && 'value' in profileAnswer
        ? profileAnswer.value : profileAnswer
      if (read === null || typeof read !== 'object' || read.status !== 'ready') {
        return { kind: 'signed-in', avatarUrl: undefined }
      }
      const profile = read.value !== null && typeof read.value === 'object' ? read.value : null
      if (profile === null) return { kind: 'signed-in', avatarUrl: undefined }
      const url = profile.avatarUrl
      return {
        kind: 'signed-in',
        avatarUrl: typeof url === 'string' && url.trim() !== '' ? url.trim() : undefined,
      }
    }

    /**
     * Attach the read-only extras every account answer carries.
     *
     * `getState` answers `links` whether or not a credential is stored (the host
     * builds them from its platform origin), so the signed-out and
     * profile-unavailable paths must keep them too: only `balances` depends on
     * being signed in. Folding this into one function keeps those early returns
     * from silently dropping the usage/top-up entries — the bug that made them
     * disappear for a signed-out account.
     * @param seat - Result of `accountSeatState`.
     * @param viewAnswer - `remote.account.getState()` answer, for its `links`.
     * @param balanceAnswer - `remote.account.getBalance()` answer, when fetched.
     * @returns The seat plus `balances` and `links`, both always present.
     */
    function withAccountExtras(seat, viewAnswer, balanceAnswer) {
      return { ...seat, balances: balanceRows(balanceAnswer), links: accountLinks(viewAnswer) }
    }

    /**
     * Split workspaces into pinned and normal rows and collect recent sessions.
     * @param items - WorkspaceView[].
     * @param sessions - SessionListState.
     * @param archivedIds - Archived session ids.
     * @param pinnedIds - Locally pinned workspace ids, most recent first.
     * @param language - Active locale id.
     * @param panelCovering - True while a non-session panel covers the conversation.
     * @param recentCount - Requested number of recent rows; clamped by `readRecentCount`.
     * @param statuses - `SessionStatusSnapshot` (a Map keyed by SessionId) from
     *   `useSessionStatus`; absent when the Host does not inject the hook.
     * @returns Pinned rows, normal rows and recent session rows. Each recent row
     *   carries `status` ('warning' | 'ongoing' | 'done' | 'idle') so the renderer
     *   can draw the host's state mark beside it.
     */
    function deriveSections(items, sessions, archivedIds, pinnedIds, language, panelCovering, recentCount, statuses) {
      const list = Array.isArray(items) ? items : []
      const pinnedRank = new Map((Array.isArray(pinnedIds) ? pinnedIds : []).map((id, index) => [id, index]))
      const archived = new Set(Array.isArray(archivedIds) ? archivedIds : [])
      const pinnedRows = []
      const normalRows = []
      for (const item of list) {
        if (item == null) continue
        const row = {
          id: item.workspaceId,
          // The flyout shows the workspace name only; the path subtitle made every
          // row two lines tall and repeated information the name already carried.
          title: item.title ?? shortPath(item.path) ?? String(item.workspaceId),
          sessionIds: Array.isArray(item.sessionIds) ? item.sessionIds : [],
        }
        if (pinnedRank.has(row.id)) pinnedRows.push(row)
        else normalRows.push(row)
      }
      pinnedRows.sort((a, b) => (pinnedRank.get(a.id) ?? 0) - (pinnedRank.get(b.id) ?? 0))
      const shownSessionId = currentSessionId(sessions, panelCovering)
      const byId = sessions?.byId ?? {}
      // `useSessionStatus` answers a ReadonlyMap; a plain object is tolerated so a
      // host shape change degrades to "no marks" instead of throwing in render.
      const statusOf = (id) => {
        if (statuses === null || statuses === undefined || typeof statuses !== 'object') return undefined
        if (typeof statuses.get === 'function') return statuses.get(id)
        return statuses[id]
      }
      const recentRows = []
      for (const entry of Object.values(byId)) {
        if (entry == null || typeof entry !== 'object') continue
        if (entry.origin === 'subagent' || entry.blank === true) continue
        if (archived.has(entry.id)) continue
        recentRows.push({
          id: entry.id,
          title: entry.displayTitle ?? entry.title ?? String(entry.id),
          meta: relativeTime(entry.updatedAt, language),
          updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
          active: entry.id === shownSessionId,
          // The renderer keys the state mark off this; 'idle' draws nothing.
          status: sessionStatusOf(entry, statusOf(entry.id)),
        })
      }
      recentRows.sort((a, b) => b.updatedAt - a.updatedAt)
      return { pinnedRows, normalRows, recentRows: recentRows.slice(0, readRecentCount(recentCount)) }
    }


    /** Gap kept between a flyout and the window edge. */
    const FLYOUT_EDGE_GAP = 12
    /** Reserved height for the flyout head and foot when budgeting space. */
    const FLYOUT_CHROME_HEIGHT = 96
    /**
     * Share of the viewport the workspace flyout aims for.
     *
     * The workspace flyout is the one panel whose content length swings wildly —
     * two recent sessions or twenty. Pinning it to a viewport fraction means the
     * panel keeps still while the person steps `recentCount` up and down, and the
     * recent block scrolls instead of resizing the whole flyout. Other flyouts
     * (tasks, plugins, account) stay content-sized: their lists are short and a
     * fixed tall panel there would be mostly empty.
     */
    const WORKSPACE_FLYOUT_VIEWPORT_RATIO = 0.7
    /**
     * Height the workspace flyout should occupy, clamped to the room available.
     *
     * `flyoutPlacement` answers the space the panel MAY use; this answers the
     * space it SHOULD use, so the panel does not grow and shrink as the recent
     * count changes. The viewport fraction is a target, never a promise: near
     * the window edges the available budget wins, because overflowing the window
     * is worse than a shorter panel.
     *
     * The panes inside are split by flex (`flex:1 1 0` on both), not by arithmetic
     * here: CSS knows the real head/stepper heights, a constant would not.
     * @param viewportHeight - `window.innerHeight`.
     * @param maxHeight - Budget returned by `flyoutPlacement`.
     * @returns A pixel height, never above `maxHeight` and never negative.
     */
    function workspaceFlyoutHeight(viewportHeight, maxHeight) {
      const viewport = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0
      const cap = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : 0
      if (viewport === 0 || cap === 0) return 0
      return Math.min(Math.round(viewport * WORKSPACE_FLYOUT_VIEWPORT_RATIO), cap)
    }

    /**
     * Place a flyout against its anchor without letting it leave the window.
     *
     * A fixed `max-height: calc(100vh - 32px)` ignores the flyout's own offset:
     * on a short window the panel started partway down and still claimed most of
     * the viewport, so its bottom (and the recent-session foot) fell outside.
     * The budget here is the space actually left below the anchor.
     * @param anchor - `{ top, bottom }` of the rail entry that opened the flyout.
     * @param viewportHeight - `window.innerHeight`.
     * @param bottomAligned - True for the account seat, which anchors at the foot.
     * @returns Top or bottom offset, plus the maximum height the panel may use.
     */
    function flyoutPlacement(anchor, viewportHeight, bottomAligned) {
      // Staying inside the window outranks the comfortable minimum: a panel that
      // insists on FLYOUT_CHROME_HEIGHT near the bottom edge is exactly the
      // overflow this guards against.
      const budget = (offset) => Math.max(0, Math.min(
        Math.max(viewportHeight - offset - FLYOUT_EDGE_GAP, 0),
        Math.max(FLYOUT_CHROME_HEIGHT, viewportHeight - offset - FLYOUT_EDGE_GAP),
      ))
      if (bottomAligned === true) {
        // The seat sits at the foot: pin the panel's bottom to it and let the
        // panel grow upward within the room above.
        const bottom = Math.max(FLYOUT_EDGE_GAP, viewportHeight - anchor.bottom)
        return { bottom, maxHeight: budget(bottom) }
      }
      const top = Math.max(FLYOUT_EDGE_GAP, anchor.top)
      return { top, maxHeight: budget(top) }
    }

    /** Width of the edge strip that reveals the rail. */
    const RAIL_HOTZONE_WIDTH = 12
    /** Width the rail occupies once revealed (matches `.dsr-rail-float`). */
    const RAIL_REVEAL_WIDTH = 56
    /** Grace period before the rail retracts after the pointer leaves it. */
    const RETRACT_DELAY_MS = 180
    /**
     * Whether the pointer is still inside the region that keeps the rail out.
     *
     * Element-level `pointerleave` cannot answer this: the rail slides over the
     * edge strip, so the strip receives `pointerleave` the moment the rail
     * covers it, and retracting uncovers it again — the pair oscillates. Reading
     * the pointer's x against the revealed width is stable regardless of which
     * element happens to be on top.
     * @param x - Pointer x in client coordinates.
     * @param railWidth - Width the rail occupies once revealed.
     * @returns True when the pointer should keep the rail visible.
     */
    function keepsRailRevealed(x, railWidth) {
      if (!Number.isFinite(x)) return false
      const width = Number.isFinite(railWidth) && railWidth > 0 ? railWidth : 56
      return x >= 0 && x <= width
    }

    /**
     * Classify a remote answer before normalising it.
     *
     * A resolved promise is not success: the gateway returns failures as
     * `{ ok: false, error }` frames (api/gateway/src/client/index.ts), and the
     * host checks `ok` explicitly rather than relying on rejection. Showing a
     * failed frame as an empty list would report "no plugins" for a broken
     * connection, so the three outcomes are kept apart.
     * @param answer - Resolved value from a remote call, or null when the
     *   service is absent (the wrapper returns null in that case).
     * @returns 'ready' with the payload, 'failed' with the error, or 'unavailable'.
     */
    function remoteOutcome(answer) {
      if (answer === null || answer === undefined) return { kind: 'unavailable', value: undefined, error: undefined }
      if (typeof answer === 'object' && 'ok' in answer) {
        return answer.ok === true
          ? { kind: 'ready', value: answer.value, error: undefined }
          : { kind: 'failed', value: undefined, error: answer.error }
      }
      // Bare payloads (tests, or a future remote that answers directly).
      return { kind: 'ready', value: answer, error: undefined }
    }

    /**
     * Normalize an unknown schedule catalog answer into active task rows.
     * @param answer - Whatever the schedule remote returned.
     * @returns Task rows.
     */
    function normalizeTasks(answer) {
      const value = answer !== null && typeof answer === 'object' && 'value' in answer ? answer.value : answer
      const list = Array.isArray(value) ? value
        : Array.isArray(value?.items) ? value.items
          : Array.isArray(value?.tasks) ? value.tasks
            : Array.isArray(value?.entries) ? value.entries : []
      const rows = []
      for (const task of list) {
        if (task == null) continue
        const id = task.id ?? task.taskId ?? task.key ?? ''
        const title = task.title ?? task.name ?? task.instruction ?? task.prompt ?? String(id)
        const next = task.nextRunAt ?? task.next ?? task.scheduledAt ?? task.runAt
        const meta = typeof next === 'string' ? next
          : Number.isFinite(next) ? new Date(next).toLocaleString() : ''
        if (task.status !== undefined) { if (task.status === 'ended' || task.status === 'paused') continue }
        else if (task.active === false || task.enabled === false) continue
        rows.push({ id: String(id), title: String(title).slice(0, 120), meta })
      }
      return rows
    }

    /**
     * Normalize a bundle listing into the plugins the person actually added.
     *
     * A row survives only when the person switched it on, the profile really
     * declares it, and the installation does not ship it (`official`). That last
     * flag is the host's own Official/Installed split — it is why this reads
     * `pluginManager.listBundles` instead of the Loader inventory, which has no
     * such field. Bundles are the unit a person installs, so each row is one
     * bundle name rather than the rows inside it.
     * @param answer - Whatever the plugin-manager listing returned.
     * @returns Rows for user-installed bundles that are currently enabled.
     */
    function normalizePlugins(answer) {
      const value = answer !== null && typeof answer === 'object' && 'value' in answer ? answer.value : answer
      const list = Array.isArray(value) ? value
        : Array.isArray(value?.entries) ? value.entries
          : Array.isArray(value?.items) ? value.items
            : Array.isArray(value?.bundles) ? value.bundles : []
      const rows = []
      for (const bundle of list) {
        if (bundle == null || typeof bundle !== 'object') continue
        if (bundle.enabled !== true) continue
        if (bundle.official === true) continue
        if (bundle.installed === false) continue
        // `official` alone is not enough: the host's own base bundles
        // (@deepseek-ai/dsh-base, dsh-web-app) are not in the official catalog,
        // so they report official:false while shipping with the installation.
        // `availability: 'installation'` is the structured fact that separates them.
        if (bundle.availability === 'installation') continue
        const name = bundle.name ?? bundle.moduleName ?? bundle.packageName ?? ''
        if (name === '') continue
        // Belt and braces against an availability value that shifts meaning.
        if (String(name).startsWith('@deepseek-ai/')) continue
        const meta = bundle.version === undefined ? '' : `v${bundle.version}`
        rows.push({ name: String(name), meta })
      }
      rows.sort((a, b) => a.name.localeCompare(b.name))
      return rows
    }

    // #endregion pure-data

    // ------------------------------------------------------------------ root --
    /**
     * Read whether the host's left column is currently folded.
     *
     * The rail is mounted from the frame-wide `shell.overlay` seat, whose entries
     * receive no owner props, so the fold state comes from the attribute the host
     * publishes on the frame element (`data-sidebar-collapsed`). The frame is
     * reached through the overlay layer's stable `data-shell-overlay` marker
     * rather than a hashed CSS-module class. Observation is attribute-scoped so a
     * window resize or unrelated re-render cannot wake this component.
     * @returns True while the host sidebar is collapsed.
     */
    function useHostCollapsed() {
      const read = () => {
        if (typeof document === 'undefined') return false
        const frame = document.querySelector('[data-shell-overlay]')?.parentElement ?? null
        return frame !== null && frame.hasAttribute('data-sidebar-collapsed')
      }
      const [collapsed, setCollapsed] = useState(read)
      useEffect(() => {
        const frame = document.querySelector('[data-shell-overlay]')?.parentElement ?? null
        if (frame === null) return undefined
        setCollapsed(frame.hasAttribute('data-sidebar-collapsed'))
        const observer = new MutationObserver(() => setCollapsed(frame.hasAttribute('data-sidebar-collapsed')))
        observer.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
        return () => { observer.disconnect() }
      }, [])
      return collapsed
    }

    /**
     * Track the viewport width so the rail can drop out on narrow frames.
     *
     * A resize listener beats a ResizeObserver here: the decision depends on the
     * window, not on any element the plugin owns, and the rail unmounts at the
     * threshold so there is no box left to observe.
     * @returns Current viewport width in CSS pixels.
     */
    function useViewportWidth() {
      const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))
      useEffect(() => {
        const update = () => { setWidth(window.innerWidth) }
        update()
        window.addEventListener('resize', update)
        return () => { window.removeEventListener('resize', update) }
      }, [])
      return width
    }

    /**
     * Overlay entry: renders the rail only in the state that needs it.
     *
     * macOS Desktop folds the column to zero width and clips it
     * (`AppFrame: collapsedWidth = darwin ? 0 : 56`), so the shipped build keeps
     * no rail there. Web already renders the shipped 56px rail, so this entry
     * stays empty on Web and never doubles it up.
     * @param props - overlay-entry props forwarded to the rail.
     * @returns The rail, or null outside the macOS collapsed state.
     */
    function RailOverlay(props) {
      const collapsed = useHostCollapsed()
      const viewportWidth = useViewportWidth()
      const platform = typeof document === 'undefined' ? '' : (document.documentElement.dataset.platform ?? '')
      if (!shouldRenderRail(platform, collapsed, viewportWidth)) return null
      return h(RailColumn, props)
    }

    /**
     * The collapsed navigation rail: four entries, an account seat, and one
     * hover flyout at a time. Expanding hands the column back to the host, which
     * owns the expanded sidebar (search, view options, settings).
     * @param props - standard hooks, injected face and translator.
     * @returns The portal-rendered rail element.
     */
    function RailColumn(props) {
      const {
        toggleSidebar, selectPanel,
        panels, locale, openWorkspace, openSession, scheduleCatalog,
        pluginInventory, useSessions, useWorkspaces, usePanelInfo, useSessionStatus, fallbackText,
        accountSeat: accountSeatLoader,
      } = props
      /** Translator with a raw-key fallback when the locale face is absent. */
      const t = typeof props.t === 'function' ? props.t : (key) => String(key)

      // Standard hooks are the sanctioned way to read list state. Each falls
      // back to a constant reader so one missing prop cannot blank the column.
      const readSessions = selectorHook(useSessions, EMPTY_SESSIONS)
      const readWorkspaces = selectorHook(useWorkspaces, EMPTY_WORKSPACES)
      const readPanelInfo = selectorHook(usePanelInfo, { activePanelId: null })
      const sessions = readSessions((state) => state)
      const workspaceItems = readWorkspaces((state) => state.items)
      const archivedIds = readWorkspaces((state) => state.archivedSessionIds)
      const activePanelId = readPanelInfo((info) => info?.activePanelId)
      // A non-session panel (plugin page, schedules…) occupies the main area and
      // covers the conversation; the host clears its own session highlight then.
      // `conversation` is itself a registered main panel (ui-conversation applies
      // `key: 'conversation'`), so a non-null activePanelId does NOT mean the
      // conversation is covered — only some other panel id does. Comparing
      // against null alone would hide the highlight while the session is visible.
      const panelCovering = activePanelId !== null && activePanelId !== undefined
        && activePanelId !== 'conversation'
      // Host-owned per-session UI status. Optional: without the prop the rows
      // fall back to SessionSummary.running alone.
      const readStatuses = selectorHook(useSessionStatus, undefined)
      // Declared before the derived sections: `useMemo` below reads both, and a
      // later declaration would hit the temporal dead zone at render time.
      const [accountSeat, setAccountSeat] = useState({ kind: 'unknown', avatarUrl: undefined })
      // Shared store rather than local state: the plugin detail page edits the
      // same preference, and two independent `useState`s meant whichever surface
      // was not edited kept showing — and on its next click, re-wrote — a stale
      // count. Subscribing here makes either surface's edit land in both.
      const recentCount = useSyncExternalStore(subscribeRecentCount, getRecentCountSnapshot, getRecentCountSnapshot)
      const statuses = readStatuses((snapshot) => snapshot)
      const panelEntries = useObservable(panels, identity)
      const language = useObservable(locale, (snapshot) => snapshot?.active ?? 'en')

      const [pins, setPins] = useState(() => {
        const stored = readStore().pinnedWorkspaceIds
        return Array.isArray(stored) ? stored.map(String) : []
      })
      const [open, setOpen] = useState(null)
      const [anchor, setAnchor] = useState({ top: 12, bottom: 44, right: 56 })
      const [tasks, setTasks] = useState({ phase: 'idle', rows: [] })
      const [plugins, setPlugins] = useState({ phase: 'idle', rows: [] })
      const openTimer = useRef(undefined)
      const closeTimer = useRef(undefined)
      /** The rail button that opened the flyout, for Escape focus return. */
      const triggerRef = useRef(null)
      /** The flyout panel element, for moving focus into its list. */
      const panelRef = useRef(null)
      const sections = useMemo(
        () => deriveSections(workspaceItems, sessions, archivedIds, pins, language, panelCovering, recentCount, statuses),
        [workspaceItems, sessions, archivedIds, pins, language, panelCovering, recentCount, statuses],
      )

      // Lazy remote data, loaded once per flyout opening. Two rules keep it
      // working, and both were learned the hard way:
      //   - The effect depends on `open` only. Listing the phase would re-run it
      //     right after this code sets `loading`, and React's cleanup would then
      //     flip `live` to false and cancel the timer — so the promise result was
      //     always dropped and the flyout hung on "loading" forever.
      //   - The loaders are read through a ref: injected props are a fresh object
      //     per render, so a function identity in the deps would re-run the same
      //     effect on every render and reintroduce the bug above.
      // The account picture is read once per mount; an absent or failed read
      // simply leaves the neutral fallback glyph in place.
      // The rail stays slid out until the pointer reaches the left edge, or the
      // person focuses it with the keyboard. See the CSS note on why the default
      // state must not cover the host's conversation tabs.
      const [revealed, setRevealed] = useState(false)
      const retractTimer = useRef(undefined)
      /** Cancel a pending retraction while the pointer is back over the rail. */
      const cancelRetract = useCallback(() => {
        if (retractTimer.current !== undefined) {
          window.clearTimeout(retractTimer.current)
          retractTimer.current = undefined
        }
      }, [])
      /** Retract after a beat, so crossing the rail edge does not flicker. */
      const scheduleRetract = useCallback(() => {
        cancelRetract()
        retractTimer.current = window.setTimeout(() => { setRevealed(false) }, RETRACT_DELAY_MS)
      }, [cancelRetract])
      useEffect(() => cancelRetract, [cancelRetract])

      /**
       * Keep the rail's visibility in step with the pointer's position.
       *
       * A window-level listener rather than element events: the reveal strip and
       * the sliding rail overlap, so `pointerleave` on either one fires when the
       * other takes the hit target. Position decides instead — inside the rail's
       * own width keeps it out, anything further left of the window retracts it —
       * and an open flyout always wins so the pointer can travel to it.
       */
      useEffect(() => {
        if (!revealed) return undefined
        const onMove = (event) => {
          if (open !== null) return
          const railWidth = RAIL_REVEAL_WIDTH
          const inFlyout = panelRef.current !== null && panelRef.current.contains(event.target)
          if (inFlyout) return
          if (keepsRailRevealed(event.clientX, railWidth)) return
          setRevealed(false)
        }
        window.addEventListener('pointermove', onMove, { passive: true })
        return () => { window.removeEventListener('pointermove', onMove) }
      }, [revealed, open])

      /**
       * Close the flyout, leaving the rail where it is.
       *
       * Hovering between rail icons fires this: the pointer crosses each icon's
       * boundary, and treating that as "the interaction is over" retracted the
       * rail, which then re-revealed from the edge strip — an oscillation that
       * was easiest to trigger exactly over the icon column, where boundaries
       * are densest.
       */
      const dismiss = useCallback(() => {
        setOpen(null)
      }, [])

      /**
       * Close the flyout and retract the rail.
       *
       * Used where the interaction really ends: choosing an entry, navigating
       * away, or Escape. Retraction cannot ride on the rail's own
       * `pointerleave` for those paths — choosing an entry leaves the pointer
       * over the flyout, to the right of the rail, so no rail event follows.
       */
      const retract = useCallback(() => {
        setOpen(null)
        setRevealed(false)
      }, [])

      // The account seat is read once per mount. Per the PRD's non-goals this
      // does not subscribe to `account/watch`, so signing in or out while the
      // plugin stays mounted leaves the seat as it was; the host's own account
      // page is the authoritative view. Skipping the subscription also keeps the
      // plugin free of a long-lived listener it would have to tear down.
      const avatarAsked = useRef(false)
      useEffect(() => {
        if (avatarAsked.current) return undefined
        avatarAsked.current = true
        let live = true
        Promise.resolve()
          .then(() => (typeof accountSeatLoader === 'function' ? accountSeatLoader() : undefined))
          .then((seat) => {
            if (live && seat !== null && typeof seat === 'object') setAccountSeat(seat)
          })
          .catch(() => { /* the placeholder glyph is the failure state */ })
        return () => { live = false }
      }, [accountSeatLoader])

      const loaders = useRef({ scheduleCatalog, pluginInventory })
      loaders.current = { scheduleCatalog, pluginInventory }
      const started = useRef({ tasks: false, plugins: false })

      /**
       * Run one lazy remote list once per flyout opening.
       * @param key - Which list this is, so a re-open starts a fresh attempt.
       * @param load - Remote call returning the raw answer.
       * @param apply - State writer taking a descriptor or an updater.
       * @returns Effect cleanup that stops the timer and ignores late answers.
       */
      const loadRemote = (key, load, apply) => {
        if (started.current[key]) return undefined
        started.current[key] = true
        let live = true
        apply({ phase: 'loading', rows: [] })
        const timer = window.setTimeout(() => {
          if (live) apply((current) => (current.phase === 'loading' ? { phase: 'failed', rows: [] } : current))
        }, REMOTE_TIMEOUT_MS)
        Promise.resolve()
          .then(() => load())
          .then((answer) => {
            if (!live) return
            const outcome = remoteOutcome(answer)
            apply({ phase: outcome.kind, rows: outcome.value })
          })
          .catch(() => { if (live) apply({ phase: 'failed', rows: [] }) })
          .finally(() => { window.clearTimeout(timer) })
        // The cleanup runs when the flyout switches away. `live` stops the old
        // answer from landing, but `started` must also reset or switching back
        // returns early and the list stays on "loading" forever: its own request
        // was abandoned and nothing restarts one.
        return () => {
          live = false
          window.clearTimeout(timer)
          started.current[key] = false
        }
      }

      /** Merge a remote descriptor into one list slot, normalizing ready rows. */
      const writer = (setState, normalize) => (next) => setState((current) => {
        if (typeof next === 'function') return next(current)
        // 'unavailable' means the optional remote is absent — that is a failure
        // the person can act on ("open panel"), never an empty list.
        const phase = next.phase === 'unavailable' ? 'failed' : next.phase
        return { phase, rows: phase === 'ready' ? normalize(next.rows) : [] }
      })

      useEffect(() => {
        // A closed flyout forgets its attempt, so re-opening retries a hung call.
        if (open === null) {
          started.current = { tasks: false, plugins: false }
          return undefined
        }
        if (open === 'tasks') {
          return loadRemote('tasks', loaders.current.scheduleCatalog, writer(setTasks, normalizeTasks))
        }
        if (open === 'plugins') {
          return loadRemote('plugins', loaders.current.pluginInventory, writer(setPlugins, normalizePlugins))
        }
        return undefined
      }, [open])

      useEffect(() => {
        if (open === null) return undefined
        const onKey = (event) => { if (event.key === 'Escape') dismiss() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open, dismiss])

      const clearTimers = useCallback(() => {
        if (openTimer.current !== undefined) { window.clearTimeout(openTimer.current); openTimer.current = undefined }
        if (closeTimer.current !== undefined) { window.clearTimeout(closeTimer.current); closeTimer.current = undefined }
      }, [])
      useEffect(() => clearTimers, [clearTimers])

      /** Arm the dwell timer for one rail entry. */
      const scheduleOpen = useCallback((kind, event) => {
        const rect = event?.currentTarget?.getBoundingClientRect?.()
        clearTimers()
        openTimer.current = window.setTimeout(() => {
          if (rect !== undefined) setAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right })
          setOpen(kind)
        }, OPEN_DELAY_MS)
      }, [clearTimers])

      /** Cancel a pending close while the pointer travels into the flyout. */
      const cancelClose = useCallback(() => {
        if (closeTimer.current !== undefined) { window.clearTimeout(closeTimer.current); closeTimer.current = undefined }
      }, [])

      /**
       * Move keyboard focus from the trigger into the open flyout.
       *
       * Ordinary Tab walks the rail icons first, and each icon opens its own
       * flyout on focus, so tabbing replaced the list before focus could reach
       * it. An explicit entry (Down/Right on the trigger) is what makes the list
       * reachable without inventing a separate roving-tabindex over the rail.
       */
      const focusFlyout = useCallback(() => {
        const panel = panelRef.current
        if (panel === null) return
        const first = panel.querySelector('button:not([data-dsr-skip-focus])')
        if (first !== null) first.focus()
      }, [])

      /** Close after the grace period. */
      const scheduleClose = useCallback(() => {
        clearTimers()
        closeTimer.current = window.setTimeout(() => dismiss(), CLOSE_DELAY_MS)
      }, [clearTimers, dismiss])

      /**
       * Persist a new recent-session count and reflect it immediately.
       *
       * Delegates to the module-level store so the plugin detail page sees the
       * same value on its next render; a local `setState` here was what let the
       * other surface keep — and later re-persist — a stale count.
       * @param next - Requested count; clamped before it is written.
       * @returns Nothing.
       */
      const changeRecentCount = useCallback((next) => { setRecentCount(next) }, [])

      /** Toggle one workspace's pin and persist the new order. */
      const togglePin = useCallback((workspaceId) => {
        setPins((current) => {
          const next = current.includes(workspaceId)
            ? current.filter((id) => id !== workspaceId)
            : [workspaceId, ...current]
          writeStore({ pinnedWorkspaceIds: next })
          return next
        })
      }, [])

      /** Open a workspace and dismiss the flyout. */
      const openWorkspaceFromRail = useCallback((workspaceId) => {
        retract()
        Promise.resolve(openWorkspace(workspaceId)).catch(() => {})
      }, [openWorkspace, retract])

      /**
       * Reveal one existing session and dismiss the flyout.
       *
       * `SessionTarget` is `SessionId | SubagentAddress` — a bare id, not the
       * `{ kind, sessionId }` object this used to pass. The host read that object
       * as "no session named" and fell back to opening a fresh conversation,
       * which is why clicking a recent session started a new one.
       */
      const openSessionFromRail = useCallback((sessionId) => {
        retract()
        try {
          // Synchronous: the host throws on an unknown id before returning, so a
          // promise-level catch would never see it.
          openSession(sessionId)
        } catch (error) {
          console.warn('[dsh-sidebar-rail] open session failed', error)
        }
      }, [openSession, retract])

      /**
       * Draw the flyout shell for one entry.
       *
       * `fixedHeight` pins the panel to a computed height instead of letting it
       * shrink to its content: the workspace flyout uses it so changing the
       * recent count does not resize the panel. Other flyouts pass nothing and
       * stay content-sized.
       *
       * `split` renders the body as a plain flex container instead of the usual
       * scrolling wrapper, so two equal panes inside can divide the panel's
       * remaining height with `flex:1 1 0`. The wrapper has to be skipped
       * entirely: as a scroll container it would collapse its children to content
       * height and the split would never happen.
       * @param title - Flyout heading.
       * @param body - Panel body.
       * @param foot - Optional pinned foot.
       * @param bottomAligned - True for the account seat, which anchors at the foot.
       * @param fixedHeight - Pixel height to occupy, or undefined to fit content.
       * @param split - True to let flex children divide the body height.
       * @returns The flyout element.
       */
      const flyoutShell = (title, body, foot, bottomAligned, fixedHeight, split) => createPortal(h('div', {
        ref: panelRef,
        className: 'dsr-flyout',
        role: 'dialog',
        'aria-label': title,
        ...(split === true ? { 'data-dsr-split': 'true' } : {}),
        style: (() => {
          const placed = flyoutPlacement(anchor, window.innerHeight, bottomAligned)
          return {
            ...(placed.top === undefined ? {} : { top: `${placed.top}px` }),
            ...(placed.bottom === undefined ? {} : { bottom: `${placed.bottom}px` }),
            maxHeight: `${placed.maxHeight}px`,
            ...(fixedHeight === undefined ? {} : { height: `${fixedHeight}px` }),
            left: `${anchor.right + 8}px`,
          }
        })(),
        onPointerEnter: cancelClose,
        onPointerLeave: scheduleClose,
        onKeyDown: (event) => {
          // Escape hands focus back to the trigger so the next Tab continues from
          // the rail instead of jumping to the top of the page.
          if (event.key !== 'Escape') return
          event.stopPropagation()
          retract()
          const trigger = triggerRef.current
          if (trigger !== null) trigger.focus()
        },
      },
      h('div', { className: 'dsr-flyout-head' }, title),
      split === true
        ? h('div', { className: 'dsr-split-body' }, body)
        : h('div', { className: 'dsr-flyout-body' }, body),
      foot === undefined ? null : h('div', { className: 'dsr-flyout-foot' }, foot)), document.body)

      /** Render the flyout for the currently open entry only. */
      const renderFlyout = () => {
        // Computed once per render so the panel height and the two halves cannot
        // disagree about the space available.
        const viewportFlyoutHeight = workspaceFlyoutHeight(
          window.innerHeight,
          flyoutPlacement(anchor, window.innerHeight, false).maxHeight,
        )
        if (open === 'workspace') {
          // Each pane is a fixed header plus its own scroller. The headers stay
          // put while the lists scroll underneath, and the two panes split the
          // leftover height evenly (`flex:1 1 0`), so adding projects or stepping
          // the recent count only makes that pane scroll — neither pane resizes.
          // A divider between them marks the boundary.
          const projectsEmpty = sections.pinnedRows.length === 0 && sections.normalRows.length === 0
          // The flyout head already says "Workspaces"; this pane's fixed row names
          // its two groups instead of repeating that word, and stays put while the
          // rows scroll beneath it.
          const projectsHeadLabel = sections.pinnedRows.length === 0
            ? t('section.workspaces')
            : `${t('section.pinned')} · ${t('section.workspaces')}`
          const projectsPane = h('div', { className: 'dsr-pane' },
            h('div', { className: 'dsr-pane-head' }, projectsHeadLabel),
            h('div', { className: 'dsr-pane-scroll' },
              projectsEmpty
                ? h(Empty, null, t('empty.workspaces'))
                : [
                  sections.pinnedRows.length === 0 ? null : h(Section, { title: t('section.pinned') },
                    sections.pinnedRows.map((row) => h(Row, {
                      key: `pin-${row.id}`,
                      title: row.title,
                      meta: row.meta,
                      pinned: true,
                      pinLabel: t('pin.unpin'),
                      onTogglePin: () => togglePin(row.id),
                      onClick: () => openWorkspaceFromRail(row.id),
                    }))),
                  sections.normalRows.length === 0 ? null : h(Section,
                    { title: sections.pinnedRows.length === 0 ? t('section.pinned') : t('section.workspaces') },
                    sections.normalRows.map((row) => h(Row, {
                      key: `ws-${row.id}`,
                      title: row.title,
                      meta: row.meta,
                      pinLabel: t('pin.pin'),
                      onTogglePin: () => togglePin(row.id),
                      onClick: () => openWorkspaceFromRail(row.id),
                    }))),
                ]))
          const recentPane = h('div', { className: 'dsr-pane' },
            h('div', { className: 'dsr-pane-head' }, t('section.recent')),
            h('div', { className: 'dsr-pane-scroll' },
              sections.recentRows.length === 0
                ? h(Empty, null, t('empty.recent'))
                : sections.recentRows.map((row) => h(Row, {
                  key: `recent-${row.id}`,
                  title: row.title,
                  meta: row.meta,
                  current: row.active === true,
                  status: row.status,
                  statusLabel: t(`status.${row.status}`),
                  onClick: () => openSessionFromRail(row.id),
                }))))
          const stepper = h('div', { className: 'dsr-flyout-foot' },
            h(RecentCountRow, {
              value: recentCount,
              label: t('settings.recentCount'),
              onChange: changeRecentCount,
              min: MIN_RECENT_COUNT,
              max: MAX_RECENT_COUNT,
            }))
          return flyoutShell(t('rail.workspace'), [projectsPane, recentPane],
            stepper, undefined, viewportFlyoutHeight, true)
        }
        if (open === 'tasks') {
          const body = tasks.phase === 'loading' ? h(Empty, null, t('state.loading'))
            : tasks.phase === 'failed' ? h(Empty, null, t('state.failed'))
              : tasks.rows.length === 0 ? h(Empty, null, t('empty.tasks'))
                : h(Section, { title: t('section.tasks') },
                  tasks.rows.map((row) => h(Row, {
                    key: `task-${row.id}`,
                    title: row.title,
                    meta: row.meta,
                    onClick: () => { retract(); selectPanel('schedules') },
                  })))
          return flyoutShell(t('rail.tasks'), body, h(ActionRow, {
            onClick: () => { retract(); selectPanel('schedules') },
          }, t('action.openPanel')))
        }
        if (open === 'plugins') {
          const body = plugins.phase === 'loading' ? h(Empty, null, t('state.loading'))
            : plugins.phase === 'failed' ? h(Empty, null, t('state.failed'))
              : plugins.rows.length === 0 ? h(Empty, null, t('empty.plugins'))
                : h(Section, { title: t('section.plugins') },
                  plugins.rows.map((row) => h(Row, {
                    key: `plugin-${row.name}`,
                    title: row.name,
                    meta: row.meta,
                    onClick: () => { retract(); selectPanel('plugins') },
                  })))
          return flyoutShell(t('rail.plugins'), body, h(ActionRow, {
            onClick: () => { retract(); selectPanel('plugins') },
          }, t('action.openPanel')))
        }
        if (open === 'more') {
          const extras = panelEntries.filter((panel) => panel.id !== 'schedules' && panel.id !== 'plugins')
          return flyoutShell(t('rail.more'),
            h('div', null,
              h(ActionRow, { onClick: () => { retract(); toggleSidebar() } }, t('rail.expand')),
              extras.length === 0 ? null : h(Section, { title: t('section.panels') },
                extras.map((panel) => h(Row, {
                  key: `panel-${panel.id}`,
                  title: panel.label,
                  onClick: () => { retract(); selectPanel(panel.id) },
                })))),
            h('div', { className: 'dsr-hint' }, t('account.hint')))
        }
        if (open === 'account') {
          // Read-only mirror of the host's account menu, plus the wallet balance
          // its sidebar row does not show. Sign-out and payments stay in the
          // host's own menu: this surface must not perform irreversible actions.
          const signedOut = accountSeat.kind === 'signed-out'
          const balances = accountSeat.balances ?? { wallets: [], bonusWallets: [] }
          const links = accountSeat.links ?? {}
          /** One labelled balance line, or nothing when the list is empty. */
          const balanceLine = (label, wallets) => (wallets.length === 0 ? null : h('div', {
            className: 'dsr-account-balance',
          },
          h('span', { className: 'dsr-account-balance-label' }, label),
          h('span', { className: 'dsr-account-balance-value' },
            wallets.map((wallet) => h('span', { key: wallet.currency }, wallet.text)))))
          return flyoutShell(t('rail.account'),
            h('div', null,
              signedOut
                ? h('div', { className: 'dsr-hint' }, t('account.signedOut'))
                : h('div', null,
                  // Signed in but no positive wallet: the host shows the same
                  // "unavailable" wording instead of omitting the line, so the
                  // absence is not mistaken for a zero balance.
                  balances.wallets.length === 0
                    ? h('div', { className: 'dsr-hint' }, t('account.balanceUnavailable'))
                    : balanceLine(t('account.balance'), balances.wallets),
                  balanceLine(t('account.bonus'), balances.bonusWallets)),
              // Platform destinations the host's account section links to. They
              // open in the browser: the desktop bridge for an embedded page is
              // not reachable from a third-party client module.
              links.usageUrl === undefined && links.topUpUrl === undefined
                ? null
                : h('div', { className: 'dsr-account-links' },
                  links.usageUrl === undefined ? null : h('a', {
                    className: 'dsr-account-link',
                    href: links.usageUrl,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                  }, t('account.usage')),
                  links.topUpUrl === undefined ? null : h('a', {
                    className: 'dsr-account-link',
                    href: links.topUpUrl,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                  }, t('account.topUp'))),
              h('div', { className: 'dsr-hint' }, t('account.hint')),
              // The host owns the settings panel and exposes no public
              // "open settings" API to a third-party client module: `layout`
              // only has selectPanel/toggleSidebar, `shortcuts` has no
              // dispatch, and the panel's `open()` lives in a store scoped to
              // `sidebar.settings`, whose single `settings.launcher` cell the
              // host's own account plugin occupies. So the honest entry is the
              // path to it, next to the action that performs the one step this
              // plugin can do for the person.
              h('div', { className: 'dsr-hint' }, t('account.settingsPath')),
              h(ActionRow, { onClick: () => { retract(); toggleSidebar() } }, t('rail.expand'))),
            undefined, true)
        }
        return null
      }

      /** One rail entry: icon button plus its hover and click wiring. */
      const railEntry = (kind, label, icon, current) => h('div', {
        key: kind,
        onPointerEnter: (event) => scheduleOpen(kind, event),
        onPointerLeave: scheduleClose,
      }, h('button', {
        ref: (node) => { if (open === kind) triggerRef.current = node },
        type: 'button',
        className: 'dsr-rail-btn',
        'aria-label': label,
        'aria-current': current === true ? 'page' : undefined,
        'data-dsr-open': open === kind ? 'true' : undefined,
        'aria-haspopup': 'dialog',
        'aria-expanded': open === kind ? 'true' : undefined,
        onFocus: (event) => { triggerRef.current = event.currentTarget; scheduleOpen(kind, event) },
        onKeyDown: (event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowRight') return
          event.preventDefault()
          scheduleOpen(kind, event)
          // The panel may not exist yet when the dwell timer has not fired.
          window.setTimeout(focusFlyout, OPEN_DELAY_MS + 40)
        },
        onClick: () => {
          retract()
          if (kind === 'workspace' || kind === 'more') toggleSidebar()
          else selectPanel(kind === 'tasks' ? 'schedules' : 'plugins')
        },
      }, icon))

      // ------------------------------------------------------------------ rail --
      // A portal is the only surface the host's zero-width, overflow-hidden
      // column cannot clip, and body children inherit the host's no-drag rule;
      // the fixed layer itself starts below the 48px window-chrome strip that
      // holds the traffic lights and the host's own reopen controls.
      const railNav = h('nav', { className: 'dsr-rail', 'aria-label': t('rail.label') },
        h('div', { className: 'dsr-rail-top' },
          railEntry('workspace', t('rail.workspace'), h(IconWorkspace, { size: 20 })),
          railEntry('tasks', t('rail.tasks'), h(IconTasks, { size: 20 }), activePanelId === 'schedules'),
          railEntry('plugins', t('rail.plugins'), h(IconPlugins, { size: 20 }), activePanelId === 'plugins'),
          railEntry('more', t('rail.more'), h(IconMore, { size: 20 }))),
        h('div', { className: 'dsr-rail-spacer' }),
        h('div', {
          onPointerEnter: (event) => scheduleOpen('account', event),
          onPointerLeave: scheduleClose,
        }, h('button', {
          type: 'button',
          className: 'dsr-rail-btn',
          'aria-label': t('rail.account'),
          'data-dsr-open': open === 'account' ? 'true' : undefined,
          onFocus: (event) => scheduleOpen('account', event),
          onClick: () => { retract(); toggleSidebar() },
        }, h(AccountAvatar, { seat: accountSeat }))))
      // Two portals: the thin edge strip that catches the pointer, and the rail
      // itself, which slides in over it. The strip is what makes a hidden rail
      // discoverable without covering the conversation tabs.
      return createPortal(h('div', null,
        // The strip only ever reveals. It deliberately has no pointerleave: the
        // rail slides on top of it, so a leave-from-the-strip handler fired the
        // moment the rail appeared and the two states oscillated. Retraction is
        // decided from the pointer's position instead (effect below).
        h('div', {
          className: 'dsr-rail-hotzone',
          onPointerEnter: () => setRevealed(true),
        }),
        h('div', {
          className: 'dsr-rail-float',
          'data-dsr-revealed': revealed === true ? 'true' : undefined,
          onPointerEnter: () => { cancelRetract(); setRevealed(true) },
          // Leaving the rail retracts it, after a short delay so a pointer that
          // merely crosses the edge does not make it flicker. The reveal strip has
          // no leave handler of its own, which is what keeps the two states from
          // chasing each other.
          onPointerLeave: () => { if (open === null) scheduleRetract() },
          onPointerMove: cancelRetract,
          onFocusCapture: () => setRevealed(true),
          // Leaving the rail region with focus still inside would hide it under
          // the keyboard user, so only collapse when focus really left.
          onBlurCapture: (event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return
            if (open === null) setRevealed(false)
          },
        }, railNav, renderFlyout())), document.body)
    }

    // ------------------------------------------------------------------ apply --
    return {
      inject: ['slots', 'locale', 'layout', 'uiWorkspace', 'remote'],

      /**
       * Register the rail shell, its dictionary and its style sheet.
       * @param ctx - Client root context.
       * @returns Nothing.
       */
      apply(ctx) {
        // A Client plugin's apply runs during page boot. Any throw here would
        // cost the user the rail, so registration is caught and logged once; the
        // shipped sidebar is untouched either way.
        try {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-sidebar-rail: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-sidebar-rail', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'dsh-sidebar-rail: styles')

        // Panel metadata: read the same ledger the shipped shell reads, so the
        // More flyout lists the real navigation entries.
        const panelSource = (() => {
          let snapshot = []
          const listeners = new Set()
          const read = () => {
            const entries = ctx.slots.entriesOfSlot('sidebar.panellist') ?? []
            const next = entries.map(({ options }) => ({
              id: options.id,
              order: options.order ?? 0,
              label: typeof options.label === 'function'
                ? String(options.label() ?? options.id)
                : String(options.label ?? options.id),
            })).sort((a, b) => a.order - b.order)
            const same = snapshot.length === next.length
              && snapshot.every((row, index) => row.id === next[index].id && row.label === next[index].label)
            if (!same) {
              snapshot = next
              for (const listener of [...listeners]) listener()
            }
          }
          read()
          ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', read), 'dsh-sidebar-rail: panel entries')
          ctx.effect(() => ctx.locale.subscribe(read), 'dsh-sidebar-rail: panel labels')
          return {
            getSnapshot: () => snapshot,
            subscribe: (listener) => {
              listeners.add(listener)
              return () => { listeners.delete(listener) }
            },
          }
        })()

        // Mirrors the host `LocaleSnapshot` shape but carries only what the
        // column needs: the active locale id, under the host's own field name.
        const localeSource = {
          getSnapshot: () => {
            const snapshot = ctx.locale.getSnapshot?.() ?? ctx.locale.getLocale?.() ?? null
            return { active: resolveLocaleId(snapshot) }
          },
          subscribe: (listener) => ctx.locale.subscribe(listener),
        }

        const injectProps = () => ({
          toggleSidebar: () => { ctx.layout.toggleSidebar() },
          selectPanel: (id) => { ctx.layout.selectPanel(id) },
          openWorkspace: (workspaceId) => ctx.uiWorkspace.openWorkspace(workspaceId),
          openSession: (target) => { ctx.uiWorkspace.openSession(target) },
          panels: panelSource,
          locale: localeSource,
          scheduleCatalog: async () => {
            const remote = ctx.get('remote.schedule')
            return remote === undefined || typeof remote.catalog !== 'function' ? null : remote.catalog()
          },
          // The rail lists what the person installed and switched on, so it reads
          // the bundle listing rather than the Loader inventory: only a bundle
          // carries `official`, which is what separates the host's own plugins
          // from the user's (the inventory exposes just moduleName/enabled).
          pluginInventory: async () => {
            const manager = ctx.get('remote.pluginManager')
            return manager === undefined || typeof manager.listBundles !== 'function' ? null : manager.listBundles()
          },
          // The account seat shows the host's own avatar, so read the profile the
          // host's sidebar reads. Failures degrade to the neutral fallback glyph.
          // Two calls, because they fail differently: `getState` takes no
          // identity and answers the sign-in question alone, so a missing build
          // version can never cost us the signed-out rendering. Only a signed-in
          // account reaches `getProfile`, which does require the identity.
          //
          // Every path returns through `withAccountExtras`: `getState` carries
          // `links` for signed-out accounts too, and dropping them there made the
          // usage/top-up entries vanish for anyone not signed in. The whole read
          // is also raced against `REMOTE_TIMEOUT_MS` (AGENTS.md hard rule 8): a
          // hung Host call must end in a visible failure state, never in a
          // forever-"balance unavailable" seat.
          accountSeat: async () => {
            const account = ctx.get('remote.account')
            if (account === undefined || typeof account.getState !== 'function') {
              return withAccountExtras({ kind: 'unknown', avatarUrl: undefined }, null, null)
            }
            let timedOut = false
            /** Timer handle; cleared on every exit so a settled read leaks nothing. */
            let timerId
            const timer = new Promise((resolve) => {
              timerId = window.setTimeout(() => {
                timedOut = true
                console.warn('[dsh-sidebar-rail] account read timed out')
                resolve(null)
              }, REMOTE_TIMEOUT_MS)
            })
            const read = (async () => {
              let view
              try {
                view = await account.getState()
              } catch (error) {
                console.warn('[dsh-sidebar-rail] account state unavailable', error)
                return withAccountExtras({ kind: 'unknown', avatarUrl: undefined }, null, null)
              }
              // `view` is already in hand here: carry its `links` even when the
              // rest of the read stops early.
              const viewValue = view !== null && typeof view === 'object' && 'value' in view ? view.value : null
              const signedIn = viewValue !== null && typeof viewValue === 'object'
                && viewValue.status === 'credential-stored'
              if (!signedIn) return withAccountExtras(accountSeatState(view, null), view, null)
              const metadata = accountClientMetadata(
                resolveLocaleId(ctx.locale.getSnapshot?.() ?? null),
                clientBuildVersion(),
                new Date().getTimezoneOffset(),
              )
              if (metadata === null) {
                console.warn('[dsh-sidebar-rail] account calls skipped: no client build version')
                return withAccountExtras({ kind: 'signed-in', avatarUrl: undefined }, view, null)
              }
              if (typeof account.getProfile !== 'function') {
                return withAccountExtras({ kind: 'signed-in', avatarUrl: undefined }, view, null)
              }
              // Profile and balance are independent queries on the host side, so one
              // failing must not blank the other: each keeps its own fallback.
              const [profile, balance] = await Promise.all([
                account.getProfile(metadata).catch((error) => {
                  console.warn('[dsh-sidebar-rail] account profile unavailable', error)
                  return null
                }),
                typeof account.getBalance === 'function'
                  ? account.getBalance(metadata).catch((error) => {
                    console.warn('[dsh-sidebar-rail] account balance unavailable', error)
                    return null
                  })
                  : Promise.resolve(null),
              ])
              return withAccountExtras(accountSeatState(view, profile), view, balance)
            })()
            try {
              // The losing side of the race is left to settle on its own; `read`
              // already swallows its own failures, and a late answer must not
              // write state (the caller's `live` flag covers that).
              const result = await Promise.race([read, timer])
              if (timedOut || result === null) {
                return withAccountExtras({ kind: 'unknown', avatarUrl: undefined }, null, null)
              }
              return result
            } finally {
              window.clearTimeout(timerId)
            }
          },
          fallbackText: 'Sidebar rail unavailable',
        })

        // Additive only: the shipped sidebar is never replaced, so search, view
        // options, the settings seat and the account menu stay exactly as
        // shipped. The one state the host leaves empty is the macOS collapsed
        // column (zero width, no rail), and that is the seat this plugin fills.
        const registerOverlay = () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-sidebar-rail.rail',
          order: 10,
          locale: NS,
          inject: injectProps,
        }, (props) => h(Boundary, { fallbackText: props.fallbackText }, h(RailOverlay, props))))

        ctx.effect(registerOverlay, 'dsh-sidebar-rail: rail overlay')

        // The plugin detail page's configuration seat. `key` must be the package
        // name, the same contract the host's own bundles use.
        const registerSettings = () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: '@skylerfee/dsh-sidebar-rail',
          locale: NS,
        }, RailSettings))

        ctx.effect(registerSettings, 'dsh-sidebar-rail: settings panel')
        } catch (error) {
          console.error('[dsh-sidebar-rail] apply failed; the shipped sidebar is unaffected', error)
        }
      },
    }
  },
})
