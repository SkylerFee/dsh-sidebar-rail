/**
 * 远程答案的归类与归一化：任务、插件、目录选择与远程结果三态。
 *
 * 宿主把所有远程调用包在 `RemoteResult` 里，值可能是外层 `{}`、裸数组、
 * 甚至畸形对象。这里统一收窄，任何不认识的形状都退化成一个确定的空集或失败态，
 * 不让渲染层直接碰原始输入。
 */
import type {
  PickedDirectory,
  PluginGroups,
  PluginRow,
  RemoteOutcome,
  TaskGroups,
  TaskRow,
} from './types.ts'

/**
 * 在归一化之前给远程答案分类。
 *
 * Promise 已 resolve 不等于成功：网关把失败也当作 `{ ok: false, error }`
 * 帧返回（api/gateway/src/client/index.ts），宿主会显式检查 `ok` 而不是依赖
 * 拒绝。把失败帧显示成空列表，会让「连接坏了」报告成「没有插件」，所以三种
 * 结局必须分开。
 * @param answer - 远程调用 resolve 出的值；服务缺席时包装层返回 null。
 * @returns `ready` 带载荷、`failed` 带错误，或 `unavailable`。
 */
export function remoteOutcome(answer: unknown): RemoteOutcome {
  if (answer === null || answer === undefined) {
    return { kind: 'unavailable', value: undefined, error: undefined }
  }
  if (typeof answer === 'object' && 'ok' in answer) {
    const frame = answer as { readonly ok?: unknown; readonly value?: unknown; readonly error?: unknown }
    return frame.ok === true
      ? { kind: 'ready', value: frame.value, error: undefined }
      : { kind: 'failed', value: undefined, error: frame.error }
  }
  // 裸载荷（测试，或将来某个直接作答的 remote）。
  return { kind: 'ready', value: answer, error: undefined }
}

/**
 * 求一个定时任务的下次执行时刻。
 *
 * `ScheduleCatalogEntry` 只有 `scheduledAt` 与可选的 `deliveryFloorEndsAt`，
 * **没有 `nextRunAt`**（ADR-0005）。宿主 ui-schedule 的算法是「投递底限晚于
 * 计划时间就用底限，否则用计划时间」。这里照抄该公式而不是发明字段：旧实现去找
 * `nextRunAt` / `next`，两个键都不存在，能显示出时间纯属最后回退到
 * `scheduledAt` 的巧合。
 * @param task - 一条 catalog 条目。
 * @returns ISO-8601 字符串；条目没有可用时间时返回空串。
 */
export function taskNextRun(task: unknown): string {
  if (task === null || typeof task !== 'object') return ''
  const record = task as Record<string, unknown>
  const scheduled = typeof record['scheduledAt'] === 'string' ? record['scheduledAt'] : ''
  if (scheduled === '') return ''
  // 按瞬时比较：两个字段都是 ISO 字符串，畸形值不能悄悄改变比较结果。
  const floor = typeof record['deliveryFloorEndsAt'] === 'string' ? record['deliveryFloorEndsAt'] : ''
  if (floor !== '') {
    const floorAt = Date.parse(floor)
    const scheduledAt = Date.parse(scheduled)
    if (Number.isFinite(floorAt) && Number.isFinite(scheduledAt) && floorAt > scheduledAt) return floor
    if (!Number.isFinite(scheduledAt)) return ''
  }
  return Number.isFinite(Date.parse(scheduled)) ? scheduled : ''
}

/**
 * 解析一条宿主任务的生命周期状态。
 *
 * 宿主 `catalog()` 返回全部状态的任务，所以插件不再按状态过滤，改为分组。
 * 只透传 spec 点名的三种状态；宿主日后可能新增的第四种值宁可丢弃，也不塞进
 * 「进行中」——把已停止的任务显示成在运行，比不显示更糟。
 *
 * 旧形状没有 `status`，用 `active` 布尔表达同一件事，这里做等价翻译而不是靠猜。
 * @param task - 一条 catalog 条目。
 * @returns `'active'` / `'paused'` / `'ended'`；无法识别时返回空串。
 */
export function taskStatusOf(task: unknown): string {
  if (task === null || typeof task !== 'object') return ''
  const record = task as Record<string, unknown>
  const status = record['status']
  if (status === 'active' || status === 'paused' || status === 'ended') return status
  // 宿主把旧的 'inactive' 写法在读取时折进 'ended'，所以仍带该值的条目意味着「已停止」。
  if (status === 'inactive') return 'ended'
  if (status !== undefined) return ''
  if (record['active'] === false || record['enabled'] === false) return 'paused'
  return 'active'
}

/**
 * 把未知的 schedule catalog 答案归一化成任务行。
 * @param answer - schedule remote 返回的任何内容。
 * @returns 任务行，包含全部生命周期状态，保持宿主顺序。
 */
export function normalizeTasks(answer: unknown): TaskRow[] {
  const list = pickList(answer, ['items', 'tasks', 'entries'])
  const rows: TaskRow[] = []
  for (const task of list) {
    if (task === null || task === undefined) continue
    const record = task as Record<string, unknown>
    const id = record['id'] ?? record['taskId'] ?? record['key'] ?? ''
    const title = record['title'] ?? record['name'] ?? record['instruction'] ?? record['prompt'] ?? String(id)
    // 宿主自己的公式（见 taskNextRun）；不存在 nextRunAt 字段。
    const next = taskNextRun(task)
    const meta = next === '' ? '' : new Date(next).toLocaleString()
    rows.push({
      id: String(id),
      title: String(title).slice(0, 120),
      meta,
      status: taskStatusOf(task),
      involvedSessionIds: readInvolvedSessionIds(record['involvedSessionIds']),
      targetKind: readTargetKind(record['target']),
      targetSessionId: readTargetSessionId(record['target']),
      lastDeliveryTargetSessionId: readLastDeliveryTargetSessionId(record['lastDelivery']),
    })
  }
  return rows
}

/**
 * 读出任务涉及的全部会话 id。
 *
 * 宿主 `ScheduleCatalogEntry.involvedSessionIds` 是 `SessionId[]`，但这条边界是
 * 远程答案，仍要逐项收窄：只保留非空字符串。
 * @param raw - 原始字段值。
 * @returns 会话 id 数组；字段缺失或不是数组时为空数组。
 */
function readInvolvedSessionIds(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string' && entry !== '') out.push(entry)
  }
  return out
}

/**
 * 读出投递目标的形态。
 *
 * 宿主 `ScheduleTarget` 是三种形态的判别联合，只保留 `kind` 供判定用。
 * @param raw - 原始 `target` 字段。
 * @returns 识别出的 kind；不认识时返回 undefined。
 */
function readTargetKind(raw: unknown): 'session' | 'new_once' | 'new' | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const kind = (raw as Record<string, unknown>)['kind']
  return kind === 'session' || kind === 'new_once' || kind === 'new' ? kind : undefined
}

/**
 * 读出目标会话 id。
 *
 * `kind: 'new'` 没有固定目标，因此没有该字段；`session` 与 `new_once` 都有。
 * @param raw - 原始 `target` 字段。
 * @returns 会话 id，或 undefined。
 */
function readTargetSessionId(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const value = (raw as Record<string, unknown>)['sessionId']
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 读出最近一次投递落到的会话。
 * @param raw - 原始 `lastDelivery` 字段。
 * @returns 目标会话 id，或 undefined。
 */
function readLastDeliveryTargetSessionId(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const value = (raw as Record<string, unknown>)['targetSessionId']
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 求一个任务「投递到的会话」。
 *
 * 逐字复刻宿主 `task-record.ts` 的 `taskSessionId`：`kind: 'new'` 的任务每次投递
 * 都新建会话，因此只有 `lastDelivery.targetSessionId` 能回答；另外两种形态都有
 * 固定的 `target.sessionId`。
 * @param task - 归一化后的任务行。
 * @returns 目标会话 id，或 undefined。
 */
function taskSessionIdOf(task: TaskRow): string | undefined {
  return task.targetKind === 'new' ? task.lastDeliveryTargetSessionId : task.targetSessionId
}

/**
 * 判断一个任务是否「涉及」某个会话。
 *
 * 复刻宿主 `taskInvolvesSession`：命中 `involvedSessionIds`，或者目标会话就是它。
 * 两者都要查——`new` 类型创建的会话不进 `involvedSessionIds`，只能由目标会话命中；
 * 而创建该任务的 Agent 会话只会出现在 `involvedSessionIds` 里。
 * @param task - 归一化后的任务行。
 * @param sessionId - 待判定的会话。
 * @returns 该任务是否涉及这个会话。
 */
export function taskInvolvesSession(task: TaskRow, sessionId: string): boolean {
  if (typeof sessionId !== 'string' || sessionId === '') return false
  if (Array.isArray(task.involvedSessionIds) && task.involvedSessionIds.includes(sessionId)) return true
  return taskSessionIdOf(task) === sessionId
}

/**
 * 判断某个会话是否有**活跃**的定时任务。
 *
 * 对应宿主 Sidebar 行首的时钟标记：只有 `status === 'active'` 的任务算数，
 * 暂停与已结束不显示（宿主 `ScheduleCatalogEntry.status` 的注释：只有 active
 * 有定时器义务，另两种只是「仍然可见」）。
 * @param tasks - 归一化后的任务行。
 * @param sessionId - 待判定的会话。
 * @returns 存在活跃任务时为 true；空数组或畸形输入为 false。
 */
export function sessionHasActiveTask(tasks: readonly TaskRow[] | null | undefined, sessionId: string): boolean {
  if (!Array.isArray(tasks)) return false
  for (const task of tasks) {
    if (task === null || task === undefined || typeof task !== 'object') continue
    if (task.status !== 'active') continue
    if (taskInvolvesSession(task, sessionId)) return true
  }
  return false
}

/**
 * 把任务行拆成 spec 规定的三个分区。
 *
 * 三个键**恒存在**，空列表也一样：空分区仍要渲染标题与空态文案，缺键会让
 * spec 要求的标题静默消失。
 * @param rows - `normalizeTasks` 产出的行。
 * @returns `{ active, paused, ended }`，各自保持宿主顺序。
 */
export function groupTasksByStatus(rows: readonly TaskRow[] | null | undefined): TaskGroups {
  const active: TaskRow[] = []
  const paused: TaskRow[] = []
  const ended: TaskRow[] = []
  if (!Array.isArray(rows)) return { active, paused, ended }
  for (const row of rows) {
    if (row === null || row === undefined || typeof row !== 'object') continue
    // 未知状态不落到任何分区：把已停止的任务显示成在运行比不显示更糟。
    if (row.status === 'active') active.push(row)
    else if (row.status === 'paused') paused.push(row)
    else if (row.status === 'ended') ended.push(row)
  }
  return { active, paused, ended }
}

/**
 * 把 bundle 列表归一化成用户真正添加的插件。
 *
 * 一条记录存活的条件是：用户已启用、profile 真的声明了它、且安装本身不自带它
 * （`official`）。最后这个标志是宿主自己的 Official/Installed 分野——也正是
 * 这里读 `pluginManager.listBundles` 而不是 Loader inventory 的原因，
 * 后者没有该字段。bundle 才是人安装的单位，所以每行是一个 bundle 名，
 * 而不是它内部的模块行。
 * @param answer - plugin-manager 列表返回的任何内容。
 * @returns 用户安装且当前启用的 bundle 行。
 */
export function normalizePlugins(answer: unknown): PluginRow[] {
  const list = pickList(answer, ['entries', 'items', 'bundles'])
  const rows: PluginRow[] = []
  for (const bundle of list) {
    if (bundle === null || bundle === undefined || typeof bundle !== 'object') continue
    const record = bundle as Record<string, unknown>
    if (record['official'] === true) continue
    if (record['installed'] === false) continue
    // 只有 `official` 不够：宿主自己的基础 bundle（@deepseek-ai/dsh-base、
    // dsh-web-app）不在官方目录里，因此报告 official:false 却随安装一起发布。
    // `availability: 'installation'` 才是把它们分开的结构化事实。
    if (record['availability'] === 'installation') continue
    const name = record['name'] ?? record['moduleName'] ?? record['packageName'] ?? ''
    if (name === '') continue
    // 对 availability 语义漂移的双保险。
    if (String(name).startsWith('@deepseek-ai/')) continue
    const version = record['version']
    const meta = version === undefined ? '' : `v${String(version)}`
    // 两种状态都带出来；浮层在渲染时拆分。`installed` 跟着行走，即使本函数
    // 已经丢掉显式未安装的那些：分区判据是 `installed && !enabled`，所以拆分
    // 必须从行上读到这个事实，而不是依赖上游某个可能变化的过滤。
    // 省略 `installed` 的 bundle 视为已安装——只有显式的 false 才是「不在这里」，
    // 那也是宿主报告未安装的按需插件的方式。
    rows.push({
      name: String(name),
      meta,
      enabled: record['enabled'] === true,
      installed: record['installed'] !== false,
    })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return rows
}

/**
 * 把插件行拆成 spec 规定的两个分区。
 *
 * 「未启用」指**已安装但被关闭**——插件就在磁盘上，用户随时能再打开。
 * 完全没安装的（官方按需插件）是另一回事：点它会触发安装流程，而本浮层刻意
 * 不提供该流程。两侧都校验 `installed`，因为一条「未安装却声称 enabled」的行
 * 是畸形数据，不该被当成「已启用」。
 * @param rows - `normalizePlugins` 产出的行。
 * @returns `{ enabled, disabled }`，各自按名称排序。
 */
export function groupPluginsByState(rows: readonly PluginRow[] | null | undefined): PluginGroups {
  const enabled: PluginRow[] = []
  const disabled: PluginRow[] = []
  if (!Array.isArray(rows)) return { enabled, disabled }
  for (const row of rows) {
    if (row === null || row === undefined || typeof row !== 'object') continue
    // 两侧都查 `installed`，不只查 disabled 那侧。一条声称 `enabled: true`、
    // 却未被 profile 声明的记录是畸形而非「开着」，而 spec 的两条判据都以
    // 「已安装的 bundle」为前提。没有该标志的行算已安装（见 normalizePlugins），
    // 只排除显式的 false。「完全没安装」是按需插件，其安装流程本浮层不提供，
    // 所以两个分区都不属于。
    if (row.installed === false) continue
    if (row.enabled === true) enabled.push(row)
    else disabled.push(row)
  }
  return { enabled, disabled }
}

/**
 * 把目录选择器的三种结局收敛成调用方唯一需要处理的形状。
 *
 * 宿主的 `pickDirectory` 有三条出路：给出路径、用户取消时返回 null、
 * 后端不具备 native 能力时抛错（browse 后端即如此，见 ADR-0005）。调用方不该关心
 * 自己拿到的是哪一种，所以这里统一成：`picked` 带路径、`cancelled` 是静默分支、
 * `failed` 带一句人能照做的提示。
 *
 * 相对路径判为失败而非选中：宿主按绝对路径登记项目，登记 `repo/alpha` 只会得到
 * 一条永远解析不到真实目录的记录。
 * @param value - pick 调用 resolve 出的值，或它抛出的拒绝原因。
 * @returns 三态之一。
 */
export function pickedDirectory(value: unknown): PickedDirectory {
  if (value instanceof Error) {
    return { kind: 'failed', message: value.message === '' ? 'directory picker failed' : value.message }
  }
  // 非 null、非字符串、非 Error 的值是畸形答案，不是路径。
  if (typeof value !== 'string') {
    return value === null || value === undefined
      ? { kind: 'cancelled' }
      : { kind: 'failed', message: 'directory picker returned no usable path' }
  }
  const path = value.trim()
  if (path === '') return { kind: 'cancelled' }
  if (!path.startsWith('/')) {
    return { kind: 'failed', message: `directory picker returned a relative path: ${path}` }
  }
  return { kind: 'picked', path }
}

/**
 * 从远程答案里挑出候选列表：裸数组优先，其次几个已知的包装键。
 * @param answer - 任意远程答案。
 * @param keys - 除裸数组外还要尝试的包装键，按优先级排列。
 * @returns 候选数组；都不匹配时为空数组。
 */
function pickList(answer: unknown, keys: readonly string[]): unknown[] {
  const value = answer !== null && typeof answer === 'object' && 'value' in answer
    ? (answer as { readonly value?: unknown }).value
    : answer
  if (Array.isArray(value)) return value
  if (value !== null && value !== undefined && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of keys) {
      const candidate = record[key]
      if (Array.isArray(candidate)) return candidate
    }
  }
  return []
}