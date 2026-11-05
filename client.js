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
      'section.pinned': '置顶项目',
      'section.workspaces': '项目',
      'section.recent': '最近会话',
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
      'section.recent': 'Recent sessions',
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
.dsr-rail-hotzone { position:fixed; left:0; top:var(--dsh-frame-top-clearance, 48px); bottom:0;
  width:8px; z-index:59; -webkit-app-region:no-drag; }
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
     *
     * `current` marks the row the main view is showing, painted with the same
     * fill the host uses for its own selected session row. The host marks that
     * row with `aria-selected` inside a treeitem; these rows are plain buttons,
     * so `aria-current="page"` is the equivalent announcement here.
     * @param props - Row content, click handler, pin affordance and current flag.
     * @returns The row element.
     */
    function Row({ title, meta, onClick, onTogglePin, pinLabel, pinned, current }) {
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
     * Split workspaces into pinned and normal rows and collect recent sessions.
     * @param items - WorkspaceView[].
     * @param sessions - SessionListState.
     * @param archivedIds - Archived session ids.
     * @param pinnedIds - Locally pinned workspace ids, most recent first.
     * @param language - Active locale id.
     * @param panelCovering - True while a non-session panel covers the conversation.
     * @returns Pinned rows, normal rows and recent session rows.
     */
    function deriveSections(items, sessions, archivedIds, pinnedIds, language, panelCovering) {
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
        })
      }
      recentRows.sort((a, b) => b.updatedAt - a.updatedAt)
      return { pinnedRows, normalRows, recentRows: recentRows.slice(0, RECENT_LIMIT) }
    }


    /** Gap kept between a flyout and the window edge. */
    const FLYOUT_EDGE_GAP = 12
    /** Reserved height for the flyout head and foot when budgeting space. */
    const FLYOUT_CHROME_HEIGHT = 96

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
        pluginInventory, useSessions, useWorkspaces, usePanelInfo, fallbackText, accountSeat: accountSeatLoader,
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
        () => deriveSections(workspaceItems, sessions, archivedIds, pins, language, panelCovering),
        [workspaceItems, sessions, archivedIds, pins, language, panelCovering],
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
      /**
       * Dismiss the flyout and retract the rail.
       *
       * Retraction used to ride on the rail's own `pointerleave`, which never
       * fires for the path that matters: clicking an entry inside the flyout
       * leaves the pointer to the right of the rail, so after the panel unmounts
       * nothing tells the rail to hide and it stayed out until the pointer
       * happened to cross it again. Every dismissal therefore retracts explicitly.
       */
      const dismiss = useCallback(() => {
        setOpen(null)
        setRevealed(false)
      }, [])
      const [accountSeat, setAccountSeat] = useState({ kind: 'unknown', avatarUrl: undefined })
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
        dismiss()
        Promise.resolve(openWorkspace(workspaceId)).catch(() => {})
      }, [openWorkspace, dismiss])

      /**
       * Reveal one existing session and dismiss the flyout.
       *
       * `SessionTarget` is `SessionId | SubagentAddress` — a bare id, not the
       * `{ kind, sessionId }` object this used to pass. The host read that object
       * as "no session named" and fell back to opening a fresh conversation,
       * which is why clicking a recent session started a new one.
       */
      const openSessionFromRail = useCallback((sessionId) => {
        dismiss()
        try {
          // Synchronous: the host throws on an unknown id before returning, so a
          // promise-level catch would never see it.
          openSession(sessionId)
        } catch (error) {
          console.warn('[dsh-sidebar-rail] open session failed', error)
        }
      }, [openSession, dismiss])

      /**
       * Draw the flyout shell for one entry.
       * @param title - Flyout heading.
       * @param body - Scrollable body.
       * @param foot - Optional pinned foot.
       * @returns The flyout element.
       */
      const flyoutShell = (title, body, foot, bottomAligned) => createPortal(h('div', {
        ref: panelRef,
        className: 'dsr-flyout',
        role: 'dialog',
        'aria-label': title,
        style: (() => {
          const placed = flyoutPlacement(anchor, window.innerHeight, bottomAligned)
          return {
            ...(placed.top === undefined ? {} : { top: `${placed.top}px` }),
            ...(placed.bottom === undefined ? {} : { bottom: `${placed.bottom}px` }),
            maxHeight: `${placed.maxHeight}px`,
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
          dismiss()
          const trigger = triggerRef.current
          if (trigger !== null) trigger.focus()
        },
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
              current: row.active === true,
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
                    onClick: () => { dismiss(); selectPanel('schedules') },
                  })))
          return flyoutShell(t('rail.tasks'), body, h(ActionRow, {
            onClick: () => { dismiss(); selectPanel('schedules') },
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
                    onClick: () => { dismiss(); selectPanel('plugins') },
                  })))
          return flyoutShell(t('rail.plugins'), body, h(ActionRow, {
            onClick: () => { dismiss(); selectPanel('plugins') },
          }, t('action.openPanel')))
        }
        if (open === 'more') {
          const extras = panelEntries.filter((panel) => panel.id !== 'schedules' && panel.id !== 'plugins')
          return flyoutShell(t('rail.more'),
            h('div', null,
              h(ActionRow, { onClick: () => { dismiss(); toggleSidebar() } }, t('rail.expand')),
              extras.length === 0 ? null : h(Section, { title: t('section.panels') },
                extras.map((panel) => h(Row, {
                  key: `panel-${panel.id}`,
                  title: panel.label,
                  onClick: () => { dismiss(); selectPanel(panel.id) },
                })))),
            h('div', { className: 'dsr-hint' }, t('account.hint')))
        }
        if (open === 'account') {
          // Account and settings live in the host's expanded sidebar, so the
          // only honest action here is to hand the column back to the host.
          return flyoutShell(t('rail.account'),
            h('div', null,
              h('div', { className: 'dsr-hint' }, t('account.hint')),
              h(ActionRow, { onClick: () => { dismiss(); toggleSidebar() } }, t('rail.expand'))),
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
          dismiss()
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
          onClick: () => { dismiss(); toggleSidebar() },
        }, h(AccountAvatar, { seat: accountSeat }))))
      // Two portals: the thin edge strip that catches the pointer, and the rail
      // itself, which slides in over it. The strip is what makes a hidden rail
      // discoverable without covering the conversation tabs.
      return createPortal(h('div', null,
        h('div', {
          className: 'dsr-rail-hotzone',
          onPointerEnter: () => setRevealed(true),
          onPointerLeave: () => { if (open === null) setRevealed(false) },
        }),
        h('div', {
          className: 'dsr-rail-float',
          'data-dsr-revealed': revealed === true ? 'true' : undefined,
          onPointerEnter: () => setRevealed(true),
          onPointerLeave: () => { if (open === null) setRevealed(false) },
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
          accountSeat: async () => {
            const account = ctx.get('remote.account')
            if (account === undefined || typeof account.getState !== 'function') {
              return { kind: 'unknown', avatarUrl: undefined }
            }
            let view
            try {
              view = await account.getState()
            } catch (error) {
              console.warn('[dsh-sidebar-rail] account state unavailable', error)
              return { kind: 'unknown', avatarUrl: undefined }
            }
            const viewValue = view !== null && typeof view === 'object' && 'value' in view ? view.value : null
            const signedIn = viewValue !== null && typeof viewValue === 'object'
              && viewValue.status === 'credential-stored'
            if (!signedIn) return accountSeatState(view, null)
            if (typeof account.getProfile !== 'function') return { kind: 'signed-in', avatarUrl: undefined }
            const metadata = accountClientMetadata(
              resolveLocaleId(ctx.locale.getSnapshot?.() ?? null),
              clientBuildVersion(),
              new Date().getTimezoneOffset(),
            )
            if (metadata === null) return { kind: 'signed-in', avatarUrl: undefined }
            try {
              return accountSeatState(view, await account.getProfile(metadata))
            } catch (error) {
              console.warn('[dsh-sidebar-rail] account profile unavailable', error)
              return { kind: 'signed-in', avatarUrl: undefined }
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
        } catch (error) {
          console.error('[dsh-sidebar-rail] apply failed; the shipped sidebar is unaffected', error)
        }
      },
    }
  },
})
