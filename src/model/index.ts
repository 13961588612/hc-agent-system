import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getEnvConfig, type EnvConfig } from "../config/envConfig.js";

/** 未设置 `DASHSCOPE_MODEL` 时的默认：速度优先（意图分类等场景） */
const DEFAULT_DASHSCOPE_MODEL = "qwen-turbo";

/**
 * 根据 env 配置获取 ChatModel
 * 优先使用 DashScope (Qwen)，否则使用 OpenAI
 */
export function getModel(): BaseChatModel {
  const env = getEnvConfig();
  if (env.dashscopeApiKey?.trim()) {
    const model = env.dashscopeModel ?? DEFAULT_DASHSCOPE_MODEL;
    const llm = new ChatOpenAI(model, {
      apiKey: env.dashscopeApiKey,
      configuration: { baseURL: env.dashscopeApiBase }
    } as object);
    return llm as unknown as BaseChatModel;
  }

  throw new Error(
    "未配置可用模型：请设置 DASHSCOPE_API_KEY 或 OPENAI_API_KEY"
  );
}
