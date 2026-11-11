/**
 * JSX 运行时垫片与共享类型。
 *
 * 构建产物只能 require 宿主提供的 `react` / `react-dom`，且首期使用 classic
 * JSX 转换（`React.createElement`），因此所有 TSX 文件都从这里取 `h` 与
 * `Fragment`，不产生额外的 `react/jsx-runtime` 请求。
 */
import * as React from 'react'
import type { ReactElement } from 'react'

/** 与 `React.createElement` 同形的工厂，供 classic JSX 转换使用。 */
export const h = React.createElement

/** JSX 片段工厂。 */
export const Fragment = React.Fragment

/**
 * 组件可返回的类型。
 *
 * classic 转换下 TS 用工厂的返回类型检查 JSX，因此组件签名统一写成
 * `ReactElement | null`（`null` 表示不渲染），而不是更宽的 `ReactNode`。
 */
export type Jsx = ReactElement | null
