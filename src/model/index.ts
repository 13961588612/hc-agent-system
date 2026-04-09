import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getEnvConfig } from "../config/envConfig.js";

/** 未设置 `DASHSCOPE_MODEL` 时的默认：速度优先（意图分类等场景） */
const DEFAULT_DASHSCOPE_MODEL = "qwen-turbo";

/**
 * 阿里云 OpenAI 兼容接口下，混合推理模型用 `enable_thinking` 开关「深度思考」。
 * 默认关闭（省延迟与费用）；设为 `1`/`true` 时打开。
 * 名称含 `-thinking` 等「仅推理」模型无法关闭思考，需换模型。
 */
function dashScopeEnableThinkingFromEnv(): boolean {
  const v = process.env.DASHSCOPE_ENABLE_THINKING?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * 根据 env 配置获取 ChatModel
 * 优先使用 DashScope (Qwen)，否则使用 OpenAI
 */
export function getModel(thinkMode = false, jsonMode = false): BaseChatModel {
  const env = getEnvConfig();
  if (env.dashscopeApiKey?.trim()) {
    const model = env.dashscopeModel ?? DEFAULT_DASHSCOPE_MODEL;
    const llm = new ChatOpenAI({
      model,
      apiKey: env.dashscopeApiKey,
      configuration: { baseURL: env.dashscopeApiBase },
      /** 见阿里云「深度思考 / thinking」文档；非混合模型可能忽略该字段 */
      modelKwargs: {
        enable_thinking: thinkMode,
        response_format: jsonMode ? { type: "json_object" } : undefined
      }
    } as object);
    return llm as unknown as BaseChatModel;
  }

  throw new Error(
    "未配置可用模型：请设置 DASHSCOPE_API_KEY 或 OPENAI_API_KEY"
  );
}

export function getModelWithThinking(): BaseChatModel {
  const env = getEnvConfig();
  if (env.dashscopeApiKey?.trim()) {
    const model = env.dashscopeModel ?? DEFAULT_DASHSCOPE_MODEL;
    const llm = new ChatOpenAI({
      model,
      apiKey: env.dashscopeApiKey,
      configuration: { baseURL: env.dashscopeApiBase },
      /** 见阿里云「深度思考 / thinking」文档；非混合模型可能忽略该字段 */
      modelKwargs: {
        enable_thinking: true
      }
    } as object);
    return llm as unknown as BaseChatModel;
  }

  throw new Error(
    "未配置可用模型：请设置 DASHSCOPE_API_KEY 或 OPENAI_API_KEY"
  );
}
