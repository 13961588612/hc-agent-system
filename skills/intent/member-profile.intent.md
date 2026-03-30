---
id: intent-member-profile
kind: intent_rule
title: 会员档案查询意图
domain: member
targetIntent: member.profile.by_member_card_no
triggerKeywords:
  - 会员档案
  - 会员资料
  - 个人信息
  - 会员卡信息
  - 生日变更
  - 生日记录
triggerRegex:
  - "(会员卡|卡号)\\s*[:：是为]?\\s*[0-9A-Za-z]{6,32}"
requiredSlots:
  - memberCardNos
slotExtractors:
  - slot: member_card
    regex: "(?:会员卡(?:号)?|卡号)\\s*[:：是为]?\\s*([0-9A-Za-z]{6,32})"
  - slot: phone
    regex: "(1\\d{10})"
clarificationTemplate: "请补充会员卡号或手机号，以便查询会员档案。"
priority: 20
---

会员档案相关能力，优先走 `member.profile.*`。
