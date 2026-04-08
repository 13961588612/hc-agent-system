import { getEnvConfig } from "../../config/envConfig.js";
import { log } from "../../lib/log/log.js";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-v2";

/** L2 归一化，用于余弦相似度（等价于单位向量点积） */
export function l2Normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (n === 0) return [...v];
  return v.map((x) => x / n);
}

/** 等长向量点积 */
export function dotProduct(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < len; i++) s += a[i]! * b[i]!;
  return s;
}

/**
 * 对 `semanticTaskBrief` 等短文本做嵌入（DashScope OpenAI 兼容 `/embeddings`）。
 * 未配置 `DASHSCOPE_API_KEY` 或请求失败时返回 `null`，不抛错。
 */
export async function fetchTextEmbedding(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const env = getEnvConfig();
  const key = env.dashscopeApiKey?.trim();
  if (!key) return null;

  const base = (
    env.dashscopeApiBase ?? "https://dashscope.aliyuncs.com/compatible-mode/v1"
  ).replace(/\/$/, "");
  const model =
    typeof process.env.DASHSCOPE_EMBEDDING_MODEL === "string" &&
    process.env.DASHSCOPE_EMBEDDING_MODEL.trim()
      ? process.env.DASHSCOPE_EMBEDDING_MODEL.trim()
      : DEFAULT_EMBEDDING_MODEL;

  try {
    const res = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: trimmed.slice(0, 8000)
      })
    });
    if (!res.ok) {
      const errBody = await res.text();
      log(
        "[Intent]",
        "embedding 请求失败",
        `status=${res.status} body=${errBody.slice(0, 300)}`
      );
      return null;
    }
    const j = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const emb = j.data?.[0]?.embedding;
    return Array.isArray(emb) && emb.length > 0 ? emb : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("[Intent]", "embedding 异常", msg);
    return null;
  }
}
