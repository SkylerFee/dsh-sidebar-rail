/** 验证发布客户端脚本与宿主按完整包名导入的约定，不加载 React 或 DOM。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

test('client bundle registers once under its complete package name before materialization', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const registrations = []

  // 宿主先执行脚本注册工厂，之后按包名导入；注册阶段没有 React、document 等浏览器能力。
  runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        /** 收集宿主在启动阶段收到的模块工厂声明。 */
        load(registration) {
          registrations.push(registration)
        },
      },
    },
  })

  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, pkg.name)
  assert.equal(typeof registrations[0].factory, 'function')
})
