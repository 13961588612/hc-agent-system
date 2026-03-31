/** 企业微信 access_token 缓存（约 7200s，提前刷新） */
let cached: { token: string; expiresAt: number } | null = null;

export async function getWeComAccessToken(corpId: string, corpSecret: string): Promise<string> {
  const now = Date.now();
  if (cached && now < cached.expiresAt - 1800_000) {
    return cached.token;
  }
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`;
  const res = await fetch(url);
  const data = (await res.json()) as {
    errcode: number;
    access_token?: string;
    expires_in?: number;
    errmsg?: string;
  };
  if (data.errcode !== 0 || !data.access_token) {
    throw new Error(`[WeCom] gettoken 失败: ${data.errmsg ?? ""} (${data.errcode})`);
  }
  const expiresIn = (data.expires_in ?? 7200) * 1000;
  cached = { token: data.access_token, expiresAt: now + expiresIn };
  return data.access_token;
}

export function clearWeComAccessTokenCache(): void {
  cached = null;
}
