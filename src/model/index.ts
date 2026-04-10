import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getEnvConfig } from "../config/envConfig.js";

/** 未设置 `DASHSCOPE_MODEL` 时的默认：速度优先（意图分类等场景） */
const DEFAULT_DASHSCOPE_MODEL = "qwen3.5-plus";

/** 未配置任何 TEMPERATURE 相关 env 时的采样温度（与常见「确定性」配置一致） */
const DEFAULT_LLM_TEMPERATURE = 0;

function dashscopeTemperature(env: ReturnType<typeof getEnvConfig>): number {
  return env.dashscopeTemperature ?? DEFAULT_LLM_TEMPERATURE;
}

export function getModel(): BaseChatModel {
  const env = getEnvConfig();
  if (env.dashscopeApiKey?.trim()) {
    const model = env.dashscopeModel ?? DEFAULT_DASHSCOPE_MODEL;
    const temperature = dashscopeTemperature(env);
    const llm = new ChatOpenAI({
      model,
      apiKey: env.dashscopeApiKey,
      temperature,
      configuration: { baseURL: env.dashscopeApiBase },
      /** 见阿里云「深度思考 / thinking」文档；非混合模型可能忽略该字段 */
      modelKwargs: { enable_thinking: env.dashscopeEnableThinking, response_format: env.dashscopeJsonMode ? { type: "json_object" } : undefined, temperature: env.dashscopeTemperature }
    } as object);
    return llm as unknown as BaseChatModel;
  }

  throw new Error(
    "未配置可用模型：请设置 DASHSCOPE_API_KEY 或 OPENAI_API_KEY"
  );
}


export function getModelNoThinking(jsonMode = false): BaseChatModel {
   const env = getEnvConfig();
   if (env.dashscopeApiKey?.trim()) {
    const model = env.dashscopeModel ?? DEFAULT_DASHSCOPE_MODEL;
    const temperature = 0;
    const llm = new ChatOpenAI({
      model,
      apiKey: env.dashscopeApiKey,
      temperature,
      configuration: { baseURL: env.dashscopeApiBase },
      /** 见阿里云「深度思考 / thinking」文档；非混合模型可能忽略该字段 */
      modelKwargs: { enable_thinking: false, response_format: jsonMode ? { type: "json_object" } : undefined, temperature: 0 }
    
    } as object);
    return llm as unknown as BaseChatModel;
  }
  throw new Error(
    "未配置可用模型：请设置 DASHSCOPE_API_KEY 或 OPENAI_API_KEY"
  );
}
