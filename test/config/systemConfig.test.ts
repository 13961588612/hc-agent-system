import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { loadSystemConfigFromFile } from "../../src/config/systemConfig.js";

const prevSystemConfig = process.env.SYSTEM_CONFIG;

afterEach(() => {
  if (prevSystemConfig === undefined) delete process.env.SYSTEM_CONFIG;
  else process.env.SYSTEM_CONFIG = prevSystemConfig;
});

describe("loadSystemConfigFromFile", () => {
  test("未设置 SYSTEM_CONFIG 时加载默认 config/system.yaml 并打印", async () => {
    delete process.env.SYSTEM_CONFIG;
    const defaultPath = join(process.cwd(), "config", "system.yaml");
    const cfg = await loadSystemConfigFromFile();
    assert.ok(
      cfg,
      `应能从默认路径读取并解析：${defaultPath}（或设置 SYSTEM_CONFIG 指向有效文件）`
    );
    console.log(
      `[loadSystemConfigFromFile] 默认路径 ${defaultPath}\n`,
      JSON.stringify(cfg, null, 2)
    );
  });
});
