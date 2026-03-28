/**
 * 演示：意图 / LLM 注入 `sqlQuery` / `sqlQueries`（与 SkillGuide 约定一致，由模型生成后下发）。
 * 运行：npm run dev:member-profile
 *
 * 下列 SQL 仅作联调示例，与 `skills/guides/member/member-profile-query.md` 中能力描述对齐；
 * 生产应由 LLM 按 Guide 生成并走 `OrchestratorInput.sqlQuery(s)`。
 */
import { initCore } from "../bootstrap/initCore.js";
import { runDataQueryGraph } from "../graph/data-query/dataQueryGraph.js";

const SQL_PROFILE_BY_VIP = `
SELECT
  a.hyid AS vipId,
  a.hyk_no AS memberCardNo,
  b.gk_name AS userName,
  c.hykname AS cardTypeName,
  b.sjhm AS mobile,
  d.mdmc AS storeName,
  a.djsj AS registeTime
FROM bfcrm8.hyk_hyxx a
LEFT JOIN bfcrm8.hyk_gkda b ON a.gkid = b.gkid
JOIN bfcrm8.hykdef c ON a.hyktype = c.hyktype
JOIN bfcrm8.mddy d ON a.mdid = d.mdid
WHERE a.status <> -1
  AND c.bj_bhxs = 1
  AND a.hyid IN (:1, :2)
`.trim();

const SQL_PROFILE_ONE_VIP = SQL_PROFILE_BY_VIP.replace("IN (:1, :2)", "IN (:1)");

const SQL_CHANGE_LOG = `
SELECT
  r.hyid AS vipId,
  r.birthday AS birthday,
  TO_CHAR(r.create_time, 'yyyy-mm-dd') AS change_day
FROM bfcrm8.hyk_birthday_record r
WHERE r.hyid IN (:1)
`.trim();

async function main() {
  const { env } = await initCore();

  const byUser = await runDataQueryGraph({
    userInput: "（由意图节点注入 sqlQuery，本句可忽略）",
    userId: "demo-user",
    env,
    sqlQuery: {
      sql: SQL_PROFILE_BY_VIP,
      params: ["1", "2"],
      dbClientKey: "member",
      label: "member.profile.by_user_id",
      purpose: "member.profile.by_user_id"
    }
  });
  console.log("[sqlQuery 单条]\n", JSON.stringify(byUser, null, 2));

  const changeLog = await runDataQueryGraph({
    userInput: "生日变更",
    userId: "demo-user",
    env,
    sqlQuery: {
      sql: SQL_CHANGE_LOG,
      params: ["1"],
      dbClientKey: "member",
      label: "member.profile.change_log",
      purpose: "member.profile.change_log"
    }
  });
  console.log("[sqlQuery change_log]\n", JSON.stringify(changeLog, null, 2));

  const batch = await runDataQueryGraph({
    userInput: "多条",
    userId: "demo-user",
    env,
    sqlQueries: [
      {
        sql: SQL_PROFILE_ONE_VIP,
        params: ["1"],
        dbClientKey: "member",
        label: "member.profile.by_user_id",
        purpose: "member.profile.by_user_id"
      },
      {
        sql: SQL_CHANGE_LOG,
        params: ["1"],
        dbClientKey: "member",
        label: "member.profile.change_log",
        purpose: "member.profile.change_log"
      }
    ]
  });
  console.log("[sqlQueries 批量]\n", JSON.stringify(batch, null, 2));

  const badBatch = await runDataQueryGraph({
    userInput: "缺 SQL",
    userId: "demo-user",
    env,
    sqlQueries: [{ sql: "", label: "empty_sql", dbClientKey: "member" }]
  });
  console.log("[空 SQL 校验]\n", JSON.stringify(badBatch, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
