/**
 * dsh-sidebar-rail — Client half.
 *
 * Replaces the DSH sidebar shell (`sidebar` slot) with a Codex-style navigation
 * column:
 *
 *   - collapsed: a 56px icon rail whose entries stay visible (Workspaces, Tasks,
 *     Plugins, More) with a user avatar pinned to the foot; hovering an entry
 *     opens its list in a flyout beside the rail.
 *   - expanded: the familiar DSH column — brand row, New Session, panel rows,
 *     the grouped workspace/session list, and a settings entry at the foot.
 *
 * Contract notes (verified against the shipped client):
 *   - `sidebar` is a `single` slot already occupied by ui-sidebar, which
 *     declared its seven child holes. Declaring those holes again throws
 *     "slot is already declared", so this registration omits `children` and
 *     therefore receives no `renderSlot`; every surface is drawn here.
 *   - A static `__ModuleLoader__` package must pass `priority: -1` to win the
 *     single slot; the dynamic runner would assign a negative priority itself.
 *   - `collapsed`, `width`, `drawer` and the standard hooks (`useSessions`,
 *     `useWorkspaces`, `usePanelInfo`) arrive as props; no service injection is
 *     needed for list data.
 *
 * Workspace pinning and fold-state persistence live in this plugin's own
 * localStorage key; the Host is never written to.
 */
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-rail',
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
    /** Recent sessions shown in the "recent" section. */
    const RECENT_LIMIT = 10

    // ---------------------------------------------------------------- locale --
    const zh = {
      'rail.label': '导航图标轨',
      'rail.workspace': '工作区',
      'rail.tasks': '定时任务',
      'rail.plugins': '插件',
      'rail.more': '更多',
      'rail.account': '账号与设置',
      'rail.expand': '展开侧栏',
      'rail.newSession': '新会话',
      'section.pinned': '置顶项目',
      'section.workspaces': '项目',
      'section.recent': '最近会话',
      'section.tasks': '已创建的任务',
      'section.plugins': '已启用插件',
      'section.panels': '其他面板',
      'pin.pin': '置顶项目',
      'pin.unpin': '取消置顶',
      'empty.workspaces': '还没有工作区',
      'empty.recent': '还没有会话',
      'empty.tasks': '还没有定时任务',
      'empty.plugins': '没有已启用的插件',
      'state.loading': '加载中…',
      'state.failed': '加载失败，可打开面板查看',
      'action.openPanel': '打开面板',
      'action.settings': '设置',
      'settings.unavailable': '请展开侧栏后从底部进入设置',
      'account.hint': '账号信息与用量由设置中的账号页提供。',
      'workspace.noSessions': '暂无会话',
    }
    const en = {
      'rail.label': 'Navigation rail',
      'rail.workspace': 'Workspaces',
      'rail.tasks': 'Scheduled tasks',
      'rail.plugins': 'Plugins',
      'rail.more': 'More',
      'rail.account': 'Account and settings',
      'rail.expand': 'Expand sidebar',
      'rail.newSession': 'New session',
      'section.pinned': 'Pinned projects',
      'section.workspaces': 'Projects',
      'section.recent': 'Recent sessions',
      'section.tasks': 'Scheduled tasks',
      'section.plugins': 'Enabled plugins',
      'section.panels': 'Other panels',
      'pin.pin': 'Pin project',
      'pin.unpin': 'Unpin project',
      'empty.workspaces': 'No workspaces yet',
      'empty.recent': 'No sessions yet',
      'empty.tasks': 'No scheduled tasks',
      'empty.plugins': 'No enabled plugins',
      'state.loading': 'Loading…',
      'state.failed': 'Could not load; open the panel instead',
      'action.openPanel': 'Open panel',
      'action.settings': 'Settings',
      'settings.unavailable': 'Expand the sidebar to reach Settings at its foot',
      'account.hint': 'Account and usage details live in the Settings account page.',
      'workspace.noSessions': 'No sessions',
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

    // ---------------------------------------------------------------- styles --
    const CSS = `
.dsr-root { display:flex; flex-direction:column; height:100%; min-height:0; width:100%; }
.dsr-root * { box-sizing:border-box; }

.dsr-rail { display:flex; flex-direction:column; align-items:center; height:100%; padding:10px 0 8px; gap:4px; }
.dsr-rail-top { display:flex; flex-direction:column; align-items:center; gap:4px; }
.dsr-rail-spacer { flex:1 1 auto; min-height:8px; }
.dsr-rail-btn { display:flex; align-items:center; justify-content:center; width:36px; height:36px; padding:0;
  border:none; background:transparent; border-radius:var(--dsw-radius-md, 8px);
  color:var(--dsw-alias-text-tertiary, #64748b); cursor:pointer;
  transition:background-color 120ms ease, color 120ms ease; }
.dsr-rail-btn:hover, .dsr-rail-btn:focus-visible { background:var(--dsw-alias-bg-secondary, rgba(120,130,150,.14));
  color:var(--dsw-alias-text-primary, #0f172a); outline:none; }
.dsr-rail-btn[aria-current="page"], .dsr-rail-btn[data-dsr-open="true"] {
  background:var(--dsw-alias-bg-secondary, rgba(120,130,150,.14)); color:var(--dsw-alias-text-primary, #0f172a); }
.dsr-avatar-dot { display:flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:50%;
  background:var(--dsw-alias-bg-tertiary, rgba(120,130,150,.26));
  color:var(--dsw-alias-text-primary, #0f172a); font-size:11px; font-weight:600; }

.dsr-flyout { position:fixed; z-index:2147483000; width:288px; max-height:calc(100vh - 32px);
  display:flex; flex-direction:column;
  background:var(--dsw-alias-bg-elevated, #fff); color:var(--dsw-alias-text-primary, #0f172a);
  border:1px solid var(--dsw-alias-border-subtle, rgba(120,130,150,.22));
  border-radius:var(--dsw-radius-lg, 12px);
  box-shadow:var(--dsw-alias-shadow-popover, 0 12px 32px rgba(15,23,42,.18));
  overflow:hidden; animation:dsr-in 120ms ease-out; }
@keyframes dsr-in { from { opacity:0; transform:translateX(-2px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) { .dsr-flyout { animation:none; } }
.dsr-flyout-head { padding:10px 12px 4px; font-size:12px; font-weight:600;
  color:var(--dsw-alias-text-secondary, #475569); }
.dsr-flyout-body { overflow-y:auto; padding:2px 6px 8px; min-height:0; }
.dsr-flyout-foot { border-top:1px solid var(--dsw-alias-border-subtle, rgba(120,130,150,.22)); padding:6px; }
.dsr-section-title { padding:10px 6px 4px; font-size:11px; font-weight:600; letter-spacing:.04em;
  text-transform:uppercase; color:var(--dsw-alias-text-tertiary, #94a3b8); }
.dsr-row { display:flex; align-items:center; gap:6px; width:100%; min-height:30px; padding:4px 6px;
  border:none; background:transparent; border-radius:var(--dsw-radius-sm, 6px); color:inherit;
  font:inherit; font-size:13px; text-align:left; cursor:pointer; }
.dsr-row:hover, .dsr-row:focus-visible { background:var(--dsw-alias-bg-secondary, rgba(120,130,150,.14)); outline:none; }
.dsr-row-wrap { display:flex; align-items:center; border-radius:var(--dsw-radius-sm, 6px); }
.dsr-row-wrap:hover { background:var(--dsw-alias-bg-secondary, rgba(120,130,150,.14)); }
.dsr-row-wrap:hover .dsr-row { background:transparent; }
.dsr-row-main { display:flex; flex-direction:column; min-width:0; flex:1 1 auto; }
.dsr-row-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsr-row-meta { font-size:11px; color:var(--dsw-alias-text-tertiary, #94a3b8);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsr-row-action { display:flex; align-items:center; justify-content:center; width:22px; height:22px; flex:none;
  margin-right:4px; border:none; background:transparent; border-radius:var(--dsw-radius-sm, 6px);
  cursor:pointer; color:var(--dsw-alias-text-tertiary, #94a3b8); opacity:0; }
.dsr-row-wrap:hover .dsr-row-action, .dsr-row-action:focus-visible { opacity:1; }
.dsr-row-action:hover { background:var(--dsw-alias-bg-tertiary, rgba(120,130,150,.26));
  color:var(--dsw-alias-text-primary, #0f172a); }
.dsr-row-wrap[data-pinned="true"] .dsr-row-action { opacity:1; }
.dsr-empty { padding:14px 8px; font-size:12px; color:var(--dsw-alias-text-tertiary, #94a3b8); text-align:center; }
.dsr-hint { padding:4px 6px 8px; font-size:11px; line-height:1.5;
  color:var(--dsw-alias-text-tertiary, #94a3b8); }

.dsr-wide { display:flex; flex-direction:column; height:100%; min-height:0; padding:6px 8px; }
.dsr-wide-brand { display:flex; align-items:center; gap:8px; height:34px; flex:none;
  font-size:14px; font-weight:600; overflow:hidden; }
.dsr-wide-brand-mark { display:flex; align-items:center; justify-content:center; width:24px; height:24px; flex:none; }
.dsr-wide-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsr-wide-new { display:flex; align-items:center; gap:8px; width:100%; height:34px; margin:4px 0 6px;
  padding:0 8px; border:1px solid var(--dsw-alias-border-subtle, rgba(120,130,150,.22));
  background:transparent; border-radius:var(--dsw-radius-md, 8px);
  color:var(--dsw-alias-text-primary, #0f172a); font:inherit; font-size:13px; cursor:pointer; flex:none; }
.dsr-wide-new:hover { background:var(--dsw-alias-bg-secondary, rgba(120,130,150,.14)); }
.dsr-wide-panels { display:flex; flex-direction:column; gap:2px; padding:0 0 4px; flex:none; }
.dsr-wide-panel { display:flex; align-items:center; gap:8px; width:100%; height:30px; padding:0 8px;
  border:none; background:transparent; border-radius:var(--dsw-radius-md, 8px);
  color:var(--dsw-alias-text-primary, #0f172a); font:inherit; font-size:13px; text-align:left; cursor:pointer; }
.dsr-wide-panel:hover { background:var(--dsw-alias-bg-secondary, rgba(120,130,150,.14)); }
.dsr-wide-panel[aria-current="page"] { background:var(--dsw-alias-bg-secondary, rgba(120,130,150,.14)); }
.dsr-wide-list { flex:1 1 auto; min-height:0; overflow-y:auto; padding-bottom:4px; }
.dsr-ws { display:flex; align-items:center; gap:6px; width:100%; height:30px; padding:0 6px;
  border:none; background:transparent; border-radius:var(--dsw-radius-sm, 6px);
  color:var(--dsw-alias-text-primary, #0f172a); font:inherit; font-size:13px; text-align:left; cursor:pointer; }
.dsr-ws:hover { background:var(--dsw-alias-bg-secondary, rgba(120,130,150,.14)); }
.dsr-ws-icon { display:flex; align-items:center; justify-content:center; width:16px; height:16px;
  color:var(--dsw-alias-text-tertiary, #94a3b8); flex:none; }
.dsr-ws-title { flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsr-ws-count { font-size:11px; color:var(--dsw-alias-text-tertiary, #94a3b8); flex:none; }
.dsr-session { display:block; width:100%; padding:4px 6px 4px 26px; border:none; background:transparent;
  border-radius:var(--dsw-radius-sm, 6px); color:var(--dsw-alias-text-secondary, #475569);
  font:inherit; font-size:12.5px; text-align:left; cursor:pointer;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsr-session:hover { background:var(--dsw-alias-bg-secondary, rgba(120,130,150,.14));
  color:var(--dsw-alias-text-primary, #0f172a); }
.dsr-wide-foot { flex:none; border-top:1px solid var(--dsw-alias-border-subtle, rgba(120,130,150,.22));
  padding-top:6px; margin-top:2px; }
.dsr-foot-btn { display:flex; align-items:center; gap:8px; width:100%; height:32px; padding:0 8px;
  border:none; background:transparent; border-radius:var(--dsw-radius-md, 8px);
  color:var(--dsw-alias-text-primary, #0f172a); font:inherit; font-size:13px; text-align:left; cursor:pointer; }
.dsr-foot-btn:hover { background:var(--dsw-alias-bg-secondary, rgba(120,130,150,.14)); }
.dsr-fallback { padding:12px; font-size:12px; color:var(--dsw-alias-text-tertiary, #94a3b8); }
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
    const IconPlus = (p) => h(Icon, p, h('path', { d: 'M12 5.5v13M5.5 12h13' }))
    const IconGear = (p) => h(Icon, p,
      h('circle', { cx: 12, cy: 12, r: 3.1 }),
      h('path', { d: 'M12 3.6v2.2M12 18.2v2.2M4.9 7.8l1.9 1.1M17.2 15.1l1.9 1.1M4.9 16.2l1.9-1.1M17.2 8.9l1.9-1.1' }))
    const IconDot = () => h('svg', { viewBox: '0 0 8 8', width: 8, height: 8, 'aria-hidden': true },
      h('circle', { cx: 4, cy: 4, r: 3, fill: 'currentColor' }))
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
     * Trim an absolute path to its last two segments for hint text.
     * @param path - Canonical directory path.
     * @returns Shortened path.
     */
    function shortPath(path) {
      if (typeof path !== 'string' || path.length === 0) return ''
      const parts = path.split(/[\\/]+/).filter(Boolean)
      return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`
    }

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

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        console.error('[dsh-sidebar-rail] render failed', error)
      }

      render() {
        return this.state.failed
          ? h('div', { className: 'dsr-fallback', role: 'status' }, this.props.fallbackText)
          : this.props.children
      }
    }

    // ------------------------------------------------------------ primitives --
    /**
     * One workspace/list row with an optional trailing pin action.
     * @param props - Row content, click handler and pin affordance.
     * @returns The row element.
     */
    function Row({ title, meta, onClick, onTogglePin, pinLabel, pinned }) {
      const main = h('button', {
        type: 'button',
        className: 'dsr-row',
        style: { flex: '1 1 auto', minWidth: 0, background: 'transparent' },
        onClick,
      },
      h('span', { className: 'dsr-row-main' },
        h('span', { className: 'dsr-row-title' }, title),
        meta === undefined || meta === '' ? null : h('span', { className: 'dsr-row-meta' }, meta)))
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
    /**
     * Split workspaces into pinned and normal rows and collect recent sessions.
     * @param items - WorkspaceView[].
     * @param sessions - SessionListState.
     * @param archivedIds - Archived session ids.
     * @param pinnedIds - Locally pinned workspace ids, most recent first.
     * @param language - Active locale id.
     * @returns Pinned rows, normal rows and recent session rows.
     */
    function deriveSections(items, sessions, archivedIds, pinnedIds, language) {
      const list = Array.isArray(items) ? items : []
      const pinnedRank = new Map((Array.isArray(pinnedIds) ? pinnedIds : []).map((id, index) => [id, index]))
      const archived = new Set(Array.isArray(archivedIds) ? archivedIds : [])
      const pinnedRows = []
      const normalRows = []
      for (const item of list) {
        if (item == null) continue
        const row = {
          id: item.workspaceId,
          title: item.title ?? shortPath(item.path) ?? String(item.workspaceId),
          meta: shortPath(item.path),
          sessionIds: Array.isArray(item.sessionIds) ? item.sessionIds : [],
        }
        if (pinnedRank.has(row.id)) pinnedRows.push(row)
        else normalRows.push(row)
      }
      pinnedRows.sort((a, b) => (pinnedRank.get(a.id) ?? 0) - (pinnedRank.get(b.id) ?? 0))
      const byId = sessions?.byId ?? {}
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
        })
      }
      recentRows.sort((a, b) => b.updatedAt - a.updatedAt)
      return { pinnedRows, normalRows, recentRows: recentRows.slice(0, RECENT_LIMIT) }
    }

    /**
     * Resolve the sessions of one workspace, newest first, minus archived rows.
     * @param workspace - One workspace row carrying its session ids.
     * @param sessions - SessionListState.
     * @param archivedIds - Archived session ids.
     * @returns Session rows for the expanded list.
     */
    function workspaceSessions(workspace, sessions, archivedIds) {
      const byId = sessions?.byId ?? {}
      const archived = new Set(Array.isArray(archivedIds) ? archivedIds : [])
      const rows = []
      for (const id of workspace.sessionIds ?? []) {
        const entry = byId[id]
        if (entry == null || archived.has(id) || entry.blank === true) continue
        if (entry.origin === 'subagent') continue
        rows.push({
          id,
          title: entry.displayTitle ?? entry.title ?? String(id),
          updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
        })
      }
      rows.sort((a, b) => b.updatedAt - a.updatedAt)
      return rows
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
     * Normalize an unknown plugin inventory answer into enabled plugin rows.
     * @param answer - Whatever the plugin inventory remote returned.
     * @returns Enabled plugin rows.
     */
    function normalizePlugins(answer) {
      const value = answer !== null && typeof answer === 'object' && 'value' in answer ? answer.value : answer
      const list = Array.isArray(value) ? value
        : Array.isArray(value?.entries) ? value.entries
          : Array.isArray(value?.items) ? value.items
            : Array.isArray(value?.plugins) ? value.plugins
              : Array.isArray(value?.bundles) ? value.bundles : []
      const rows = []
      for (const plugin of list) {
        if (plugin == null) continue
        if (plugin.enabled === false) continue
        const name = plugin.moduleName ?? plugin.name ?? plugin.packageName ?? plugin.title ?? plugin.id ?? ''
        if (name === '') continue
        const meta = typeof plugin.diagnostic === 'string' ? plugin.diagnostic
          : plugin.version === undefined ? '' : `v${plugin.version}`
        rows.push({ name: String(name), meta })
      }
      return rows
    }

    // ------------------------------------------------------------------ root --
    /**
     * The sidebar column: rail when collapsed, the expanded DSH-style column otherwise.
     * @param props - Owner props, standard hooks, injected face and translator.
     * @returns The sidebar element.
     */
    function SidebarRailRoot(props) {
      const {
        collapsed, drawer, toggleSidebar, selectPanel, startSession,
        panels, locale, openWorkspace, openSession, scheduleCatalog,
        pluginInventory, openSettings, useSessions, useWorkspaces, usePanelInfo,
        fallbackText,
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
      const panelEntries = useObservable(panels, identity)
      const language = useObservable(locale, (snapshot) => snapshot?.id ?? 'en')

      const [pins, setPins] = useState(() => {
        const stored = readStore().pinnedWorkspaceIds
        return Array.isArray(stored) ? stored.map(String) : []
      })
      const [open, setOpen] = useState(null)
      const [anchor, setAnchor] = useState({ top: 12, right: 56 })
      const [tasks, setTasks] = useState({ phase: 'idle', rows: [] })
      const [plugins, setPlugins] = useState({ phase: 'idle', rows: [] })
      const openTimer = useRef(undefined)
      const closeTimer = useRef(undefined)
      const restoredRef = useRef(false)

      // Persist the fold state, and restore the stored one once after mount.
      useEffect(() => {
        if (!restoredRef.current) {
          restoredRef.current = true
          const stored = readStore().collapsed
          if (typeof stored === 'boolean' && stored !== collapsed) {
            toggleSidebar()
            return
          }
        }
        writeStore({ collapsed })
      }, [collapsed, toggleSidebar])

      const sections = useMemo(
        () => deriveSections(workspaceItems, sessions, archivedIds, pins, language),
        [workspaceItems, sessions, archivedIds, pins, language],
      )

      // Lazy remote data, loaded when a flyout first opens.
      useEffect(() => {
        if (open !== 'tasks' || tasks.phase !== 'idle') return undefined
        let live = true
        setTasks({ phase: 'loading', rows: [] })
        Promise.resolve()
          .then(() => scheduleCatalog())
          .then((answer) => { if (live) setTasks({ phase: 'ready', rows: normalizeTasks(answer) }) })
          .catch(() => { if (live) setTasks({ phase: 'failed', rows: [] }) })
        return () => { live = false }
      }, [open, tasks.phase, scheduleCatalog])
      useEffect(() => {
        if (open !== 'plugins' || plugins.phase !== 'idle') return undefined
        let live = true
        setPlugins({ phase: 'loading', rows: [] })
        Promise.resolve()
          .then(() => pluginInventory())
          .then((answer) => { if (live) setPlugins({ phase: 'ready', rows: normalizePlugins(answer) }) })
          .catch(() => { if (live) setPlugins({ phase: 'failed', rows: [] }) })
        return () => { live = false }
      }, [open, plugins.phase, pluginInventory])

      useEffect(() => {
        if (open === null) return undefined
        const onKey = (event) => { if (event.key === 'Escape') setOpen(null) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])

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
          if (rect !== undefined) setAnchor({ top: rect.top, right: rect.right })
          setOpen(kind)
        }, OPEN_DELAY_MS)
      }, [clearTimers])

      /** Cancel a pending close while the pointer travels into the flyout. */
      const cancelClose = useCallback(() => {
        if (closeTimer.current !== undefined) { window.clearTimeout(closeTimer.current); closeTimer.current = undefined }
      }, [])

      /** Close after the grace period. */
      const scheduleClose = useCallback(() => {
        clearTimers()
        closeTimer.current = window.setTimeout(() => setOpen(null), CLOSE_DELAY_MS)
      }, [clearTimers])

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
        setOpen(null)
        Promise.resolve(openWorkspace(workspaceId)).catch(() => {})
      }, [openWorkspace])

      /** Open one session and dismiss the flyout. */
      const openSessionFromRail = useCallback((sessionId) => {
        setOpen(null)
        Promise.resolve(openSession({ kind: 'session', sessionId })).catch(() => {})
      }, [openSession])

      /**
       * Draw the flyout shell for one entry.
       * @param title - Flyout heading.
       * @param body - Scrollable body.
       * @param foot - Optional pinned foot.
       * @returns The flyout element.
       */
      const flyoutShell = (title, body, foot) => createPortal(h('div', {
        className: 'dsr-flyout',
        role: 'dialog',
        'aria-label': title,
        style: {
          top: `${Math.max(12, Math.min(anchor.top, Math.max(12, window.innerHeight - 200)))}px`,
          left: `${anchor.right + 8}px`,
        },
        onPointerEnter: cancelClose,
        onPointerLeave: scheduleClose,
      },
      h('div', { className: 'dsr-flyout-head' }, title),
      h('div', { className: 'dsr-flyout-body' }, body),
      foot === undefined ? null : h('div', { className: 'dsr-flyout-foot' }, foot)), document.body)

      /** Render the flyout for the currently open entry only. */
      const renderFlyout = () => {
        if (open === 'workspace') {
          const body = sections.pinnedRows.length === 0 && sections.normalRows.length === 0
            ? h(Empty, null, t('empty.workspaces'))
            : h('div', null,
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
              sections.normalRows.length === 0 ? null : h(Section, { title: t('section.workspaces') },
                sections.normalRows.map((row) => h(Row, {
                  key: `ws-${row.id}`,
                  title: row.title,
                  meta: row.meta,
                  pinLabel: t('pin.pin'),
                  onTogglePin: () => togglePin(row.id),
                  onClick: () => openWorkspaceFromRail(row.id),
                }))))
          const foot = sections.recentRows.length === 0 ? undefined : h(Section, { title: t('section.recent') },
            sections.recentRows.slice(0, 5).map((row) => h(Row, {
              key: `recent-${row.id}`,
              title: row.title,
              meta: row.meta,
              onClick: () => openSessionFromRail(row.id),
            })))
          return flyoutShell(t('rail.workspace'), body, foot)
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
                    onClick: () => { setOpen(null); selectPanel('schedules') },
                  })))
          return flyoutShell(t('rail.tasks'), body, h(ActionRow, {
            onClick: () => { setOpen(null); selectPanel('schedules') },
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
                    onClick: () => { setOpen(null); selectPanel('plugins') },
                  })))
          return flyoutShell(t('rail.plugins'), body, h(ActionRow, {
            onClick: () => { setOpen(null); selectPanel('plugins') },
          }, t('action.openPanel')))
        }
        if (open === 'more') {
          const extras = panelEntries.filter((panel) => panel.id !== 'schedules' && panel.id !== 'plugins')
          return flyoutShell(t('rail.more'),
            h('div', null,
              h(ActionRow, { onClick: () => { setOpen(null); toggleSidebar() } }, t('rail.expand')),
              extras.length === 0 ? null : h(Section, { title: t('section.panels') },
                extras.map((panel) => h(Row, {
                  key: `panel-${panel.id}`,
                  title: panel.label,
                  onClick: () => { setOpen(null); selectPanel(panel.id) },
                })))),
            h('div', { className: 'dsr-hint' }, t('account.hint')))
        }
        if (open === 'account') {
          return flyoutShell(t('rail.account'),
            h('div', null,
              h('div', { className: 'dsr-hint' }, t('account.hint')),
              h(ActionRow, {
                onClick: () => { setOpen(null); if (!openSettings()) window.alert(t('settings.unavailable')) },
              }, t('action.settings'))))
        }
        return null
      }

      /** One rail entry: icon button plus its hover and click wiring. */
      const railEntry = (kind, label, icon, current) => h('div', {
        key: kind,
        onPointerEnter: (event) => scheduleOpen(kind, event),
        onPointerLeave: scheduleClose,
      }, h('button', {
        type: 'button',
        className: 'dsr-rail-btn',
        'aria-label': label,
        'aria-current': current === true ? 'page' : undefined,
        'data-dsr-open': open === kind ? 'true' : undefined,
        onFocus: (event) => scheduleOpen(kind, event),
        onClick: () => {
          setOpen(null)
          if (kind === 'workspace' || kind === 'more') toggleSidebar()
          else selectPanel(kind === 'tasks' ? 'schedules' : 'plugins')
        },
      }, icon))

      // ------------------------------------------------------------------ rail --
      if (collapsed && drawer !== true) {
        return h('div', { className: 'dsr-root' },
          h('nav', { className: 'dsr-rail', 'aria-label': t('rail.label') },
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
              onClick: () => { setOpen(null); toggleSidebar() },
            }, h('span', { className: 'dsr-avatar-dot', 'aria-hidden': true }, 'AI')))),
          renderFlyout())
      }

      // ------------------------------------------------------------------ wide --
      /** Workspace rows with their own sessions directly beneath. */
      const workspaceBlock = (rows, pinnedSection) => rows.map((row) => {
        const sessionsOfRow = workspaceSessions(row, sessions, archivedIds)
        return h('div', { key: `${pinnedSection === true ? 'p' : 'n'}-${row.id}` },
          h('div', { className: 'dsr-row-wrap', 'data-pinned': pinnedSection === true ? 'true' : undefined },
            h('button', {
              type: 'button',
              className: 'dsr-ws',
              onClick: () => { Promise.resolve(openWorkspace(row.id)).catch(() => {}) },
            },
            h('span', { className: 'dsr-ws-icon' }, h(IconDot)),
            h('span', { className: 'dsr-ws-title' }, row.title),
            h('span', { className: 'dsr-ws-count' }, String(sessionsOfRow.length))),
            h('button', {
              type: 'button',
              className: 'dsr-row-action',
              'aria-label': pinnedSection === true ? t('pin.unpin') : t('pin.pin'),
              title: pinnedSection === true ? t('pin.unpin') : t('pin.pin'),
              onClick: () => togglePin(row.id),
            }, h(IconPin))),
          sessionsOfRow.length === 0
            ? h('div', { className: 'dsr-session' }, t('workspace.noSessions'))
            : sessionsOfRow.map((session) => h('button', {
              key: `s-${session.id}`,
              type: 'button',
              className: 'dsr-session',
              title: session.title,
              onClick: () => openSessionFromRail(session.id),
            }, session.title)))
      })

      return h('div', { className: 'dsr-root' },
        h('div', { className: 'dsr-wide' },
          h('div', { className: 'dsr-wide-brand' },
            h('span', { className: 'dsr-wide-brand-mark' }, h(IconWorkspace, { size: 18 })),
            h('span', { className: 'dsr-wide-name' }, 'DeepSeek Harness')),
          h('button', { type: 'button', className: 'dsr-wide-new', onClick: () => startSession() },
            h(IconPlus, { size: 16 }), t('rail.newSession')),
          panelEntries.length === 0 ? null : h('div', { className: 'dsr-wide-panels' },
            panelEntries.map((panel) => h('button', {
              key: panel.id,
              type: 'button',
              className: 'dsr-wide-panel',
              'aria-current': activePanelId === panel.id ? 'page' : undefined,
              onClick: () => selectPanel(panel.id),
            }, h(IconTasks, { size: 16 }), panel.label))),
          h('div', { className: 'dsr-wide-list' },
            sections.pinnedRows.length === 0 && sections.normalRows.length === 0
              ? h(Empty, null, t('empty.workspaces'))
              : h('div', null,
                sections.pinnedRows.length === 0 ? null : h(Section, { title: t('section.pinned') },
                  workspaceBlock(sections.pinnedRows, true)),
                sections.normalRows.length === 0 ? null : h(Section, { title: t('section.workspaces') },
                  workspaceBlock(sections.normalRows, false)),
                sections.recentRows.length === 0 ? null : h(Section, { title: t('section.recent') },
                  sections.recentRows.map((row) => h('button', {
                    key: `r-${row.id}`,
                    type: 'button',
                    className: 'dsr-session',
                    onClick: () => openSessionFromRail(row.id),
                  }, `${row.title} · ${row.meta}`))))),
          h('div', { className: 'dsr-wide-foot' },
            h('button', {
              type: 'button',
              className: 'dsr-foot-btn',
              onClick: () => { if (!openSettings()) window.alert(t('settings.unavailable')) },
            }, h(IconGear, { size: 16 }), t('action.settings')))))
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
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-sidebar-rail: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-sidebar-rail', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'dsh-sidebar-rail: styles')

        // Panel metadata: read the same ledger the shipped shell reads, so the
        // expanded column and the More flyout list the real navigation entries.
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

        const localeSource = {
          getSnapshot: () => {
            const snapshot = ctx.locale.getSnapshot?.() ?? ctx.locale.getLocale?.() ?? null
            return { id: snapshot?.id ?? snapshot?.locale ?? 'en' }
          },
          subscribe: (listener) => ctx.locale.subscribe(listener),
        }

        const injectProps = () => ({
          toggleSidebar: () => { ctx.layout.toggleSidebar() },
          selectPanel: (id) => { ctx.layout.selectPanel(id) },
          startSession: (workspaceId) => { ctx.uiWorkspace.startSession(workspaceId) },
          openWorkspace: (workspaceId) => ctx.uiWorkspace.openWorkspace(workspaceId),
          openSession: (target) => { ctx.uiWorkspace.openSession(target) },
          panels: panelSource,
          locale: localeSource,
          scheduleCatalog: async () => {
            const remote = ctx.get('remote.schedule')
            return remote === undefined || typeof remote.catalog !== 'function' ? null : remote.catalog()
          },
          pluginInventory: async () => {
            const inventory = ctx.get('remote.pluginInventory')
            return inventory === undefined || typeof inventory.list !== 'function' ? null : inventory.list()
          },
          openSettings: () => {
            const commands = ctx.get('commands')
            if (commands !== undefined && typeof commands.execute === 'function') {
              try { commands.execute('settings.open'); return true } catch { return false }
            }
            return false
          },
          fallbackText: 'Sidebar rail unavailable',
        })

        // `children` is deliberately omitted: ui-sidebar already declared those
        // holes, and re-declaring one throws. `priority: -1` wins the single slot.
        ctx.slots.inject('sidebar', () => ctx.slots.register({
          name: 'sidebar',
          locale: NS,
          priority: -1,
          inject: injectProps,
        }, (props) => h(Boundary, { fallbackText: props.fallbackText }, h(SidebarRailRoot, props))))
      },
    }
  },
})
