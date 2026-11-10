/**
 * `styles.css` 的模块声明。
 *
 * 构建时 esbuild 以 `text` loader 把 CSS 当成字符串内联进产物，因此运行期它
 * 就是一段文本；类型上只需声明「这里的默认导出是字符串」，不需要 DOM 或
 * CSS 模块的类型。样式仍由 `apply` 的 effect 创建带 `data-dsh-sidebar-rail`
 * 标记的 style 节点，卸载时移除。
 */
declare const styles: string

export default styles
