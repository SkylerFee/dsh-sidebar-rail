/**
 * 本插件的双语文案。
 *
 * 迁移前的字典写在 `client.js` 的 pure-helpers 区；现在独立成模块，让
 * 「英文键集合 = 中文键集合」由类型系统保证，`t()` 的参数也受键联合约束。
 * namespace 仍是常量 `NS`，文案语义未改动。
 */

import type { SessionMark } from './model/types.ts'

/** 中文文案：键集合是唯一事实来源，英文必须完整覆盖。 */
export const zh = {
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
  'empty.pinned': '还没有置顶项目',
  'empty.projectSessions': '这个项目还没有会话',
  'action.newSession': '新建会话',
  'action.addProject': '添加项目',
  'state.picking': '选择中…',
  'state.addProjectFailed': '添加项目失败，可展开侧栏用宿主的添加按钮重试',
  'state.addProjectUnavailable': '当前宿主不提供添加项目能力',
  'section.activeTasks': '进行中',
  'section.pausedTasks': '已暂停',
  'section.endedTasks': '已结束',
  'section.enabledPlugins': '已启用',
  'section.disabledPlugins': '未启用',
  'empty.tasksStatus': '这一状态没有定时任务',
  'empty.pluginsState': '这一分类没有插件',
  'status.archived': '已归档',
  'section.recent': '最近会话',
  'status.ongoing': '运行中',
  'status.warning': '等待你的操作',
  'status.done': '已完成，未查看',
  'status.idle': '空闲',
  'project.status.warning': '旗下有会话等待你的操作',
  'project.status.ongoing': '旗下有会话运行中',
  'project.status.done': '旗下有会话已完成未查看',
  'section.panels': '其他面板',
  'pin.pin': '置顶项目',
  'pin.unpin': '取消置顶',
  'empty.workspaces': '还没有工作区',
  'state.loading': '加载中…',
  'state.failed': '加载失败，可打开面板查看',
  'action.openPanel': '打开面板',
  'action.showMore': '显示更多',
  'row.scheduledTask': '有定时任务',
  'account.hint': '账号信息与用量由设置中的账号页提供。',
  'account.settingsPath': '设置：展开侧栏后点左下角「设置」。',
  'account.balance': '余额',
  'account.bonus': '赠金',
  'account.usage': '查询用量',
  'account.topUp': '充值',
  'account.balanceUnavailable': '余额暂不可用',
  'account.signedOut': '未登录。登录后可查看余额与用量。',
} as const

/** 本插件的字典键联合。 */
export type MessageKey = keyof typeof zh

/** 英文文案：类型上强制与中文键集合完全一致。 */
export const en: Record<MessageKey, string> = {
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
  'empty.pinned': 'No pinned projects yet',
  'empty.projectSessions': 'No sessions in this project yet',
  'action.newSession': 'New session',
  'action.addProject': 'Add project',
  'state.picking': 'Choosing…',
  'state.addProjectFailed': 'Could not add the project; expand the sidebar and use the host Add button',
  'state.addProjectUnavailable': 'This host does not offer project adding',
  'section.activeTasks': 'Running',
  'section.pausedTasks': 'Paused',
  'section.endedTasks': 'Ended',
  'section.enabledPlugins': 'Enabled',
  'section.disabledPlugins': 'Disabled',
  'empty.tasksStatus': 'No scheduled tasks in this state',
  'empty.pluginsState': 'No plugins in this group',
  'status.archived': 'Archived',
  'section.recent': 'Recent sessions',
  'status.ongoing': 'Running',
  'status.warning': 'Waiting for you',
  'status.done': 'Finished, unread',
  'status.idle': 'Idle',
  'project.status.warning': 'A session inside is waiting for you',
  'project.status.ongoing': 'A session inside is running',
  'project.status.done': 'A session inside finished unread',
  'section.panels': 'Other panels',
  'pin.pin': 'Pin project',
  'pin.unpin': 'Unpin project',
  'empty.workspaces': 'No workspaces yet',
  'state.loading': 'Loading…',
  'state.failed': 'Could not load; open the panel instead',
  'action.openPanel': 'Open panel',
  'action.showMore': 'Show more',
  'row.scheduledTask': 'Has a scheduled task',
  'account.hint': 'Account and usage details live in the Settings account page.',
  'account.settingsPath': 'Settings: expand the sidebar, then choose Settings at its foot.',
  'account.balance': 'Balance',
  'account.bonus': 'Bonus',
  'account.usage': 'View usage',
  'account.topUp': 'Top up',
  'account.balanceUnavailable': 'Balance unavailable',
  'account.signedOut': 'Signed out. Sign in to see balance and usage.',
}

/**
 * 翻译函数。
 *
 * 宿主注入的 `t` 缺失时退化成原样返回键名，避免渲染期抛错。
 */
export type Translate = (key: MessageKey) => string

/** 未注入 locale 面时的翻译替身：原样返回键名。 */
export const rawKeyTranslator: Translate = (key) => String(key)

/**
 * 会话状态标记对应的字典键。
 *
 * 用显式映射而不是模板拼接 `\`status.\${mark}\``：拼接结果只能靠 `as never` 压过
 * 类型检查，那种写法规避了「键是否真的存在」的校验——字典里删掉一个键时
 * 编译期不会报错，运行时直接露出键名。这里四个键由 `Record` 逐个声明，
 * 增删状态标记会立刻在类型层暴露。
 * @param mark - 会话状态标记。
 * @returns 该标记对应的字典键。
 */
export function statusLabelKey(mark: SessionMark): MessageKey {
  const keys: Record<SessionMark, MessageKey> = {
    warning: 'status.warning',
    ongoing: 'status.ongoing',
    done: 'status.done',
    idle: 'status.idle',
  }
  return keys[mark]
}

/**
 * 项目行状态标记对应的字典键。
 *
 * 与会话行分开是因为**主语不同**：会话行的点是「这个会话在跑」，项目行的点是
 * 「这个项目里有一个会话在跑」。同一个词直接复用会让读屏把项目本身读成运行中。
 * @param mark - 该项目旗下会话的最高状态标记。
 * @returns 该标记对应的字典键；`idle` 不该走到这里（渲染层不画）。
 */
export function projectStatusLabelKey(mark: SessionMark): MessageKey {
  const keys: Record<SessionMark, MessageKey> = {
    warning: 'project.status.warning',
    ongoing: 'project.status.ongoing',
    done: 'project.status.done',
    idle: 'status.idle',
  }
  return keys[mark]
}