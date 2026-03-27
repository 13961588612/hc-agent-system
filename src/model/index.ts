import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { EnvConfig } from "../config/envConfig.js";

const DEFAULT_DASHSCOPE_MODEL = "qwen3.5-plus";

/**
 * 根据 env 配置获取 ChatModel
 * 优先使用 DashScope (Qwen)，否则使用 OpenAI
 */
export function getModel(env: EnvConfig): BaseChatModel {
  if (env.dashscopeApiKey) {
    const model = env.dashscopeModel ?? DEFAULT_DASHSCOPE_MODEL;
    const llm = new ChatOpenAI(model, {
      apiKey: env.dashscopeApiKey,
      configuration: { baseURL: env.dashscopeApiBase }
    } as object);
    return llm as unknown as BaseChatModel;
  }

  if (process.env.OPENAI_API_KEY) {
    return new ChatOpenAI("gpt-4o-mini") as unknown as BaseChatModel;
  }

  throw new Error(
    "未配置可用模型：请设置 DASHSCOPE_API_KEY 或 OPENAI_API_KEY"
  );
}
