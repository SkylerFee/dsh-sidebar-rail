#!/usr/bin/env node
/**
 * 产物检查：验证 `lib/` 的两个入口满足宿主加载协议与包元数据契约。
 *
 * 只读已经构建好的产物；独立运行前必须先 `npm run build`。
 * 检查方式不是正则碰运气，而是真的在只有 ModuleLoader 收集器的 VM 里执行脚本、
 * 再显式调用工厂记录 require 请求。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const failures = []

/**
 * 记录一次失败而不抛出，让所有规则在一趟里都报告出来。
 * @param rule - 规则名。
 * @param detail - 命中细节。
 */
function fail(rule, detail) {
  failures.push(`${rule}: ${detail}`)
}

/**
 * 从仓库根读取一个文件，缺失时记一条 files 规则。
 * @param file - 相对路径。
 * @returns 文件内容。
 */
function read(file) {
  const path = join(root, file)
  if (!existsSync(path)) {
    fail('files', `missing ${file}`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

const pkg = JSON.parse(read('package.json'))
const clientSource = read('lib/client.js')
const hostSource = read('lib/index.js')

// ------------------------------------------------------------ 1. manifest --
// 包名、exports、files 与补丁模块名必须一致，且都指向真实存在的包内文件。
{
  if (!existsSync(join(root, 'lib', 'client.js'))) fail('manifest', 'lib/client.js is missing; run npm run build first')
  if (!existsSync(join(root, 'lib', 'index.js'))) fail('manifest', 'lib/index.js is missing; run npm run build first')

  if (pkg.exports?.['.'] !== './lib/index.js') {
    fail('manifest', `exports["."] should be ./lib/index.js, found ${JSON.stringify(pkg.exports?.['.'])}`)
  }
  if (pkg.exports?.['./client'] !== './lib/client.js') {
    fail('manifest', `exports["./client"] should be ./lib/client.js, found ${JSON.stringify(pkg.exports?.['./client'])}`)
  }
  for (const [key, target] of Object.entries(pkg.exports ?? {})) {
    if (typeof target !== 'string') continue
    if (target.includes('*')) {
      const dir = join(root, dirname(target))
      if (!existsSync(dir) || readdirSync(dir).filter((entry) => entry.endsWith(extname(target))).length === 0) {
        fail('manifest', `exports["${key}"] matches no files under ${dirname(target)}`)
      }
      continue
    }
    if (!existsSync(join(root, target))) fail('manifest', `exports["${key}"] points at missing ${target}`)
  }

  for (const entry of pkg.files ?? []) {
    if (entry.includes('*')) {
      const dir = join(root, dirname(entry))
      if (!existsSync(dir)) fail('manifest', `files entry "${entry}" matches no directory`)
      continue
    }
    if (!existsSync(join(root, entry))) fail('manifest', `files entry "${entry}" does not exist`)
  }

  const patch = pkg.dsh?.bundle?.patch
  if (typeof patch !== 'string') {
    fail('manifest', 'dsh.bundle.patch is missing')
  } else if (!existsSync(join(root, patch))) {
    fail('manifest', `dsh.bundle.patch points at missing ${patch}`)
  } else {
    const patchName = /^\s+name:\s*'([^']+)'\s*$/m.exec(read(patch))?.[1]
    if (patchName !== pkg.name) fail('manifest', `${patch} loads "${patchName}" but the package is named "${pkg.name}"`)
  }

  // 运行时依赖必须为零：dependencies 存在且非空即否决。
  const runtimeDeps = Object.keys(pkg.dependencies ?? {})
  if (runtimeDeps.length > 0) fail('manifest', `runtime dependencies must stay empty, found ${runtimeDeps.join(', ')}`)
  if (pkg.dsh?.client?.immediately !== true) fail('manifest', 'dsh.client.immediately must stay true')
  const inject = pkg.dsh?.client?.inject ?? []
  for (const required of ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-layout']) {
    if (!inject.includes(required)) fail('manifest', `dsh.client.inject must still list ${required}`)
  }

  if (!failures.some((entry) => entry.startsWith('manifest:'))) {
    console.log(`ok  manifest: exports, files, bundle patch and zero runtime dependencies agree`)
  }
}

// -------------------------------------------------------- 2. host entry --
// Host 入口必须是 ESM，且保留空的 apply 导出。
{
  const hits = []
  if (!/export\s*\{[^}]*apply/.test(hostSource) && !/export\s+function\s+apply/.test(hostSource)) {
    hits.push('lib/index.js does not export apply')
  }
  if (/^\s*import\s/m.test(hostSource)) hits.push('lib/index.js imports something; the Host half must stay empty')
  for (const why of hits) fail('host', why)
  if (hits.length === 0) console.log('ok  host: lib/index.js is an empty ESM apply entry')
}

// ------------------------------------------------------ 3. client protocol --
// 注册阶段只登记工厂：VM 里没有 React、没有 DOM、没有 localStorage。
const registrations = []
{
  try {
    runInNewContext(clientSource, {
      window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
      console: { info() {}, warn() {}, error() {} },
    })
  } catch (error) {
    fail('protocol', `executing lib/client.js at registration time threw: ${String(error)}`)
  }
  if (registrations.length !== 1) {
    fail('protocol', `expected exactly one ModuleLoader registration, found ${registrations.length}`)
  } else {
    const registration = registrations[0]
    if (registration.id !== pkg.name) {
      fail('protocol', `registered id "${registration.id}" does not match the package name "${pkg.name}"`)
    }
    if (typeof registration.factory !== 'function') fail('protocol', 'registration has no factory function')
    else {
      // 显式物化工厂，记录所有 require 请求：只有宿主的标准模块可以提供。
      const requests = []
      const reactStub = {
        createElement: (...args) => ({ type: args[0], props: args[1] }),
        Fragment: Symbol('Fragment'),
        Component: class {
          constructor(props) { this.props = props; this.state = {} }
          static getDerivedStateFromError() { return { failed: true } }
          componentDidCatch() {}
          render() { return null }
        },
        useCallback: (fn) => fn,
        useEffect() {},
        useMemo: (fn) => fn(),
        useRef: (value) => ({ current: value }),
        useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      }
      const mod = registration.factory((request) => {
        requests.push(request)
        if (request === 'react') return reactStub
        if (request === 'react-dom') return { createPortal: (node) => node }
        throw new Error(`factory requested unexpected module "${request}"`)
      })
      if (requests.some((request) => request !== 'react' && request !== 'react-dom')) {
        fail('protocol', `factory requested ${requests.filter((r) => r !== 'react' && r !== 'react-dom').join(', ')}`)
      }
      if (typeof mod?.apply !== 'function') fail('protocol', 'factory did not export apply')
      const injectList = mod?.inject
      if (!Array.isArray(injectList) || injectList.length === 0) fail('protocol', 'factory did not export the inject list')
      else {
        for (const required of ['slots', 'locale', 'layout', 'uiWorkspace']) {
          if (!injectList.includes(required)) fail('protocol', `inject list lost "${required}"`)
        }
      }
      // 顶层不能残留 ESM 语法：宿主按静态脚本执行该文件。
      if (/^\s*(?:import|export)\s/m.test(clientSource)) {
        fail('protocol', 'lib/client.js carries top-level ESM syntax')
      }
      if (/require\(\s*["']\.\.?\//.test(clientSource)) {
        fail('protocol', 'lib/client.js carries a relative require; single-file bundles only')
      }
      if (!failures.some((entry) => entry.startsWith('protocol:'))) {
        console.log(`ok  protocol: one registration, id matches, factory requires only react / react-dom (${requests.length} requests)`)
      }
    }
  }
}

// ------------------------------------------------------- 4. apply lifecycle --
// 用槽、locale、DOM 的小替身执行 apply，验证两个槽注册与资源释放。
//
// 这里的客户端脚本要在**带 DOM 的 VM** 里重新执行一次：产物里的函数绑定的是
// 注册时那个 VM 的全局作用域，从外部改 `globalThis` 不会影响它。
{
  const effects = []
  const slotRegistrations = []
  const localeRegistrations = []
  const styleNodes = []
  const styleNode = { setAttribute() {}, remove() {}, textContent: '' }
  const domSandbox = {
    window: {
      __ModuleLoader__: { load() {} },
      setTimeout,
      clearTimeout,
      innerHeight: 900,
      localStorage: { getItem() { return null }, setItem() {} },
    },
    document: {
      createElement() { styleNodes.push(styleNode); return styleNode },
      head: { appendChild() {} },
      documentElement: { dataset: {} },
      querySelector() { return null },
    },
    console: { info() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
  }
  domSandbox.globalThis = domSandbox
  const localRegistrations = []
  domSandbox.window.__ModuleLoader__.load = (registration) => localRegistrations.push(registration)
  try {
    runInNewContext(clientSource, domSandbox)
  } catch (error) {
    fail('lifecycle', `executing lib/client.js with a DOM stub threw: ${String(error)}`)
  }
  const registration = localRegistrations[0]
  if (registration !== undefined && typeof registration.factory === 'function') {
    const reactStub = {
      createElement: (...args) => ({ type: args[0], props: args[1] }),
      Fragment: Symbol('Fragment'),
      Component: class {
        constructor(props) { this.props = props; this.state = {} }
        static getDerivedStateFromError() { return { failed: true } }
        componentDidCatch() {}
        render() { return null }
      },
      useCallback: (fn) => fn,
      useEffect() {},
      useMemo: (fn) => fn(),
      useRef: (value) => ({ current: value }),
      useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    }
    const mod = registration.factory((request) => request === 'react' ? reactStub : { createPortal: (node) => node })
    const context = {
      effect(run, label) {
        const cleanup = run()
        effects.push({ label, cleanup })
        return cleanup
      },
      locale: {
        register(namespace, dictionaries) {
          localeRegistrations.push({ namespace, keys: Object.keys(dictionaries ?? {}) })
          return () => {}
        },
        subscribe() { return () => {} },
        getSnapshot() { return { active: 'en' } },
      },
      slots: {
        entriesOfSlot() { return [] },
        subscribe() { return () => {} },
        inject(_name, run) { return run() },
        register(definition) { slotRegistrations.push(definition); return () => {} },
      },
      layout: { toggleSidebar() {}, selectPanel() {} },
      uiWorkspace: {
        openWorkspace() {},
        openSession() {},
        startSession() {},
        pickDirectory: async () => null,
      },
      get() { return undefined },
    }
    const errors = []
    const origError = domSandbox.console.error
    domSandbox.console.error = (...args) => { errors.push(args.map(String).join(' ')) }
    try {
      mod.apply(context)
    } finally {
      domSandbox.console.error = origError
    }
    const labels = effects.map((entry) => entry.label)
    for (const required of ['dictionaries', 'styles', 'rail overlay', 'settings panel']) {
      if (!labels.some((label) => label.includes(required))) fail('lifecycle', `apply did not register the ${required} effect`)
    }
    if (localeRegistrations.length !== 1 || localeRegistrations[0].namespace !== 'sidebarRail') {
      fail('lifecycle', `locale.register should run once for namespace sidebarRail, saw ${JSON.stringify(localeRegistrations)}`)
    }
    const overlay = slotRegistrations.find((definition) => definition.name === 'shell.overlay')
    if (overlay === undefined) fail('lifecycle', 'apply did not register into shell.overlay')
    else if (overlay.id !== 'dsh-sidebar-rail.rail') fail('lifecycle', `overlay id should be dsh-sidebar-rail.rail, saw ${overlay.id}`)
    else if (overlay.children !== undefined) fail('lifecycle', 'the overlay entry must not declare children')
    const settings = slotRegistrations.find((definition) => definition.name === 'plugins.bundle.config')
    if (settings === undefined) fail('lifecycle', 'apply did not register into plugins.bundle.config')
    else if (settings.key !== pkg.name) fail('lifecycle', `settings key should be the package name, saw ${settings.key}`)
    if (styleNodes.length !== 1) fail('lifecycle', `the styles effect should create exactly one style node, saw ${styleNodes.length}`)
    else if (styleNode.textContent.length === 0) fail('lifecycle', 'the injected style node carries no CSS text')
    for (const entry of effects) {
      if (typeof entry.cleanup !== 'function') fail('lifecycle', `effect "${entry.label}" returned no cleanup`)
      else {
        try {
          entry.cleanup()
        } catch (error) {
          fail('lifecycle', `cleanup of "${entry.label}" threw: ${String(error)}`)
        }
      }
    }
    if (errors.length > 0) fail('lifecycle', `apply logged errors: ${errors.join(' | ')}`)
    if (!failures.some((entry) => entry.startsWith('lifecycle:'))) {
      console.log(`ok  lifecycle: ${effects.length} effects registered and disposed, both slots named correctly, CSS injected`)
    }
  }
}

// -------------------------------------------------- 5. shipped file layout --
// 发布白名单里不能混进源码、测试夹具或依赖目录。
{
  const hits = []
  for (const entry of pkg.files ?? []) {
    if (entry.startsWith('src/') || entry.startsWith('test/') || entry.startsWith('tmp/') || entry.startsWith('node_modules/')) {
      hits.push(`files entry "${entry}" must not ship source, tests, tmp or dependencies`)
    }
  }
  if (existsSync(join(root, 'client.js'))) hits.push('the old root client.js still exists; the built lib/client.js is the only implementation')
  if (existsSync(join(root, 'index.js'))) hits.push('the old root index.js still exists; the built lib/index.js is the only implementation')
  for (const why of hits) fail('layout', why)
  if (hits.length === 0) console.log('ok  layout: no hand-written entries, no source or fixture in the publish list')
}

// ---------------------------------------------------------- reporting --
if (failures.length > 0) {
  console.error(`\n${failures.length} artifact check(s) failed:`)
  for (const entry of failures) console.error(`  - ${entry}`)
  process.exit(1)
}
console.log('\nall artifact checks passed')