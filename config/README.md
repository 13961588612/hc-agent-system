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
| `DB_*` | 各连接在 YAML 中通过 `${DB_xxx}` 引用 |

## 代码入口

- 加载与注册：`src/config/loadDatabasesConfig.ts`、`src/config/createDbClientManagerFromConfig.ts`
- 全局访问：`src/config/dbAppContext.ts`（`getDbClientManager`）
