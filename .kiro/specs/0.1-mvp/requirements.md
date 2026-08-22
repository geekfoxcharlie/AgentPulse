# AgentPulse 0.1 MVP Requirements

Spec version: 0.1  
Status: Ready for local configuration

## 1. 目的

本迭代以 `search` 能力组建立 AgentPulse 的第一个可用闭环：由 Agent 通过 CLI 配置和查询六个首批独立搜索 API，按组执行带一小时缓存的最小健康检查，并由用户通过本地只读 Web 页面查看相同信息。

长期产品目标、信任模型和非目标以 [`docs/REQUIREMENTS.md`](../../../docs/REQUIREMENTS.md) 为准；系统边界和数据归属以 [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) 为准。本 Spec 只拥有 0.1 迭代的增量范围和验收条件。

## 2. 迭代目标

### Requirement 1：建立用户级配置注册表

0.1 MUST 实现跨项目共享的用户级能力组和 API 配置。

配置 MUST 是可检查的声明式文件，并具有机器可读 Schema。至少支持：

- 新增和更新能力组；
- 新增和更新 API；
- 启用和停用 API；
- 校验全部配置；
- 检测重复 ID、未知能力组、缺失凭据引用和不完整探测定义。

写入 MUST 通过 CLI 完成并采用原子更新。0.1 不要求在 Web 中修改配置，也不要求删除配置。

### Requirement 2：接入首批搜索 API

0.1 MUST 随程序提供 `search` 能力组和以下六个非密钥内置模板：

| API ID | 服务 | 默认环境变量 | 最小调用形态 |
| --- | --- | --- | --- |
| `brave-search` | Brave Search | `BRAVE_SEARCH_API_KEY` | GET、Header Key、Query 参数 |
| `tavily-search` | Tavily Search | `TAVILY_API_KEY` | POST、Bearer、JSON Body |
| `exa-search` | Exa Search | `EXA_API_KEY` | POST、Header Key、JSON Body |
| `firecrawl-search` | Firecrawl Search | `FIRECRAWL_API_KEY` | POST、Bearer、JSON Body |
| `serper-google-search` | Serper Google Search | `SERPER_API_KEY` | POST、Header Key、JSON Body |
| `x-api-search-posts` | X API Search Posts | `X_API_BEARER_TOKEN` | GET、Bearer、Query 参数 |

每个模板 MUST 包含当前官方文档地址、端点、认证放置方式、最小额度探测、适用场景和直接调用示例，但 MUST NOT 包含真实密钥。

模板 MUST 通过 CLI 显式实例化为用户级 API 配置后才参与查询和健康检查。模板本身不是运行时配置；模板更新 MUST NOT 静默修改已经实例化的用户配置。

模板只收录 Agent 可直接调用并获得机器可读结果的独立搜索 API。模型服务端搜索工具不得作为内置模板提供；X 帖子搜索必须使用 X API v2 `GET /2/tweets/search/recent`，而非 xAI 模型工具。`serpapi-google` 不属于当前内置目录。

X API 模板的最小探测 MUST 使用 `max_results: 10`、最少字段并验证响应 `meta` 存在；其调用说明 MUST 提示 recent search 只覆盖最近 7 天且按返回帖子消耗 read credits。Firecrawl 调用说明 MUST 区分普通搜索与可选内容提取。Brave 保留为独立索引选项，但调用说明 MUST 建议 Agent 先检查本机健康快照。

探测器和配置 Schema MUST 至少支持这六个模板所需的 GET、POST、Header、Bearer、Query、JSON Body 和响应字段校验能力。自动化测试使用本地请求替身，不要求仓库或 CI 持有六家真实凭据。

### Requirement 3：实现 Agent 查询 CLI

0.1 MUST 提供以下查询能力：

- 列出能力组；
- 查询单个能力组和组内 API；
- 可选地在组查询中请求健康状态；
- 查询单个 API 的凭据引用、调用说明和最近健康状态；
- 按能力组列出可安装的内置模板；
- 对所有查询提供 `--json` 输出。

JSON 输出 MUST 包含顶层 Schema 版本。未知 ID、无效配置和不可用凭据必须返回非零退出码和结构化错误。

### Requirement 4：实现凭据引用解析

0.1 MUST 支持环境变量凭据，并记录：

- 环境变量名；
- 人可读的配置位置；
- Header、Query 或调用示例所需的注入说明。

AgentPulse MUST 能判断当前执行环境是否存在该变量，但 MUST NOT 在标准输出、JSON、Web 或日志中返回其真实值。

0.1 不负责安全保存、轮换或隔离真实密钥。

### Requirement 5：实现按组健康检查和 TTL

带健康参数查询能力组时，0.1 MUST 对所有已启用 API 执行其最小探测，并实现：

- 默认一小时 TTL；
- TTL 内复用缓存；
- 配置改变后使相关缓存失效；
- 同组探测可并行且互不阻断；
- 状态映射为 `healthy`、`unhealthy`、`misconfigured`、`disabled` 或 `unknown`；
- 返回 `checkedAt`、`expiresAt`、可选延迟和脱敏错误摘要。

健康缓存 MUST 存在用户级状态目录，并可安全删除重建。

### Requirement 6：实现只读 Web 页面

0.1 MUST 提供一个本地 Web 页面，并展示：

- 能力组概览；
- API 配置完整性；
- API 详情、凭据变量名和配置位置；
- 调用说明；
- 最近健康状态及是否过期。

Web MUST 默认只监听回环地址。页面 MUST 不包含配置写操作，也 MUST 不因加载或刷新而执行健康检查。

Web 的内部数据路由不属于正式产品 API，0.1 MUST NOT 发布或承诺 REST API 契约。

### Requirement 7：提供 Agent 引导文本

0.1 MUST 提供可复制的 Agent 上下文片段，至少说明：

- AgentPulse 已安装；
- 外部 API 使用前应先查询相关能力组；
- 如何取得 JSON 输出和单个 API 用法；
- AgentPulse 不替 Agent 选择 API。

### Requirement 8：保持单一事实来源

0.1 MUST 遵循以下归属：

- 运行时 API 与能力组事实只来自用户配置；
- 内置模板只提供实例化输入，不能成为第二份运行时配置；
- 健康事实只来自健康缓存；
- 配置字段只由机器可读 Schema 定义；
- CLI 与 Web 使用同一共享核心；
- README 不复制产品需求和架构正文。

## 3. 非目标

0.1 不包括：

- API 请求代理或密钥注入代理；
- 正式 HTTP API 或 MCP Server；
- Web 配置后台；
- API 自动选择、排序、降级或推荐；
- 真实业务调用上报、历史成功率和监控图表；
- 密钥申请、轮换、加密存储或 Agent 隔离；
- 多用户、远程访问、云同步或账号系统；
- 项目级配置覆盖；
- 配置删除和迁移兼容层。

## 4. 验收标准

0.1 完成时：

1. Agent 可以列出 `search` 组的六个内置模板，并将任意模板实例化为用户配置。
2. Exa、Firecrawl、Tavily、X API Search Posts、Serper 和 Brave 模板分别生成符合官方当前调用方式的请求。
3. 未提供真实凭据时，六个实例能安全显示为 `misconfigured`；提供有效凭据后能执行对应最小探测。
4. 配置文件能由 Schema 校验，错误能指向具体字段。
5. Agent 可以用 JSON 查询能力组、API 用法和凭据引用。
6. 首次带健康查询会执行所有已启用 API 的最小探测，一小时内再次查询不会重复探测。
7. 修改 API 配置后，对应健康缓存立即失效。
8. 缺少凭据、认证失败和第三方超时能被区分并脱敏返回。
9. Web 可以展示配置和已有缓存，但不能修改配置或触发探测。
10. CLI 在没有 Web 或常驻服务运行时仍可工作。
11. 自动化检查覆盖六个模板、配置校验、TTL、缓存失效、状态映射和 Web 只读边界。
12. README、长期文档和本 Spec 之间不存在竞争性的事实定义。

## 5. 关闭条件

本 Spec 在实现、自动化验证、文档同步和至少一轮用户提供凭据的真实健康检查全部完成后才能标记为 `Closed`。技术栈已经记录在 [`design.md`](design.md)，不能只存在于代码或对话中。
