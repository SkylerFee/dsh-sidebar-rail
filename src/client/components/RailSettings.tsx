/**
 * 插件详情页上的设置块（注册到 `plugins.bundle.config`）。
 *
 * 与图标轨浮层的步进器写同一个 localStorage 键，因此两条入口必须共享同一个
 * 模块级快照，否则会出现「改了一处、另一处显示旧值并把它写回」的缺陷。
 */
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { h } from '../jsx.ts'
import {
  getRecentCountSnapshot,
  setRecentCount,
  subscribeRecentCount,
} from '../preferences.ts'
import { MAX_RECENT_COUNT, MIN_RECENT_COUNT } from '../model/constants.ts'
import { rawKeyTranslator } from '../locales.ts'
import type { Translate } from '../locales.ts'
import { RecentCountRow } from './primitives.tsx'

/** 设置块的入参：宿主注入的 locale 面（`t` 可能缺席）。 */
export interface RailSettingsProps {
  readonly t?: Translate | undefined
}

/**
 * 插件详情页的设置块。
 *
 * 注册进 `plugins.bundle.config`，即插件管理器给 bundle 的座位（宿主自己的
 * cot-translation 与 voice-input bundle 用的是同一个）。图标轨浮层提供同一个
 * 控件，两者写同一个 localStorage 键，因此不会出现分歧。
 * @param props - 宿主提供的 locale 面。
 * @returns 设置块元素。
 */
export function RailSettings({ t }: RailSettingsProps): ReactNode {
  const translate = typeof t === 'function' ? t : rawKeyTranslator
  // 共享 store 而不是本地 state：浮层步进器写同一个值，两个独立的 useState
  // 会让没被改的那个界面继续显示（随后写回）旧条数。
  const count = useSyncExternalStore(subscribeRecentCount, getRecentCountSnapshot, getRecentCountSnapshot)
  return h('div', { className: 'dsr-settings' },
    h('h4', { className: 'dsr-settings-title' }, translate('settings.title')),
    h(RecentCountRow, {
      value: count,
      label: translate('settings.recentCount'),
      onChange: (next: number) => {
        setRecentCount(next)
      },
      min: MIN_RECENT_COUNT,
      max: MAX_RECENT_COUNT,
    }),
    h('p', { className: 'dsr-hint' }, translate('settings.recentCountHint')))
}
