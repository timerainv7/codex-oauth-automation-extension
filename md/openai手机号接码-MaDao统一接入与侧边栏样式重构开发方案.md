# OpenAI 手机号接码 MaDao 统一接入与侧边栏样式重构开发方案

## 1. 文档定位

本文用于指导后续重新实现 PR #288 相关能力，并同时收敛侧边栏里文本框、按钮、接码 provider 显隐和无用保存按钮问题。目标不是照搬 PR，而是在现有项目真实结构上重新设计一次，保证 OpenAI 手机号注册、后置手机号验证、provider 接码生命周期、设置持久化和侧边栏 UI 一致落地。

本文只是一份开发方案，不直接修改功能代码。后续实现时应按本文的阶段清单逐段开发、逐段自检，发现现有代码与本文冲突时，先修正方案或明确取舍，再改代码。

## 2. 分析基线

已确认的当前工程基线：

- 当前扩展是 Chrome MV3，`manifest.json` 的后台入口是 `background.js`，侧边栏入口是 `sidepanel/sidepanel.html`。
- OpenAI flow 定义在 `flows/openai/index.js` 和 `flows/openai/workflow.js`，并声明 `supportsPhoneSignup: true`、`supportsPhoneVerificationSettings: true`。
- Kiro/Grok 当前不支持手机号注册和接码设置，`flows/kiro/index.js`、`flows/grok/index.js` 均为 `supportsPhoneSignup: false`、`supportsPhoneVerificationSettings: false`。
- 手机接码目前在架构上仍是 OpenAI 私有能力。`docs/多注册流程架构边界.md` 明确指出 HeroSMS / 5sim / NexSMS、取号、复用、轮询、换号、释放、手机号注册和后置 add-phone 暂不进入 core 通用服务。
- 当前 provider 注册表是 `phone-sms/providers/registry.js`，已有 `hero-sms`、`5sim`、`nexsms`。
- 当前接码主编排是 `background/phone-verification-flow.js`，实际运行还要同步考虑 `background.js` 内联后的运行入口。
- 当前侧边栏已有统一表单布局基础：`--data-label-width: 76px`、`--data-field-height: 34px`、`.data-inline` 作为右侧弹性控制区、`.btn` 和 `.data-input` / `.data-select` 共用高度。
- `tests/sidepanel-form-layout.test.js` 已保护“每个 `.data-row` 只有 label + 一个控制区”“按钮/输入框高度统一”“不再出现 `icon-action-btn`”等约束。

PR #288 的已知结论：

- PR 标题为“接入 MaDao 统一接码并收敛 provider 换号链路”。
- PR 增加了 `phone-sms/providers/madao.js`，并在 provider registry 中注册 MaDao。
- PR 的 MaDao 适配层包含 `acquireActivation`、`pollActivation`、`releaseActivation`、`rotateActivation`、`replaceRoutingActivation`，核心 API 为 `/api/acquire`、`/api/poll`、`/api/release`、`/api/routing/replace`。
- PR 中值得保留的是 MaDao provider 模块边界、`routing_plan` / `direct` 两种模式、路由换号 `/api/routing/replace` 的行为。
- PR 中不应照搬的是主流程里 MaDao 特例函数、sidepanel 里散落的 MaDao 专用行和 GitHub 图标按钮，以及任何绕过 provider adapter 契约的判断。

## 3. 需求与硬边界

必须满足的需求：

- 重新实现 MaDao 接码接入，不直接复制 PR #288 的堆叠式 UI 和主流程特例。
- 不留旧的无用代码。被新 provider 契约、统一 UI descriptor、自动保存机制取代的分支、按钮、样式和测试夹具都要清理干净。
- 文本框与按钮高度、边框、宽度体系统一；按钮不需要图标。
- 表单布局采用“固定 label 宽度 + 右侧控制区占剩余宽度 + 可选按钮固定最小宽度”的模型，而不是固定文本框宽度。
- 即使某些文本框右侧新增按钮，也不能挤乱同一组布局；输入框应继续占剩余宽度。
- 项目地址必须正确：CPA 为 `https://github.com/router-for-me/CLIProxyAPI`，sub2api 为 `https://github.com/Wei-Shaw/sub2api`。
- GitHub 按钮使用普通文字按钮并纳入统一按钮样式，不做图标按钮。
- 自动保存已经存在时，纯“保存设置”按钮应删除；但查询价格、查余额、刷新列表、清空、记录运行时号码等有明确动作语义的按钮可以保留。
- OpenAI 手机号注册模式必须和后置 add-phone 区分，不能混用状态字段。

不能突破的边界：

- MaDao 只接入 OpenAI 手机接码能力，不把接码提升为 core 通用服务。
- Kiro/Grok 不显示 OpenAI 接码、Plus、平台绑定相关配置。
- 主流程不得写 MaDao 专用大分支；新增能力应通过 provider registry 和 provider adapter 暴露。
- 不能因为接入 MaDao 破坏现有 HeroSMS、5sim、NexSMS 行为和存量配置。
- 不能只修改 `background/phone-verification-flow.js` 而忘记实际加载的 `background.js`，也不能只改 `background.js` 导致模块测试失真。

## 4. 当前真实实现现状

### 4.1 OpenAI 手机号注册模式

OpenAI flow 当前不是单一注册路径，而是多个 variant：

- `normal`：邮箱注册 -> 邮箱验证码 -> 登录验证码 -> 后置手机号验证 -> OAuth -> 平台回调。
- `normalPhone`：手机号注册 -> 手机验证码 -> 登录验证码 -> 绑定邮箱 -> 绑定邮箱验证码 -> OAuth -> 平台回调。
- `normalPhoneRelogin`：手机号注册并绑定邮箱后，切入绑定邮箱重登链路。

因此“手机号注册”和“后置手机号验证”虽然都依赖接码 provider，但状态槽位不同：

- 手机号注册使用 `signupPhoneNumber`、`signupPhoneActivation`、`signupPhoneCompletedActivation`。
- 后置 add-phone 使用 `currentPhoneActivation`。

后续 MaDao 接入必须同时覆盖这两条链路，并在日志、换号、释放、成功完成时保持状态字段不串线。

### 4.2 provider 当前模型

当前 provider 顺序为 `hero-sms`、`5sim`、`nexsms`。`DEFAULT_PHONE_SMS_PROVIDER_ORDER` 和相关 normalize 函数会按 provider 数量截断，所以接入 MaDao 时必须同步扩展 provider 常量、顺序、registry、测试 fixture，否则 UI 选中了 MaDao 也可能被 normalize 回退或截断。

当前 `background/phone-verification-flow.js` 仍有较多 provider 内联逻辑。后续应把 MaDao 做成 adapter，并逐步收敛公共生命周期：

- acquire：取号。
- poll：轮询短信。
- release：cancel / ban / finish。
- rotate：失败换号，允许 provider 自己决定是先 release 再 acquire，还是走路由替换。
- normalize：把 provider 返回值转成统一 activation。

### 4.3 侧边栏 UI 当前模型

侧边栏接码区已经存在 HeroSMS、5sim、NexSMS 的配置行，且很多字段复用了 HeroSMS 命名或布局类。后续实现不应继续在 `sidepanel.js` 里追加大量 `if provider === ...` 片段，而应引入 provider UI descriptor 或至少集中式字段矩阵，让“显示哪些行、保存哪些字段、切换 provider 时保留哪些值”有统一来源。

当前布局已有正确方向：

- `.data-row` 负责一行。
- `.data-label` 固定 label 宽度。
- `.data-inline` 作为右侧 control area，`flex: 1 1 0`。
- `.data-input`、`.data-select`、`.btn` 统一高度。
- `.data-inline-btn` 用固定最小宽度承接右侧动作按钮。

需要避免的是：

- 直接在 `.data-row` 里放多个并列控制元素，导致 label 后布局不可预测。
- 单独给某些按钮做无边框、特殊高度、图标按钮或内联 style。
- 为某个 provider 写独立布局，造成切换 provider 后高度、宽度、边框不一致。

## 5. PR #288 取舍

### 5.1 保留的设计

保留 MaDao 作为独立 provider 模块的方向。建议文件为 `phone-sms/providers/madao.js`，暴露 `createProvider()`，并返回统一方法：

- `acquireActivation(state, options, deps)`
- `pollActivation(state, activation, deps)`
- `releaseActivation(state, activation, action, deps)`
- `rotateActivation(state, activation, options, deps)`
- `replaceRoutingActivation(state, activation, options, deps)`

保留 MaDao 默认配置：

- `provider id`: `madao`
- `label`: `MaDao`
- `baseUrl` 默认 `http://127.0.0.1:7822`
- `service` 默认 `openai`
- HTTP Secret 通过 `Authorization: Bearer <secret>` 传递

保留两种模式：

- `routing_plan`：使用 `madaoRoutingPlanId`，取号只提交 `routing_plan_id` 和 `service`，失败换号优先走 `/api/routing/replace`。
- `direct`：使用 `madaoProviderId`、`madaoCountry`、`madaoAutoPickCountry`、`madaoReusePhone`、`madaoMinPrice`、`madaoMaxPrice`。

### 5.2 不照搬的内容

不照搬主流程里的 MaDao 专用函数，例如 `requestMaDaoActivation`、`getMaDaoProviderForState` 这类把 provider 逻辑重新塞回编排层的写法。

不照搬 sidepanel 中大量散落的 MaDao row/handler。MaDao 字段应通过 provider UI descriptor 或集中显隐矩阵接入：

- provider 选择变更只触发一套 `applyPhoneSmsProviderUi(provider, state)`。
- 保存 payload 只走一套 `collectPhoneSmsProviderSettings(provider)`。
- 恢复 UI 只走一套 `restorePhoneSmsProviderSettings(state)`。

不增加 `btn-open-madao-github`。MaDao 本地服务不是当前目标项目地址入口，GitHub 入口只保留已有项目来源按钮，且按钮样式应统一为普通文字按钮。

## 6. 最终设计

### 6.1 provider 契约

新增或收敛 provider adapter 契约：

```js
{
  id,
  label,
  defaultProduct,
  acquireActivation(state, options, deps),
  pollActivation(state, activation, deps),
  releaseActivation(state, activation, action, deps),
  rotateActivation(state, activation, options, deps)
}
```

编排层只依赖契约，不依赖 provider 私有字段。activation 可以携带 provider 私有字段，但编排层只把它们原样保留和回传，最多读取统一字段：

- `activationId`
- `phoneNumber`
- `provider`
- `serviceCode`
- `countryId`
- `countryLabel`

MaDao 私有字段例如 `madaoRoutingPlanId`、`madaoRoutingItemId`、`madaoAcquirePath`、`madaoStatus` 只由 MaDao adapter 或展示层使用。

### 6.2 MaDao 设置字段

新增设置字段建议如下：

- `madaoBaseUrl`
- `madaoHttpSecret`
- `madaoMode`: `routing_plan` 或 `direct`
- `madaoRoutingPlanId`
- `madaoProviderId`
- `madaoCountry`
- `madaoAutoPickCountry`
- `madaoReusePhone`
- `madaoMinPrice`
- `madaoMaxPrice`

`madaoServiceName` 不建议作为普通可编辑项显示。OpenAI flow 下 service 固定为 `openai` 更符合当前边界，也能减少用户误配。如果确实需要保留兼容字段，可以内部默认和持久化，但 UI 只显示只读说明或不显示。

这些字段必须进入：

- 默认 state。
- 导入导出和最新设置合并 key。
- sidepanel 恢复、保存、消息更新。
- background 模块与实际 `background.js` 同步入口。
- 相关单元测试 fixture。

### 6.3 MaDao 模式显隐

MaDao 选中时显示：

- Base URL。
- HTTP Secret。
- 模式选择。

`routing_plan` 模式显示：

- 路由方案选择或路由方案 ID。
- 刷新路由方案按钮，如果 MaDao 后端提供列表接口；如果没有列表接口，只保留 ID 输入框，不做假刷新按钮。

`routing_plan` 模式隐藏：

- direct provider。
- country。
- auto pick country。
- reuse phone。
- min/max price。

`direct` 模式显示：

- MaDao provider。
- country。
- auto pick country。
- reuse phone。
- min/max price。

`direct` 模式隐藏：

- routing plan 字段。
- routing replace 相关交互。

### 6.4 其他 provider 显隐矩阵

HeroSMS 显示：

- API Key。
- 国家优先级。
- 生效顺序。
- 拿号优先级。
- 运营商。
- 价格区间：min、max、preferred。
- 号码复用。
- 白嫖复用。
- 查询价格。
- 查余额。

5sim 显示：

- API Key。
- 国家优先级。
- 生效顺序。
- 运营商。
- 产品代码。
- 价格区间：min、max。
- 号码复用。

5sim 不显示：

- preferred price。
- HeroSMS 价格档位查询。
- 白嫖复用。

NexSMS 显示：

- API Key。
- 国家优先级。
- 生效顺序。
- 服务代码。

NexSMS 不显示：

- preferred price。
- operator。
- product。
- 号码复用。
- 白嫖复用。

MaDao 按 6.3 显隐，不复用 HeroSMS 的价格预览区，不显示无意义的国家多选和 provider 顺序内的 HeroSMS 专属说明。

### 6.5 换号与释放

步骤 9 和手机号注册验证码链路中的失败换号都应走统一 provider 方法：

- provider 有 `rotateActivation` 时优先调用。
- MaDao `routing_plan` 且 activation 带 `madaoRoutingPlanId` 时，`rotateActivation` 内部走 `/api/routing/replace` 并返回 `nextActivation`。
- MaDao `direct` 或没有可替换路由信息时，先 release 当前 ticket，再让编排层按 provider 顺序重新 acquire。
- HeroSMS、5sim、NexSMS 可以先维持现状，但调用入口要向统一契约靠拢。

编排层不应关心 MaDao 的 `/api/routing/replace` endpoint，只应理解 `rotateActivation` 的返回：

```js
{
  currentTicketId,
  currentTicketRelease,
  nextActivation
}
```

### 6.6 OpenAI 手机号注册状态

后续实现必须分别覆盖：

- Step 2 手机号注册取号和填手机号。
- Step 4 手机注册验证码轮询和提交。
- Step 8 登录验证码、绑定邮箱状态分支。
- Step 9 后置 add-phone 取号、轮询、失败换号、成功释放或保留。

关键约束：

- `signupPhoneActivation` 不写入 `currentPhoneActivation`。
- `currentPhoneActivation` 不覆盖 `signupPhoneActivation`。
- `signupPhoneCompletedActivation` 用于手机号注册完成后的记录，不用于后置 add-phone 的当前订单。
- 页面已经在等手机验证码但 state 没有 activation 时，应给出明确错误，不自动构造虚假订单。

### 6.7 按钮与文本框统一设计

采用固定 label 宽度，不固定文本框宽度：

```txt
| 76px label | flex:1 控制区 |
```

控制区规则：

- 普通单输入：`input.data-input` 直接作为第二个子元素，宽度占满剩余。
- 输入 + 按钮：使用 `div.data-inline` 包裹，输入 `flex: 1 1 0`，按钮使用 `.data-inline-btn`。
- 多按钮动作组：仍放入一个 `.data-inline`，按钮高度统一，必要时允许换行，但不破坏 label + control 的两列结构。
- 密码显示按钮属于输入框内部交互，保留 `input-with-icon`，但不使用 GitHub 图标或 provider 图标。

按钮规则：

- 所有普通按钮使用 `.btn` 基础类，必须有 `border: 1px solid var(--border)` 和 `min-height: var(--data-field-height)`。
- 小按钮可以用 `btn-sm` / `btn-xs` 调整字体和 padding，但高度仍应由统一变量约束。
- 行内动作按钮使用 `.data-inline-btn`，统一最小宽度，不按文案临时写 style。
- 不再新增 `icon-action-btn`，已有图标按钮若不是密码显隐这种输入内部控制，应改成文字按钮。
- GitHub 按钮显示为 `GitHub` 文本，使用 `btn btn-outline btn-sm data-inline-btn`。

删除按钮规则：

- 删除纯保存设置按钮，因为当前 `saveSettings({ silent: true })` 和 autosave 已覆盖设置变更。
- 保留“记录”“清除”“查询价格”“查余额”“拉取”“下一条”“检测出口”等命令按钮，因为它们触发的不是单纯保存。
- 删除按钮时必须同步删除 DOM 引用、事件监听、CSS、测试断言和无用 helper。

### 6.8 项目 GitHub 按钮

项目地址入口只保留一套：

- CPA: `https://github.com/router-for-me/CLIProxyAPI`
- sub2api: `https://github.com/Wei-Shaw/sub2api`

按钮不做图标，不使用 SVG，不新增 MaDao GitHub 入口。`tests/sidepanel-flow-source-registry.test.js` 需要继续保护 URL 和按钮 class。

## 7. 方案自检

### 7.1 是否符合需求

符合。方案明确处理了 PR #288 的重新实现、MaDao provider 接入、OpenAI 手机号注册模式、不同 provider 显隐、文本框和按钮统一、GitHub 按钮去图标化、无用保存按钮删除、旧代码清理等要求。

### 7.2 是否完善

基本完善。方案覆盖后台 provider 生命周期、侧边栏显示、设置持久化、自动保存、测试和实际运行入口。需要在实现阶段继续用代码验证的点是 MaDao 后端是否提供路由方案列表接口；如果没有，则 UI 不能设计“刷新路由方案”按钮，只能提供 ID 输入。

### 7.3 是否完整

完整性满足本次开发目标。方案没有只看 sidepanel，也覆盖了 OpenAI workflow、Step 2/4/8/9、provider registry、settings schema、`background.js` 实际入口和测试。未纳入范围的是把整个接码系统抽成 core 服务，因为这与现有架构边界冲突。

### 7.4 是否正确

方向正确。MaDao 被设计为 OpenAI 接码 provider，不污染 Kiro/Grok；routing replace 被封装在 provider adapter 内，不让主流程理解 MaDao endpoint；手机号注册和后置 add-phone 状态分离，避免订单串线。

### 7.5 是否规范一致

一致。UI 沿用当前 `.data-row`、`.data-label`、`.data-inline`、`.btn`、`.data-inline-btn` 体系；provider 沿用 `phone-sms/providers/registry.js`；测试沿用 `node --test tests/*.test.js`；中文文档风格与 `md` 目录已有方案保持一致。

### 7.6 是否存在设计冲突

已识别并规避以下冲突：

- “接码通用化”与现有架构边界冲突：本方案不通用化到 core。
- “固定文本框宽度”与行内按钮扩展冲突：本方案固定 label 和按钮最小宽度，让输入框占剩余。
- “MaDao routing_plan”与 direct 参数冲突：两种模式显隐互斥，payload 也互斥。
- “自动保存”与保存按钮冲突：纯保存按钮删除，命令按钮保留。
- “PR #288 直接 diff”与当前本地 UI 改动冲突：只吸收 provider 行为，不照搬 sidepanel 和主流程特例。
- “模块测试文件”与 `background.js` 实际入口冲突：实现阶段必须同步两边或使用现有生成/同步方式验证。

### 7.7 方案自身缺陷和风险

仍需在实现阶段验证的风险：

- MaDao 后端接口返回字段可能和 PR 样例不完全一致，需要 provider 单测覆盖异常 payload、空 ticket、空 phone、HTTP 错误和超时。
- 当前 `background/phone-verification-flow.js` provider 内联较多，完全一次性抽象所有 provider 风险较高。建议本次只为 MaDao 建立统一入口，并把会影响 MaDao 的 acquire/poll/release/rotate 入口收敛，不做无关大重构。
- sidepanel 当前文件较大，集中 descriptor 改造要控制范围。优先让接码设置区 descriptor 化，不顺手重构 Plus、代理、邮箱等其他区域。
- 删除按钮时容易误删命令按钮。判断标准必须是“是否只保存当前设置”，不是“按钮文案里是否有保存/记录”。
- provider 顺序扩展到 4 个后，测试 fixture 中硬编码 3 个 provider 的地方较多，必须全局搜索更新。

## 8. 分阶段开发清单

### 阶段 1：基线保护与差异确认

开发内容：

- 确认当前分支状态，记录本地 ahead commit，不回退已有改动。
- 对比 PR #288，只提取 MaDao provider、routing replace 行为和测试意图。
- 运行现有定向测试，建立失败/通过基线。
- 全局搜索旧图标按钮、保存按钮、provider 顺序硬编码、MaDao 残留。

阶段自检：

- 确认没有改动功能代码。
- 确认 CPA / sub2api GitHub URL 未被误改。
- 确认没有把 PR #288 中删除大量无关文件的改动纳入本次范围。
- 确认终端和文档无乱码。

### 阶段 2：MaDao provider 模块与 registry

开发内容：

- 新增 `phone-sms/providers/madao.js`。
- 在 `phone-sms/providers/registry.js` 注册 `madao`。
- 扩展 `DEFAULT_PHONE_SMS_PROVIDER_ORDER` 为 4 个 provider。
- 更新 provider normalize、label、moduleKey、provider ids 测试。

阶段自检：

- MaDao 未加载时错误信息明确。
- provider order 不截断 MaDao。
- HeroSMS、5sim、NexSMS normalize 行为不变。
- 单测覆盖未知 provider 回退默认 provider。
- 检查新文件 UTF-8 中文错误信息无乱码。

### 阶段 3：接码编排层接入统一 rotate

开发内容：

- 在 `background/phone-verification-flow.js` 中接入 MaDao adapter。
- 收敛 acquire/poll/release/rotate 的调用入口，让 MaDao 走 provider 契约。
- Step 9 换号优先调用 `rotateActivation`，routing plan 返回 `nextActivation` 时直接继续使用新号。
- direct 模式或没有 `nextActivation` 时走现有释放后重新取号流程。
- 同步实际运行入口 `background.js`。

阶段自检：

- 手机号注册 Step 2/4 使用 `signupPhoneActivation`。
- 后置 add-phone Step 9 使用 `currentPhoneActivation`。
- 失败换号不会把 signup activation 写入 current activation。
- MaDao routing replace 的 cancel/ban action 传参正确。
- HeroSMS、5sim、NexSMS 原有换号、释放、成功完成行为不回退。

### 阶段 4：设置默认值、导入导出与状态同步

开发内容：

- 新增 MaDao 设置默认值。
- 更新 settings schema、最新设置 key、导入导出、消息保存 payload。
- 更新 sidepanel restore 和后台 state merge。
- 为 `madaoMode`、`madaoBaseUrl`、`madaoHttpSecret`、`madaoRoutingPlanId`、direct 字段加 normalize。

阶段自检：

- 空配置下 MaDao 使用默认 `http://127.0.0.1:7822`。
- `routing_plan` 不提交 direct 字段。
- `direct` 不提交 routing plan 字段。
- 导入旧配置不会丢 HeroSMS / 5sim / NexSMS 设置。
- 自动保存不会在用户输入数字半成品时强行格式化造成体验问题。

### 阶段 5：侧边栏 provider UI descriptor

开发内容：

- 建立接码 provider 字段矩阵或 descriptor。
- 将 HeroSMS、5sim、NexSMS、MaDao 的行显隐集中到一处。
- provider 切换时保存当前 provider 独立字段，再恢复目标 provider 字段。
- MaDao mode 切换时刷新 routing/direct 显隐。
- 删除散落的 provider 专用重复判断。

阶段自检：

- HeroSMS 只显示 HeroSMS 相关字段。
- 5sim 不显示 preferred price 和白嫖复用。
- NexSMS 不显示 operator/product/复用。
- MaDao routing plan 不显示 direct 字段。
- MaDao direct 不显示 routing plan 字段。
- 切换 provider 不丢失其他 provider 已填 API key 和价格字段。
- Kiro/Grok 下不显示接码设置。

### 阶段 6：文本框和按钮样式统一

开发内容：

- 清理接码区和项目地址区不一致按钮样式。
- 删除无用纯保存按钮及对应 JS/CSS/测试。
- 所有行改为 label + 单一 control area。
- 有右侧按钮的文本框统一使用 `.data-inline` + `.data-inline-btn`。
- GitHub 按钮保持文字按钮，不使用图标。

阶段自检：

- `tests/sidepanel-form-layout.test.js` 通过。
- 全局不存在 `icon-action-btn`。
- `.data-row` 没有超过两个直接子元素。
- `.btn`、`.data-input`、`.data-select` 高度一致。
- 按钮都有边框，除输入框内部密码显隐按钮外不出现无边框图标按钮。
- 文案较长按钮不撑破布局，必要时按统一规则换行。

### 阶段 7：测试完善

开发内容：

- 增加 MaDao provider 单测：acquire、poll、release、routing replace、direct fallback、超时、HTTP 错误。
- 增加 provider registry 测试：MaDao 注册、顺序、label、moduleKey。
- 增加 phone verification flow 测试：Step 9 routing replace 成功、routing replace 返回无效 next ticket、direct 模式释放后重新取号。
- 增加 sidepanel 测试：MaDao 字段显隐、mode 切换、保存 payload、provider 切换字段保留。
- 更新现有 provider order 和 settings schema 测试。

阶段自检：

- 定向测试全部通过。
- 全量 `npm test` 通过。
- 没有只为测试通过而保留旧死代码。
- 测试名称准确描述行为，不写和实现不符的宽泛断言。

### 阶段 8：最终清理与人工核验

开发内容：

- 全局搜索 MaDao 旧函数名、旧按钮 id、旧 icon 类、无用 CSS。
- 全局搜索 provider 顺序硬编码的 3 provider 残留。
- 检查 sidepanel 渲染效果，确认按钮、文本框、select 高度和边框一致。
- 检查 OpenAI / Kiro / Grok 各 flow 显隐。
- 检查 CPA / sub2api 项目地址按钮。

阶段自检：

- `rg -n "requestMaDaoActivation|getMaDaoProviderForState|btn-open-madao-github|icon-action-btn" .` 无结果。
- `rg -n "hero-sms.*5sim.*nexsms" tests sidepanel background phone-sms` 中需要 4 provider 的地方已包含 MaDao。
- 文档、源码、测试无乱码字符；乱码样本不要写进方案正文，避免检查命令命中自身。
- `git diff` 中没有无关删除、无关格式化或用户未要求的重构。
- 最终运行全量测试并记录结果。

## 9. 验证命令

建议按阶段使用以下命令：

```powershell
node --test tests/phone-sms-provider-registry.test.js
node --test tests/phone-verification-flow.test.js
node --test tests/sidepanel-phone-verification-settings.test.js
node --test tests/sidepanel-form-layout.test.js
node --test tests/sidepanel-flow-source-registry.test.js
npm test
```

建议的清理检查：

```powershell
rg -n "requestMaDaoActivation|getMaDaoProviderForState|btn-open-madao-github|icon-action-btn" .
$staleMarkers = @('T' + 'ODO', '待' + '补', '以后' + '再说', '占' + '位') -join '|'
rg -n $staleMarkers md sidepanel background phone-sms tests
git status --short --branch
git diff --check
```

## 10. 最终结论

本次应按“OpenAI 私有接码 provider 扩展 + 侧边栏 provider descriptor + 表单统一布局”三条线并行收敛。MaDao 的价值在于统一接码后端和 routing replace，不应把它变成主流程里的新特例；UI 的价值在于固定 label、固定按钮最小宽度、输入框占剩余，而不是继续给每个 provider 单独堆宽高和按钮风格。

后续实现完成的标准是：MaDao 能在手机号注册和后置 add-phone 两条链路中稳定取号、轮询、释放、换号；不同 provider 只显示自己需要的字段；按钮和文本框视觉一致；自动保存下没有多余保存按钮；旧的 MaDao 特例和图标按钮代码完全清理。
