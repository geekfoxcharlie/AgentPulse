# AgentPulse 0.1 MVP Design

Spec version: 0.1  
Status: Ready for local configuration

## 1. 设计原则

- CLI 优先：所有 Agent 功能在没有 Web 服务时可用。
- 一个核心：CLI 与 Web 不重复业务规则。
- 声明式配置：运行时事实可以检查、校验和迁移。
- 只存引用：真实密钥不进入 API 配置和健康缓存。
- 按需探测：没有健康查询就不产生第三方请求。
- 当前快照：0.1 不为尚不存在的旧格式设计兼容层。
- 技术克制：不为内部 Web 页面额外建立正式 REST API。

## 2. 实际技术选择

- 语言与运行时：Node.js 22+、TypeScript 5.9，采用 NodeNext ESM 编译。
- CLI：无第三方命令框架的薄参数解析层，`dist/cli.js` 作为 `agentpulse` 二进制入口。
- Web：Node 内置 `http` 服务与服务端生成 HTML/CSS；只监听 `127.0.0.1`，没有公开 REST API。
- 配置：YAML；`yaml` 负责解析，`ajv` 使用根目录 JSON Schema 验证形状，共享核心补充交叉引用和 URL 等语义验证。
- 缓存：用户级 `health-cache.json`，原子写入，可直接删除重建。
- 测试：Node 内置 `node:test`，用本地 `Response` 替身验证第三方请求契约；不消耗真实 API 额度。

选择满足一次本地安装同时提供 CLI 和 Web，CLI 不依赖常驻服务，且两者复用核心。没有数据库服务、Web 框架或正式 HTTP API。

## 3. 目标模块

具体目录名可以随技术栈调整，但实现必须保持以下逻辑模块：

```text
src/
  cli.ts                 CLI 入口和命令解析
  lib/
    config.ts            YAML 加载、Schema/语义校验和原子写入
    templates.ts         内置模板加载与实例化
    health.ts            探测执行、状态映射、TTL 与 single-flight
    state.ts             健康缓存读写
    query.ts             CLI/Web 共用查询模型
  web/server.ts          回环只读 HTML 页面
  test/                  核心、CLI 与 Web 自动化检查
schemas/                 group、api 和 CLI JSON Schema
templates/               search 组和六个非密钥独立搜索 API 模板
guides/                  可注入 Agent 的发现提示
```

依赖方向必须是：

```text
CLI ──> Core <── Web
          │
          ├──> User configuration
          └──> Health state
```

Web 不能成为 CLI 的依赖，CLI 也不能通过 Web 的内部 HTTP 路由访问核心。

## 4. 配置设计

### 4.1 能力组配置

能力组 Schema 的概念字段：

```yaml
schemaVersion: 1
id: search
name: 搜索
description: 网页和资料搜索接口
order: 10
```

`id` 必须稳定、唯一并适合作为 CLI 参数。显示顺序只用于查询和 Web 展示，不表示推荐优先级。

### 4.2 API 配置

API Schema 的概念字段：

```yaml
schemaVersion: 1
kind: api
id: brave-search
name: Brave Search
group: search
description: 通用网页搜索
enabled: true

service:
  baseUrl: https://api.search.brave.com
  docsUrl: https://api.search.brave.com/app/documentation

credential:
  type: environment
  name: BRAVE_SEARCH_API_KEY
  configuredAt: ~/.zshenv
  placement:
    type: header
    name: X-Subscription-Token

probe:
  method: GET
  url: https://api.search.brave.com/res/v1/web/search
  query:
    q: test
    count: 1
  expectedStatus: [200]
  assertions:
    - path: query
      exists: true
  timeoutMs: 10000

usage:
  notes: 适合通用网页搜索
  example: |
    curl -H "X-Subscription-Token: $BRAVE_SEARCH_API_KEY" \
      "https://api.search.brave.com/res/v1/web/search?q=test&count=5"
```

精确字段由 [`schemas/api.schema.json`](../../../schemas/api.schema.json) 定义；本节只解释设计意图。`group` 和 CLI JSON 也分别由对应的 JSON Schema 约束。

### 4.3 内置模板与实例化

0.1 随程序发布以下六个独立搜索 API 模板：

| 模板 | 官方端点 | 方法 | 认证 | 最小请求 |
| --- | --- | --- | --- | --- |
| `brave-search` | `https://api.search.brave.com/res/v1/web/search` | GET | `X-Subscription-Token` Header | `q=OpenAI&count=1` |
| `tavily-search` | `https://api.tavily.com/search` | POST | `Authorization: Bearer` | `{"query":"OpenAI","search_depth":"basic","max_results":1,"include_answer":false,"include_raw_content":false}` |
| `exa-search` | `https://api.exa.ai/search` | POST | `x-api-key` Header | `{"query":"OpenAI","type":"instant","numResults":1}` |
| `firecrawl-search` | `https://api.firecrawl.dev/v2/search` | POST | `Authorization: Bearer` | `{"query":"OpenAI","limit":1}` |
| `serper-google-search` | `https://google.serper.dev/search` | POST | `X-API-KEY` Header | `{"q":"OpenAI","num":1}` |
| `x-api-search-posts` | `https://api.x.com/2/tweets/search/recent` | GET | `Authorization: Bearer` | `query=OpenAI -is:retweet&max_results=10&tweet.fields=created_at` |

模板必须链接各自官方文档：

- Brave Search：<https://api-dashboard.search.brave.com/api-reference/web/search/get>
- Tavily Search：<https://docs.tavily.com/documentation/api-reference/endpoint/search>
- Exa Search：<https://exa.ai/docs/reference/search>
- Firecrawl Search：<https://docs.firecrawl.dev/features/search>
- Serper Google Search：<https://serper.dev>
- X API Search Posts：<https://docs.x.com/x-api/posts/search/introduction>

模板只收录独立数据 API，不收录 xAI 等模型服务端搜索工具。X API 的 recent search 按返回帖子消耗 read credits，且最小 `max_results` 为 10；健康探测保持一个短查询、最少字段并只校验 `meta`。Firecrawl 普通搜索与页面提取使用同一端点，但调用示例默认不启用 `scrapeOptions`，防止无意增加消耗。Brave 的调用说明要求先检查本机健康快照。

模板只包含公开的供应商事实和 AgentPulse 默认环境变量名。实例化命令接收本机已发现的环境设置位置和可选变量名覆盖，生成一份完整用户配置。该位置只是元信息：AgentPulse 不会 source、读取或写入它。运行时注册表不回读模板，也不把模板与实例动态合并。

这样的边界保证：

- 尚未实例化的模板不会出现在已配置 API 清单中；
- 用户配置是运行时唯一事实来源；
- 上游模板变化不会导致未审阅的运行时变化；
- Agent 可以比较模板与现有配置后显式更新。

### 4.4 写入策略

- 能力组和每个 API 使用独立声明，减少 Agent 修改时的冲突范围。
- CLI 先在内存中合并并校验完整注册表，再写临时文件并原子替换目标。
- API ID 和文件身份必须一致或由 CLI 唯一决定，不能出现两个可生效副本。
- 更新影响探测、凭据或启用状态的字段时，删除对应缓存条目。
- 0.1 不保留旧 Schema 的兼容读取器。

## 5. CLI 设计

计划命令面：

```text
agentpulse groups [--json]
agentpulse group <group-id> [--health] [--json]
agentpulse api <api-id> [--json]
agentpulse templates [--group <group-id>] [--json]
agentpulse context [--json]

agentpulse group add --file <path>
agentpulse group update <group-id> --file <path>
agentpulse api add --file <path>
agentpulse api add --template <template-id> --configured-at ~/.zshenv [--credential-env <name>]
agentpulse api update <api-id> --file <path>
agentpulse api enable <api-id>
agentpulse api disable <api-id>
agentpulse validate [--json]

agentpulse web [--port <port>]
```

配置命令必须适合 Agent 非交互执行。命令参数不得要求传入真实密钥值。

查询 JSON 的顶层结构统一包含：

```json
{
  "schemaVersion": 1,
  "command": "group",
  "generatedAt": "ISO-8601 timestamp",
  "data": {},
  "errors": []
}
```

最终字段由 CLI 输出 Schema 定义。错误同时通过非零退出码和 `errors` 表达。

模板查询必须明确区分 `template` 与 `configuredApi`，避免 Agent 把可安装模板误认为已经配置好的接口。

## 6. 健康检查设计

### 6.1 缓存规则

- 默认 TTL：60 分钟。
- 缓存粒度：每个 API 一条结果，组查询聚合返回。
- 命中条件：结果未过期，且 API 探测相关配置指纹未改变。
- 失效条件：过期、配置指纹改变、API 启停变化或缓存损坏。
- 禁用 API 不执行探测，查询时返回 `disabled`。

按 API 缓存允许同一 API 未来出现在其他只读视图中时复用状态，同时组查询仍必须一次返回完整快照。

### 6.2 执行规则

1. 加载并校验能力组及组内 API。
2. 将缺少凭据的 API 标记为 `misconfigured`，不发送请求。
3. 对缓存未命中的已启用 API 并行探测，并设置每项超时。
4. 单项捕获网络、认证、限流、服务端和响应校验错误。
5. 清理错误中的 Header、Query 和环境变量值。
6. 原子更新缓存并返回所有项目状态。

通用请求描述必须能够表达首批六个模板需要的 Query 参数、JSON Body、静态 Header、环境变量替换以及 Header/Query 两种凭据注入位置。探测响应至少支持 HTTP 状态和 JSON 字段存在性校验，不能为供应商编写绕过通用模型的独立硬编码探测器。

并发查询同一 API 时使用进程内 single-flight 合并同一轮探测。跨进程探测去重不是 0.1 的承诺。

### 6.3 状态映射

| 状态 | 条件 |
| --- | --- |
| `healthy` | 响应满足探测成功条件 |
| `unhealthy` | 请求超时、网络失败、认证失败、限流或响应不满足条件 |
| `misconfigured` | 配置无效或凭据引用不可用 |
| `disabled` | API 被人工停用 |
| `unknown` | 尚无结果且本次未要求探测 |

可附带错误类别，但不能引入真实成功率或推荐分数。

## 7. Web 设计

Web 是共享核心上的只读投影：

- 首页展示能力组、API 数量和健康状态摘要；
- 能力组页展示组说明、API 列表和缓存时间；
- API 详情展示服务信息、凭据引用、调用说明和最近状态；
- 配置问题必须可见；
- 所有配置操作在页面中都不存在，而不是仅以禁用按钮隐藏。

Web 启动进程只监听 `127.0.0.1`。页面数据可以由服务端渲染或内部只读路由提供，但这些路由不写正式 API 文档，也不保证供外部 Agent 使用。

读取 Web 页面不能调用健康探测逻辑。页面只呈现已有缓存，并明确标识 `unknown` 或已过期状态。

## 8. Agent 引导设计

0.1 应生成或提供一个短文本文件，内容只包括：

```text
本机安装了 AgentPulse。使用外部 API 前，先通过 AgentPulse CLI 查询相关能力组；
需要机器可读结果时使用 JSON 输出。AgentPulse 提供已配置接口及健康信息，最终选择由你决定。
```

最终文本必须包含实际实现的查询命令，但不复制 API 清单或密钥信息。

## 9. 验证策略

自动化验证聚焦边界：

- Schema 接受有效配置并拒绝字段、ID、引用错误；
- CLI 人类输出与 JSON 输出来自相同查询模型；
- JSON Schema 版本存在且错误退出码正确；
- TTL 命中不重复请求，过期后重新请求；
- 配置更新使相关缓存失效；
- 六个搜索模板能够产生符合各自请求契约的脱敏请求；
- 模板实例化后不再依赖模板文件，模板更新不静默改变用户配置；
- 同组单项失败不阻断其他项；
- 所有错误和输出不包含测试密钥；
- Web 页面不含写操作，页面读取不调用探测器；
- CLI 在 Web 未启动时完成全部查询和探测。

第三方 API 测试使用本地可控的测试服务或请求替身；自动化测试不消耗真实 API 配额。

## 10. 明确拒绝的设计

- Agent 通过 Web 内部路由查询：会把实现细节变成隐式 API。
- CLI 依赖常驻 Web 服务：降低本地工具可靠性。
- Web 和 CLI 各自读取配置：容易形成两套规则。
- 把密钥复制到 API 配置：违反凭据引用边界。
- 页面加载自动刷新健康状态：浏览行为会意外消耗第三方额度。
- 第一版引入代理：改变 Agent 直接调用的产品边界。
- 为未来旧版本保留兼容层：当前没有需要兼容的已发布格式。
