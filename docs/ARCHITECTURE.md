# AgentPulse 系统架构

本文是 AgentPulse 当前系统边界、组件职责和数据归属的单一事实来源。产品目标与长期功能需求由[产品需求](REQUIREMENTS.md)定义。

## 1. 系统边界

AgentPulse 由共享核心、CLI 和只读 Web 页面组成：

```text
                   ┌─ CLI：Agent 查询、配置、健康检查
配置与状态 ──> 共享核心 ┤
                   └─ Web：用户只读查看

Agent ──直接调用──> 第三方 API
```

CLI 是 Agent 的正式产品接口。Web 页面可以通过本机 HTTP 服务加载，但内部页面路由或数据请求不是对外承诺的正式 HTTP API。

AgentPulse 不位于 Agent 与第三方 API 之间，不观察、转发或修改真实业务请求。

## 2. 逻辑组件

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| 内置模板 | 提供常见 API 的非密钥初始定义 | 作为已启用的用户配置或自动取得密钥 |
| 配置存储 | 能力组、API、凭据引用、调用说明、探测定义 | 保存真实密钥值 |
| 共享核心 | 加载与校验配置、生成查询视图、执行探测、管理缓存 | 选择 API 或转发业务请求 |
| CLI | Agent 查询、配置变更、显式健康检查、JSON 输出 | 交互式 Web 管理 |
| 只读 Web | 展示配置、用法和已有健康缓存 | 修改配置或因页面刷新触发探测 |
| 健康缓存 | 保存最近一次最小测试结果和 TTL | 保存真实业务调用历史或成功率 |

CLI 与 Web MUST 调用同一套共享核心逻辑，不能各自实现配置解析、状态映射或凭据规则。

## 3. 数据归属

| 数据关注点 | 单一事实来源 |
| --- | --- |
| 可安装的常见 API 初始定义 | 随 AgentPulse 发布的内置模板 |
| 能力组 ID、名称、说明和展示顺序 | 用户级能力组配置 |
| API 身份、端点、认证引用、用法和探测定义 | 用户级 API 配置 |
| 真实密钥值 | 配置记录所指向的本机环境或文件；不属于 AgentPulse API 配置 |
| 最近健康结果和过期时间 | 用户级运行状态目录中的健康缓存 |
| 可注入 Agent 的发现提示 | `guides/agent-context.md` |
| 长期产品目标与范围 | `docs/REQUIREMENTS.md` |
| 当前系统边界和数据流 | `docs/ARCHITECTURE.md` |
| 单次迭代范围、设计与任务 | 对应 `.kiro/specs/<version>-<name>/` |
| CLI 精确语法 | 可执行程序的 `--help`；实现前由当前 Spec 定义 |
| 配置精确字段约束 | `schemas/group.schema.json`、`schemas/api.schema.json` 与 `schemas/cli.schema.json` |
| CLI JSON 信封精确字段 | `schemas/cli-output.schema.json` |

Web、CLI 展示文本和 README 都是这些来源的消费者，不能成为第二份配置或需求事实。

## 4. 用户级目录

AgentPulse 的业务配置跨 Agent、跨工具和跨项目共享，因此运行数据属于当前操作系统用户，而不属于某个项目仓库。

实现采用以下用户级目录，并支持 `AGENTPULSE_CONFIG_DIR`、`AGENTPULSE_STATE_DIR` 及 XDG 目录覆盖：

```text
~/.config/agentpulse/
├── groups/*.yaml          # 能力组配置
├── apis/*.yaml            # 每个 HTTP API 的声明式配置
└── clis/*.yaml            # 每个本地 CLI 能力的声明式配置

~/.local/state/agentpulse/
└── health-cache.json      # 可丢弃并重新生成的健康状态
```

真实值由操作系统、Shell 或其他本机环境配置提供。当前默认位置为 `~/.zshenv`；`configuredAt` 仍可记录其他实际配置位置，便于后续排查。它不是 AgentPulse 会读取、source 或写入的文件路径。健康检查只读取当前 `agentpulse` 进程已经获得的环境变量。

配置与 CLI JSON 的精确字段分别由根目录下的 JSON Schema 定义；共享核心通过这些 Schema 校验 YAML。缓存是内部可再生状态，不是公开数据契约。

## 5. 配置模型

### 5.1 能力组

能力组是供 Agent 发现 API 的稳定分类，至少包含：

- 唯一 ID；
- 面向人的名称；
- 用途说明；
- 可选展示顺序。

API 必须引用一个已存在的能力组。能力组不定义推荐顺序或故障转移规则。

### 5.2 API 条目

API 条目由以下概念组成：

- 身份：ID、名称、描述、启用状态；
- 分类：能力组 ID；
- 服务信息：基础地址、文档地址；
- 凭据引用：环境变量名、配置位置、注入方式；
- 附加环境需求：变量名、配置位置和用途（例如账户 ID）；
- 用法：适用场景、限制、可执行示例；
- 探测：最小请求及成功条件。

API 配置只保存引用和说明，不保存凭据值。精确字段由 [`schemas/api.schema.json`](../schemas/api.schema.json) 定义。

### 5.2.1 CLI 能力条目

CLI 能力条目描述一台机器上已安装的命令行工具，由以下概念组成：

- 身份：ID、名称、描述、启用状态；
- 分类：能力组 ID；
- 命令：不含空白的可执行命令，经 `PATH` 或绝对路径解析；
- 出处：安装方式与安装命令（本机元信息，等价于 API 的 `configuredAt`）；
- 文档地址；
- 用法：适用场景、限制、可执行示例；
- 探测：子命令参数、期望退出码和超时时间。

CLI 能力不声明 HTTP 服务、凭据或环境变量需求。精确字段由 [`schemas/cli.schema.json`](../schemas/cli.schema.json) 定义。健康探测直接运行该命令（不经过 shell），命令不存在映射为 `misconfigured`，其余失败映射为 `unhealthy`。

### 5.3 内置模板

AgentPulse 可以随程序发布常见 API 的内置模板，以减少 Agent 重复填写公开且稳定的端点、认证方式、用法和最小探测定义。

模板不是已配置 API，也不参与查询或健康检查。Agent 选择模板并补充环境变量名、配置位置等本机信息后，CLI 必须把完整结果实例化为用户级 API 配置；从此运行时只读取该用户配置。该位置仅为元信息，CLI 不会 source 或修改它。

因此，模板更新不能静默改变已有用户配置。需要同步上游变化时，必须由 Agent 发起显式更新并经过正常校验和缓存失效流程。

内置 `search` 目录只收录可由 Agent 直接调用并返回机器可读结果的独立搜索 API。模型内建的服务端搜索工具不属于该目录；X 帖子搜索使用 X API 的直接端点。`image-generation` 目录提供通过 Cloudflare AI Gateway 调用的 GPT Image 2 模板。`browser` 目录提供本地 CLI 能力模板（如 `browser-harness`）。当前人工筛选的模板名称属于[产品需求](REQUIREMENTS.md#r11内置独立搜索目录)和 [R1.2](REQUIREMENTS.md#r12cloudflare-ai-gateway-图像生成目录)，而精确端点、凭据引用和最小探测属于各模板 YAML 的唯一事实来源。图像模板的健康探测必须采用非生成性端点，避免状态检查产生推理费用；CLI 模板的健康探测必须是被动检查。当前模板目录的增量与验收条件分别由 [0.1 MVP Spec](../.kiro/specs/0.1-mvp/requirements.md)、[Cloudflare image-generation Spec](../.kiro/specs/0.2-cloudflare-image-generation/requirements.md) 和 [CLI Capabilities Spec](../.kiro/specs/0.3-cli-capabilities/requirements.md) 维护。

## 6. Agent 查询流程

```text
Agent 需要外部能力
  -> 读取注入上下文中的 AgentPulse 提示
  -> 通过 CLI 查询能力组
  -> 可选：要求返回该组健康状态
  -> 查询候选 API 的完整用法
  -> Agent 自行选择
  -> Agent 从已登记的环境变量或位置取得凭据
  -> Agent 直接调用第三方 API
```

CLI 默认输出面向人，JSON 模式面向 Agent。两种输出必须来自同一个内部查询结果，避免语义漂移。

建议的 CLI 能力面如下，精确语法由首个实现 Spec 和最终 `--help` 收敛：

```text
agentpulse groups [--json]
agentpulse group <group-id> [--health] [--json]
agentpulse api <api-id> [--json]
agentpulse cli <cli-id> [--json]
agentpulse templates [--group <group-id>] [--json]
agentpulse group add --file <path>
agentpulse group update <group-id> --file <path>
agentpulse api add --template <template-id> --configured-at ~/.zshenv [--credential-env <name>]
agentpulse api add --file <path>
agentpulse api update <api-id> --file <path>
agentpulse api enable|disable <api-id>
agentpulse cli add --template <template-id>
agentpulse cli add --file <path>
agentpulse cli update <cli-id> --file <path>
agentpulse cli enable|disable <cli-id>
agentpulse validate [--json]
agentpulse context [--json]
agentpulse web [--port <port>]
```

## 7. Agent 配置流程

配置由 Agent 驱动，AgentPulse CLI 负责确定性校验和写入：

```text
用户提出新增或修改需求
  -> Agent 选择内置模板或从头提供 API 定义
  -> Agent 收集本机信息并确认凭据位置
  -> Agent 生成结构化配置
  -> CLI 校验引用、字段和 ID 冲突
  -> CLI 原子写入用户级配置
  -> 相关健康缓存失效
  -> Agent 执行验证和首次健康查询
```

Agent 不应直接写健康缓存或内部数据库。真实密钥由可信 Agent 或用户写入已登记位置，不经过 Web 页面。

## 8. 健康检查流程

按组请求健康状态时：

```text
读取能力组及已启用 API
  -> 查找该组缓存
  -> 未过期：返回缓存
  -> 已过期或不存在：并行执行每个 API 的最小探测
  -> 清理错误中的凭据内容
  -> 原子写入缓存
  -> 返回本次快照
```

默认 TTL 为一小时。缓存键必须能够区分 API 配置版本；配置改变后不能继续返回旧状态。

同一 Node.js 进程内并发查询同一能力组时，核心层通过 single-flight 合并同一轮探测，避免重复消耗额度。一个 API 失败不能阻止同组其他 API 完成探测。

健康检查只回答“该凭据和最小请求在检查时是否工作”，不代表真实业务质量。

## 9. Web 运行方式

Web 页面通过 `agentpulse web` 或未来的本机服务管理方式启动，并默认只监听回环地址。

页面只读取配置和已有健康缓存。它可以展示状态过期，但第一阶段不提供会触发第三方请求的刷新操作，也不提供任何配置写入口。

Web 的内部 HTTP 路由属于实现细节。除非未来 Spec 明确引入正式 HTTP API，否则外部 Agent 不应依赖这些路由。

## 10. 故障与安全边界

- 缺少配置文件：返回可操作的初始化提示。
- API 引用未知能力组：配置校验失败。
- 凭据或声明的环境变量不存在、或登记位置不可用：状态为 `misconfigured`。
- 第三方超时、认证失败或限流：状态为 `unhealthy`，并返回脱敏后的原因。
- 缓存损坏：丢弃并重建，不影响配置事实来源。
- 单个探测失败：保留其他探测结果。

所有本地 Agent 被视为当前用户的可信进程。即使默认不展示密钥，Agent 仍可能通过环境变量或文件读取真实值；这属于明确接受的信任模型。

## 11. 文档归属

文档遵循以下更新规则：

- 根目录只维护 `README.md` 作为入口、状态摘要和链接导航。
- `docs/REQUIREMENTS.md` 维护长期有效的产品需求、信任模型和非目标。
- `docs/ARCHITECTURE.md` 维护当前系统结构、数据流和所有权。
- 每次具体迭代在 `.kiro/specs/<version>-<name>/` 下维护 `requirements.md`、`design.md` 和 `tasks.md`。
- Spec 记录一次迭代的增量和历史，不能成为已完成系统当前行为的唯一说明；迭代完成时必须同步更新受影响的长期文档。
- 同一事实发生变化时更新其拥有者，其他文档只修正引用，不复制新版本。

## 12. 当前仓库目标结构

```text
.
├── README.md
├── package.json
├── schemas/
├── templates/
├── guides/
├── docs/
│   ├── REQUIREMENTS.md
│   └── ARCHITECTURE.md
├── scripts/
├── src/
│   ├── cli.ts
│   ├── lib/
│   ├── web/
│   └── test/
└── .kiro/specs/
    └── 0.1-mvp/
        ├── requirements.md
        ├── design.md
        └── tasks.md
```

根目录不新增其他主文档；`README.md` 保持项目唯一的根目录 Markdown 入口。
