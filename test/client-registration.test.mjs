/**
 * 产物测试：验证发布客户端脚本与宿主按完整包名导入的约定。
 *
 * 迁移前这个测试只确认「脚本登记了工厂」，既不调用工厂也不执行 apply。
 * 现在它显式物化工厂、记录 require 请求、执行 apply 并跑一遍清理，
 * 因此能挡住「注册成功但加载即崩」与「卸载后残留」两类回归。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/**
 * 在只有 ModuleLoader 收集器的 VM 里执行发布客户端。
 *
 * 产物里的函数绑定的是**执行它的那个 VM 沙箱**的全局对象，因此测试要给
 * apply 用的 DOM 替身必须放进同一个沙箱，而不是改宿主的 `globalThis`。
 * @param options - 是否在沙箱里提供 document / window 等浏览器能力。
 * @returns `{ registrations, styleNodes }`；注册阶段不应触碰 React、DOM 或 localStorage。
 */
function loadRegistrations(options = {}) {
  const { withDom = false } = options
  const registrations = []
  const styleNodes = []
  const styleNode = { setAttribute() {}, remove() {}, textContent: '' }
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (registration) => registrations.push(registration) },
      setTimeout,
      clearTimeout,
      innerHeight: 900,
      localStorage: { getItem() { return null }, setItem() {} },
    },
    console: { info() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
  }
  if (withDom) {
    sandbox.document = {
      createElement() {
        styleNodes.push(styleNode)
        return styleNode
      },
      head: { appendChild() {} },
      documentElement: { dataset: {} },
      querySelector() { return null },
    }
    sandbox.MutationObserver = class {
      observe() {}

      disconnect() {}
    }
  }
  sandbox.globalThis = sandbox
  runInNewContext(source, sandbox)
  return { registrations, styleNodes, styleNode }
}

/**
 * 构造工厂需要的 React 替身。
 * @returns 覆盖本项目实际用到的那部分 React API 的替身。
 */
function reactStub() {
  return {
    createElement: (...args) => ({ type: args[0], props: args[1] }),
    Fragment: Symbol('Fragment'),
    Component: class {
      constructor(props) {
        this.props = props
        this.state = {}
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch() {}

      render() {
        return null
      }
    },
    useCallback: (fn) => fn,
    useEffect() {},
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
}

test('client bundle registers once under its complete package name before materialization', () => {
  const { registrations } = loadRegistrations()
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, pkg.name)
  assert.equal(typeof registrations[0].factory, 'function')
})

test('the factory asks the host only for react and react-dom', () => {
  const { registrations } = loadRegistrations()
  const [registration] = registrations
  const requests = []
  const mod = registration.factory((request) => {
    requests.push(request)
    if (request === 'react') return reactStub()
    if (request === 'react-dom') return { createPortal: (node) => node }
    throw new Error('unexpected require: ' + request)
  })
  assert.deepEqual([...new Set(requests)].sort(), ['react', 'react-dom'])
  assert.equal(typeof mod.apply, 'function')
  assert.equal(typeof mod.inject, 'object')
})

test('apply registers both slots and its resources can be disposed', () => {
  const { registrations, styleNodes, styleNode } = loadRegistrations({ withDom: true })
  const [registration] = registrations
  const mod = registration.factory((request) => request === 'react' ? reactStub() : { createPortal: (node) => node })

  const effects = []
  const slots = []
  const locales = []
  const context = {
    effect(run, label) {
      const cleanup = run()
      effects.push({ label, cleanup })
      return cleanup
    },
    locale: {
      register(namespace, dictionaries) {
        locales.push({ namespace, keys: Object.keys(dictionaries ?? {}) })
        return () => {}
      },
      subscribe() { return () => {} },
      getSnapshot() { return { active: 'en' } },
    },
    slots: {
      entriesOfSlot() { return [] },
      subscribe() { return () => {} },
      inject(_name, run) { return run() },
      register(definition) { slots.push(definition); return () => {} },
    },
    layout: { toggleSidebar() {}, selectPanel() {} },
    uiWorkspace: { openWorkspace() {}, openSession() {}, startSession() {}, pickDirectory: async () => null },
    get() { return undefined },
  }

  mod.apply(context)

  assert.equal(locales.length, 1)
  assert.equal(locales[0].namespace, 'sidebarRail')
  assert.deepEqual(locales[0].keys.sort(), ['en', 'zh'])

  const overlay = slots.find((definition) => definition.name === 'shell.overlay')
  assert.ok(overlay, 'the rail must register into shell.overlay')
  assert.equal(overlay.id, 'dsh-sidebar-rail.rail')
  assert.equal(overlay.children, undefined, 'the overlay entry must not declare children')

  // 0.5.1 起设置块整项移除（spec-0.5.1 §4）：它唯一的设置项是最近会话条数，
  // 已被「默认 10 条 + 显示更多」取代。这条断言守住「移除没有被意外回滚」。
  const settings = slots.find((definition) => definition.name === 'plugins.bundle.config')
  assert.equal(settings, undefined, 'the settings block has been removed: nothing may register into plugins.bundle.config')

  assert.equal(styleNodes.length, 1, 'exactly one style node is injected')
  assert.ok(styleNode.textContent.length > 0, 'the injected style carries the CSS text')

  // 每个 effect 都必须给出清理句柄，且清理本身不能抛错。
  for (const effect of effects) assert.equal(typeof effect.cleanup, 'function', effect.label + ' has no cleanup')
  for (const effect of effects) effect.cleanup()
})