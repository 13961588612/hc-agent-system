# 部署配置目录（`config/`）

用于存放**随部署环境变化**的配置文件（建议挂载卷或 CI 下发）。**不要**把含密码的未脱敏文件提交到 Git。

## 数据库多连接

- 模板：[`databases.example.yaml`](databases.example.yaml) → 复制为 `databases.yaml` 并按环境填写。
- 已忽略的本地文件见仓库根目录 `.gitignore`。
- 连接串中的 **`${ENV_VAR}`** 在加载时从进程环境变量替换；密码请放在 `.env` / 密钥系统，不要写进 YAML 明文。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DATABASES_CONFIG` | 可选。`databases.yaml` 的绝对或相对路径；未设置时默认 `<cwd>/config/databases.yaml` |
| `CHANNELS_CONFIG` | 可选。`channels.yaml` 的绝对或相对路径；未设置时默认 `<cwd>/config/channels.yaml`（企业微信 `wecom.transport` 等） |
| `DB_*` | 各连接在 YAML 中通过 `${DB_xxx}` 引用 |
| `ORACLE_CLIENT_LIB_DIR` | **可选**。指向本机 [Oracle Instant Client](https://www.oracle.com/database/technologies/instant-client/downloads.html) 解压目录，启用 node-oracledb **Thick** 模式。**连接 Oracle 11g 时必须设置**（或配合 `ORACLE_USE_THICK`），否则 Thin 模式会报 `NJS-138`。 |
| `ORACLE_USE_THICK` | **可选**。设为 `1` 或 `true` 时调用无参 `initOracleClient()`，适用于已在系统路径 / `LD_LIBRARY_PATH` 中配置好 Instant Client 的 Linux 等环境。 |
| `MAX_CLARIFICATION_ROUNDS` | **可选**。默认 `3`；同一 `thread_id` 内 assistant 可发出的「追问」条数上限，超出则回复固定提示。 |
| `CLARIFICATION_IDLE_MS` | **可选**。默认 `1800000`（30 分钟）；距上次追问超过该毫秒后用户再发消息，重置追问计数。 |
| `INTENT_LLM_TIMEOUT_MS` | **可选**。默认 `45000`；意图分类 LLM 单次调用超时（毫秒），超时走关键词兜底。 |
| `SYSTEM_CONFIG` | **可选**。`system.yaml` 的绝对或相对路径；未设置时默认 `<cwd>/config/system.yaml`。文件不存在、解析失败或 domains/segments 均为空时，运行时使用**空壳配置**（无内置业务域/分段；请部署时提供有效 `system.yaml`）。 |

## 系统域与分段（`system.yaml`）

用于**集中声明**系统中的 **domain**（域）与 **segment**（分段），并通过 **`facets`** 标记每条目录属于哪些**分类维度**（可多选）：

| facet | 用途 |
|-------|------|
| `business` | 意图识别、任务划分、业务向路由 |
| `skill` | Skills 渐进式披露、按 domain+segment 检索与过滤 |
| `other` | 预留（如运维/安全标签），可不参与前两者 |

- 模板：[`system.example.yaml`](system.example.yaml) → 复制为 `config/system.yaml`（本地覆盖，已忽略提交）。
- 加载：`src/config/systemConfig.ts`（`loadSystemConfigFromFile`、`getSystemConfig`、`listDomainIdsByFacet` / `listSegmentIdsByFacet`）。
- 启动：`src/bootstrap/initCore.ts` 在数据库初始化之前加载并打日志。

## 渠道（企业微信等）

- 说明与变量表：[`docs/channel-wecom.md`](../docs/channel-wecom.md)
- 示例：`channels.example.yaml` → 可选复制为 `channels.yaml`（本地覆盖，已忽略提交）；`wecom.http` / `wecom.longConnection` 中字符串支持 **`${ENV_VAR}`**（与数据库配置相同，见 `src/config/envSubstitute.ts`）
- 入口：`CHANNEL_MODE=wecom`（默认长连接，`@wecom/aibot-node-sdk`）或 `wecom-http`（HTTP 回调）；见 `src/index.ts`

## 代码入口

- 加载与注册：`src/config/databasesConfig.ts`、`src/config/channelsConfig.ts`、`src/config/createDbClientManagerFromConfig.ts`
- 全局访问：`src/config/dbAppContext.ts`（`getDbClientManager`）
- 系统域配置：`src/config/systemConfig.ts`（`getSystemConfig`）
- 公共初始化：`src/bootstrap/initCore.ts`（系统配置 + 数据库 + Guides，CLI 与渠道共用）
