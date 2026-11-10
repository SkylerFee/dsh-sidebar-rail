/**
 * dsh-sidebar-rail bundle 的 Host 半边。
 *
 * 本插件是纯 Client 插件：所有可见能力都在 `src/client/` 里，由页面通过客户端
 * 模块表加载。Host 半边存在的意义只是让 bundle 有可安装的一行、并在插件管理器
 * 中出现，因此 `apply` 是空的。
 */

/** Host 入口：不做任何注册，也不读取 Client 能力。 */
export function apply(): void {}
