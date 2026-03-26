import { createDecipheriv, createHash } from "node:crypto";

/**
 * 企业微信回调加解密（与文档算法一致）。
 * @see https://developer.work.weixin.qq.com/document/path/90930
 */

function urlSafeBase64ToBuffer(s: string): Buffer {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (b.length % 4)) % 4;
  b += "=".repeat(pad);
  return Buffer.from(b, "base64");
}

function pkcs7Unpad(buf: Buffer): Buffer {
  if (buf.length === 0) return buf;
  const pad = buf[buf.length - 1]!;
  if (pad > 32 || pad < 1) return buf;
  return buf.subarray(0, buf.length - pad);
}

/** 解密后：16 字节随机 + 4 字节网络序长度 + msg + receiveid */
export function parseContentFromDecrypted(buf: Buffer): { content: string; receiveId: string } {
  const data = pkcs7Unpad(buf);
  if (data.length < 20) {
    return { content: "", receiveId: "" };
  }
  const body = data.subarray(16);
  const msgLen = body.readUInt32BE(0);
  const msg = body.subarray(4, 4 + msgLen).toString("utf8");
  const receiveId = body.subarray(4 + msgLen).toString("utf8");
  return { content: msg, receiveId };
}

export function verifySha1Signature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  signature: string
): boolean {
  const arr = [token, timestamp, nonce, encrypt].sort();
  const str = arr.join("");
  const hash = createHash("sha1").update(str).digest("hex");
  return hash === signature;
}

export function decryptWeComPayload(encodingAESKey: string, encryptedBase64: string): Buffer {
  const key = Buffer.from(encodingAESKey + "=", "base64");
  if (key.length !== 32) {
    throw new Error("WECOM_ENCODING_AES_KEY 解码后须为 32 字节");
  }
  const iv = key.subarray(0, 16);
  const ciphertext = urlSafeBase64ToBuffer(encryptedBase64);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return pkcs7Unpad(decrypted);
}

/** URL 验证：解密 echostr，返回需在响应体中输出的明文 */
export function decryptEchoStr(encodingAESKey: string, echostr: string): string {
  const raw = decryptWeComPayload(encodingAESKey, echostr);
  const { content } = parseContentFromDecrypted(raw);
  return content;
}

/** 从 POST 体 XML 取出 Encrypt CDATA */
export function extractEncryptFromXml(xml: string): string | null {
  const m =
    xml.match(/<Encrypt><!\[CDATA\[([\s\S]*?)\]\]><\/Encrypt>/) ??
    xml.match(/<Encrypt>([^<]+)<\/Encrypt>/);
  return m?.[1]?.trim() ?? null;
}

/** 从解密后的业务 XML 中取文本消息（示例字段，以官方为准） */
export function parseTextXmlInner(xml: string): { fromUser?: string; content?: string; msgId?: string } {
  const fromUser = xml.match(/<FromUserName><!\[CDATA\[([\s\S]*?)\]\]><\/FromUserName>/)?.[1]?.trim();
  const content = xml.match(/<Content><!\[CDATA\[([\s\S]*?)\]\]><\/Content>/)?.[1]?.trim();
  const msgId = xml.match(/<MsgId><!\[CDATA\[([\s\S]*?)\]\]><\/MsgId>/)?.[1]?.trim();
  return { fromUser, content, msgId };
}
