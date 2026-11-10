/**
 * 账号展示数据的纯转换：金额格式化、钱包行、客户端身份与链接白名单。
 *
 * 不发起任何请求，也不读写存储；调用方把远程答案原样传进来，这里只负责
 * 把畸形输入降级成「不显示」，而不是抛错。
 */
import type {
  AccountBalances,
  AccountLinks,
  AccountSeat,
  AccountSeatWithExtras,
  BalanceRow,
} from './types.ts'

/**
 * 把一个非负十进制整数字符串加一，不经过 `Number`，因此远超
 * `Number.MAX_SAFE_INTEGER` 的金额也能正确进位。
 * @param digits - 形如 `99` 或 `0` 的十进制整数文本。
 * @returns 加一后的文本；溢出时多出一位前置数字。
 */
function incrementDecimalDigits(digits: string): string {
  const chars = digits.split('')
  let index = chars.length - 1
  while (index >= 0) {
    const current = chars[index]
    if (current === undefined) break
    if (current === '9') {
      chars[index] = '0'
      index -= 1
    } else {
      chars[index] = String(Number(current) + 1)
      return chars.join('')
    }
  }
  return `1${chars.join('')}`
}

/**
 * 按宿主的方式格式化单个钱包余额。
 *
 * 精确复刻 ui-settings-account 的 `formatBalance`：零读作 `¥0.00`，正数但不足
 * 一分读作 `<¥0.01`，负数保留负号且绝不声称不足一分，其余正数截断
 * （positives, `roundDown`）、负数四舍五入（negatives, `toFixed`）。字符串运算
 * 替代了这个静态模块无法加载的 `Big` 依赖。
 *
 * 负数分支是对绝对值做四舍五入，因此可以进位到整数部分：`-0.999` 在宿主上是
 * `-¥1.00`，`-99.999` 是 `-¥100.00`。只补小数位会得到 `-¥0.100`，所以这里
 * 显式处理进位。
 * @param amount - 钱包给出的十进制余额字符串。
 * @param symbol - 货币符号。
 * @returns 展示文本。
 */
export function formatWalletBalance(amount: unknown, symbol: string): string {
  const raw = typeof amount === 'string' ? amount.trim() : ''
  if (raw === '') return ''
  // 平台线上 schema 允许指数记法（details.ts 接受 `0E-16`、`1e+3`），
  // 定长字符串运算前先展开；此前直接拒绝会静默丢掉整个钱包行。
  const text = expandExponent(raw)
  if (text === null) return ''
  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const [wholeRaw = '', fraction = ''] = unsigned.split('.')
  const whole = wholeRaw === '' ? '0' : wholeRaw
  const zero = /^0*$/.test(wholeRaw) && /^0*$/.test(fraction)
  if (zero) return `${symbol}0.00`
  const subCent = /^0*$/.test(wholeRaw) && fraction.padEnd(3, '0').slice(0, 2) === '00'
  if (subCent) return negative ? `-${symbol}0.01` : `<${symbol}0.01`
  let cents = fraction.padEnd(2, '0').slice(0, 2)
  let units = whole
  // 宿主的负余额走四舍五入（Big#toFixed），正余额走截断（roundDown）；
  // 只有负数分支会进位。
  const third = fraction[2]
  if (negative && fraction.length > 2 && third !== undefined && Number(third) >= 5) {
    const bumped = Number(cents) + 1
    if (bumped === 100) {
      units = incrementDecimalDigits(units)
      cents = '00'
    } else {
      cents = String(bumped).padStart(2, '0')
    }
  }
  // 宿主的 `addCommas` 用 `Number` 分组，这里与之对齐。
  const grouped = Number(units).toLocaleString()
  return `${negative ? '-' : ''}${symbol}${grouped}.${cents}`
}

/**
 * 展开可能使用指数记法的十进制字符串。
 *
 * 只用字符串运算：金额以十进制字符串到达、携带服务端精度，`Number` 会丢精度。
 * 不是普通十进制或指数十进制时返回 null，让调用方丢掉该行。
 * @param text - 候选金额，例如 `12.34`、`0E-16`、`1e+3`、`-0.000001`。
 * @returns 定点十进制文本；输入不是数字时返回 null。
 */
export function expandExponent(text: string): string | null {
  const match = /^(-?)(\d+)?(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (match === null) return null
  const sign = match[1] ?? ''
  const wholeRaw = match[2] ?? ''
  const fractionRaw = match[3] ?? ''
  const expRaw = match[4]
  if (wholeRaw === '' && fractionRaw === '') return null
  const exponent = expRaw === undefined ? 0 : Number(expRaw)
  if (!Number.isFinite(exponent) || Math.abs(exponent) > 100) return null
  let digits = `${wholeRaw}${fractionRaw}`
  let point = wholeRaw.length + exponent
  if (point <= 0) {
    digits = '0'.repeat(1 - point) + digits
    point = 1
  } else if (point > digits.length) {
    digits += '0'.repeat(point - digits.length)
  }
  const whole = digits.slice(0, point).replace(/^0+(?=\d)/, '') || '0'
  const fraction = digits.slice(point)
  return `${sign}${whole}${fraction === '' ? '' : `.${fraction}`}`
}

/**
 * 挑出用户应该看到的钱包行。
 *
 * `getBalance` 回答 `RemoteResult<AccountWallet[] | null>`，每个钱包是
 * `{ currency, balance }`。宿主渲染 bonus 钱包前也做同样的过滤。
 * @param answer - 余额远程调用返回的任何内容。
 * @returns 展示行 `{ currency, text }`，保持给定顺序。
 */
export function balanceRows(answer: unknown): AccountBalances {
  // 线上有三层：RemoteResult{ value: AccountDetails['balance'] }，
  // 其中该 balance 是 `{ status:'ready', value: wallets, bonusWallets }`、
  // `{ status:'failed' }` 或 null。此前把 `answer.value` 当数组读，
  // 真实 Host 答案会被解析成「没有钱包」，而手写数组夹具却让单测保持绿色。
  const remote = unwrapRemoteValue(answer)
  if (remote === null || typeof remote !== 'object') return { wallets: [], bonusWallets: [] }
  const record = remote as Record<string, unknown>
  if (record['status'] !== 'ready') return { wallets: [], bonusWallets: [] }
  const map = (list: unknown): BalanceRow[] => {
    if (!Array.isArray(list)) return []
    const out: BalanceRow[] = []
    for (const wallet of list) {
      if (wallet === null || typeof wallet !== 'object') continue
      const entry = wallet as Record<string, unknown>
      const currency = entry['currency'] === 'USD' ? 'USD' : entry['currency'] === 'CNY' ? 'CNY' : undefined
      if (currency === undefined) continue
      const text = formatWalletBalance(entry['balance'], currency === 'CNY' ? '¥' : '$')
      if (text === '') continue
      // 零保留：宿主会渲染它收到的每个钱包，于是 `¥0.00` 行属于「显示宿主显示的」。
      out.push({ currency, text })
    }
    return out
  }
  return { wallets: map(record['value']), bonusWallets: map(record['bonusWallets']) }
}

/**
 * 取出平台账号视图携带的跳转链接。
 *
 * `getState` 无论是否登录都给出 `links`（宿主按平台 origin 构造）。只接受绝对
 * http(s) URL：畸形值必须隐藏条目，而不是打开别的东西。
 * @param view - `remote.account.getState()` 的 `AccountView`。
 * @returns 两个可选链接；不可用的一侧整个省略。
 */
export function accountLinks(view: unknown): AccountLinks {
  const remote = unwrapRemoteValue(view)
  const links = remote !== null && typeof remote === 'object'
    ? (remote as Record<string, unknown>)['links']
    : undefined
  if (links === null || links === undefined || typeof links !== 'object') return {}
  const record = links as Record<string, unknown>
  const usable = (value: unknown): string | undefined =>
    (typeof value === 'string' && /^https?:\/\//i.test(value) ? value : undefined)
  // 只保留通过校验的键，调用方因此可以直接判 `=== undefined`，
  // 不必区分「缺失」与「存在但不可用」。
  const usageUrl = usable(record['usageUrl'])
  const topUpUrl = usable(record['topUpUrl'])
  return {
    ...(usageUrl === undefined ? {} : { usageUrl }),
    ...(topUpUrl === undefined ? {} : { topUpUrl }),
  }
}

/**
 * 求本客户端的构建版本号，用于账号调用携带的身份。
 *
 * 手写静态模块没有 `process`（渲染进程开着 contextIsolation、没有 node 集成），
 * 所以 `process.env.DSH_CLIENT_VERSION` 只会被内联进宿主自己的 bundle。
 * 页面收到的启动图（boot graph）携带同一版本号。
 * @returns 版本字符串；两个来源都没有时返回 undefined。
 */
export function clientBuildVersion(): string | undefined {
  const boot = typeof globalThis === 'undefined'
    ? undefined
    : (globalThis as { readonly __DSH_BOOT__?: unknown }).__DSH_BOOT__
  const release = boot !== null && typeof boot === 'object'
    ? (boot as Record<string, unknown>)['release']
    : undefined
  if (release !== null && release !== undefined && typeof release === 'object') {
    const version = (release as Record<string, unknown>)['version']
    if (typeof version === 'string' && version !== '') return version
  }
  const env = typeof process === 'undefined'
    ? undefined
    : (process as { readonly env?: Record<string, string | undefined> }).env?.['DSH_CLIENT_VERSION']
  return typeof env === 'string' && env !== '' ? env : undefined
}

/**
 * 构造每次账号调用都要携带的身份。
 *
 * 宿主的 `accountClientMetadata` 发送 `{ version, locale, timezoneOffsetSeconds }`；
 * 时区是较少见的一半——JS 报告的是 UTC 以西的分钟数，而平台要的是 UTC 以东的秒数，
 * 因此符号相反。构建没有版本号时返回 null，避免用畸形身份调用接口。
 * @param locale - 当前 locale id。
 * @param version - 本客户端构建版本。
 * @param offsetMinutes - 当前时区的 `Date#getTimezoneOffset()`。
 * @returns 身份对象；无法构造时返回 null。
 */
export function accountClientMetadata(
  locale: string | null | undefined,
  version: string | undefined,
  offsetMinutes: number | undefined,
): { version: string; locale: string; timezoneOffsetSeconds: number } | null {
  if (typeof version !== 'string' || version === '') return null
  return {
    version,
    locale: typeof locale === 'string' && locale !== '' ? locale : 'en',
    timezoneOffsetSeconds: -(Number(offsetMinutes ?? 0)) * 60,
  }
}

/**
 * 决定账号座位该显示什么。
 *
 * 宿主侧栏只渲染两种形态（ui-settings-account AccountMenu）：已登录头像，
 * 或未登录时的「更多」省略号（完全没有图片槽）。图标轨保留同一分野，
 * 绝不为未登录的人虚构一张脸。
 * @param viewAnswer - `remote.account.getState()` 的答案（只有登录态）。
 * @param profileAnswer - `remote.account.getProfile()` 的答案（取到时）。
 * @returns 三种座位形态之一。
 */
export function accountSeatState(viewAnswer: unknown, profileAnswer: unknown): AccountSeat {
  const view = unwrapRemoteValue(viewAnswer)
  if (view === null || typeof view !== 'object') return { kind: 'unknown', avatarUrl: undefined }
  if ((view as Record<string, unknown>)['status'] !== 'credential-stored') {
    return { kind: 'signed-out', avatarUrl: undefined }
  }
  // 到达 URL 之前有三层：RemoteResult{ value: AccountProfileRead{ status,
  // value: AccountProfile{ avatarUrl } } }。宿主读的正是这条路径
  // （ui-settings-account: `result.value.value.avatarUrl`），所以状态门与
  // 头像在两个不同层级上。
  const read = unwrapRemoteValue(profileAnswer)
  if (read === null || typeof read !== 'object') return { kind: 'signed-in', avatarUrl: undefined }
  const readRecord = read as Record<string, unknown>
  if (readRecord['status'] !== 'ready') return { kind: 'signed-in', avatarUrl: undefined }
  const profile = readRecord['value']
  if (profile === null || profile === undefined || typeof profile !== 'object') {
    return { kind: 'signed-in', avatarUrl: undefined }
  }
  const url = (profile as Record<string, unknown>)['avatarUrl']
  return {
    kind: 'signed-in',
    avatarUrl: typeof url === 'string' && url.trim() !== '' ? url.trim() : undefined,
  }
}

/**
 * 给每个账号答案补上只读附加信息。
 *
 * `getState` 无论是否存了凭据都给出 `links`（宿主按平台 origin 构造），
 * 所以未登录与「资料不可用」两条早返回路径也必须保留它们：只有 `balances`
 * 依赖登录态。把这个动作收成一个函数，正是为了避免那些早返回静默丢掉
 * 用量/充值入口——那正是让未登录用户看不到入口的缺陷。
 * @param seat - `accountSeatState` 的结果。
 * @param viewAnswer - `remote.account.getState()` 的答案，用于取 `links`。
 * @param balanceAnswer - `remote.account.getBalance()` 的答案（取到时）。
 * @returns 座位加上 `balances` 与 `links`，两者恒存在。
 */
export function withAccountExtras(
  seat: AccountSeat,
  viewAnswer: unknown,
  balanceAnswer: unknown,
): AccountSeatWithExtras {
  return { ...seat, balances: balanceRows(balanceAnswer), links: accountLinks(viewAnswer) }
}

/**
 * 剥掉 `RemoteResult` 外壳，取出 `value`；没有外壳时原样返回。
 * @param answer - 任意远程答案。
 * @returns 内层值，或原输入。
 */
function unwrapRemoteValue(answer: unknown): unknown {
  return answer !== null && typeof answer === 'object' && 'value' in answer
    ? (answer as { readonly value?: unknown }).value
    : answer
}
