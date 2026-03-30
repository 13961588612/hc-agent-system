---
id: intent-member-points
kind: intent_rule
title: 会员积分查询意图
domain: member
targetIntent: member.points_account.by_member_card_no
triggerKeywords:
  - 积分
  - 积分余额
  - 可用积分
  - 积分流水
  - 积分明细
triggerRegex:
  - "(会员卡|卡号)\\s*[:：是为]?\\s*[0-9A-Za-z]{6,32}"
requiredSlots:
  - memberCardNos
slotExtractors:
  - slot: member_card
    regex: "(?:会员卡(?:号)?|卡号)\\s*[:：是为]?\\s*([0-9A-Za-z]{6,32})"
  - slot: phone
    regex: "(1\\d{10})"
clarificationTemplate: "请提供会员卡号（或手机号）以便查询积分账户。"
priority: 30
---

积分账户与积分流水相关能力，优先走 `member.points_account.*`。
