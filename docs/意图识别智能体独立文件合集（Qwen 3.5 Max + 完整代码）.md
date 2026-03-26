# 意图识别智能体独立文件合集（Qwen 3.5 Max + 完整代码）

以下为所有独立文件，每个文件可单独复制保存，后缀对应文件类型，补充完整工具类、辅助逻辑，可直接用于开发调试。

## 一、设计文档类

### 文件1：核心设计文档（intent_agent_design.md）

```markdown
# 意图识别智能体设计与开发文档
## 基于 Qwen 3.5 Max + langgraph TS

## 1. 项目概述
### 1.1 项目目标
构建一套高准确率、可扩展、可迭代的意图识别智能体，统一支撑：
- 线下客服
- 知识库问答
- 电商售前/售后客服
- 数据查询分析助手

### 1.2 技术方案
- 大模型：Qwen 3.5 Max
- 输出格式：结构化 JSON
- 核心能力：意图分类、槽位抽取、多意图识别、上下文理解、置信度判断、反问澄清
- 开发框架：langgraph TS（TypeScript），实现流程化、可编排的意图识别逻辑
- 接口框架：NestJS（轻量、模块化，适配TS生态，便于接口开发与部署）

## 2. 业务场景与意图体系
### 2.1 覆盖场景
1. 线下客服
2. 知识库问答（KB-QA）
3. 电商售前/售后
4. 数据查询与分析助手

### 2.2 意图体系（一级 + 二级）
#### 2.2.1 一级意图
- offline_service：线下客服
- kb_qa：知识库问答
- ecommerce：电商售前售后
- data_query：数据查询分析
- unknown_intent：兜底拒识

#### 2.2.2 二级意图
**offline_service**
- consultation：业务咨询
- handle：业务办理
- complain：投诉建议
- other_service：其他线下服务

**kb_qa**
- rule_query：规则/制度查询
- process_query：流程查询
- explain：概念/名词解释
- unknown_doc：知识库无答案

**ecommerce**
- pre_sales：售前咨询
- order_query：订单查询
- logistics：物流查询
- after_sales：售后（退换/退款/维修）
- complaint：电商投诉

**data_query**
- data_lookup：单指标查询
- stat_analysis：统计/汇总/趋势
- compare：对比分析
- chart：图表/可视化
- invalid_query：无效/无权限查询

## 3. 模型调用配置（Qwen 3.5 Max）
### 3.1 模型参数
- 模型：qwen-3.5-max
- 温度：temperature = 0.1
- 响应格式：json_object
- 流式输出：关闭
- 最大输出长度：1024

### 3.2 系统提示词（正式版）
```
你是一个工业级高精度意图识别智能体，基于Qwen 3.5 Max运行。
任务：严格识别用户输入的意图，只输出标准JSON，不解释、不闲聊、不扩展。

一、支持的意图体系
一级意图：
offline_service、kb_qa、ecommerce、data_query、unknown_intent

二级意图：
offline_service: consultation、handle、complain、other_service
kb_qa: rule_query、process_query、explain、unknown_doc
ecommerce: pre_sales、order_query、logistics、after_sales、complaint
data_query: data_lookup、stat_analysis、compare、chart、invalid_query
unknown_intent: 兜底意图

二、输出规则
1. 支持单意图、多意图，全部放入intents数组
2. confidence：0~1，越高越确定
3. slots：抽取关键实体（订单号、时间、商品、地点、指标等）
4. is_ambiguous：意图模糊则为true
5. need_ask：需要反问用户则为true
6. 只输出合法JSON，无任何多余文字

三、输出JSON格式
{
  "intents": [
    {
      "first_level": "一级意图",
      "second_level": "二级意图",
      "confidence": 0.95
    }
  ],
  "slots": {},
  "is_ambiguous": false,
  "need_ask": false,
  "reply": "简洁回复或反问内容"
}
```

## 4. 输出规范与置信度策略
### 4.1 输出字段
- intents：意图列表（支持多意图）
- first_level：一级意图
- second_level：二级意图
- confidence：置信度 0~1
- slots：槽位实体
- is_ambiguous：是否模糊
- need_ask：是否需要反问
- reply：回复/反问话术

### 4.2 置信度路由策略
- ≥ 0.9：直接执行
- 0.7 ~ 0.9：确认意图
- < 0.7：反问澄清

## 5. 代码划分与切割设计（langgraph TS 版）
### 5.1 核心设计原则
1.  模块化：按「功能职责」划分代码模块，基于langgraph TS的节点（Node）与边（Edge）设计，实现流程化编排，降低耦合；
2.  可复用：抽取公共工具类、类型定义，封装langgraph节点逻辑，避免重复编码，适配TS的类型安全特性；
3.  易扩展：基于langgraph的流程编排能力，新增意图、扩展场景时，只需新增节点或调整流程，无需修改核心逻辑；
4.  可追溯：代码模块与现有文档（意图体系、测试用例）一一对应，langgraph的可视化流程便于问题定位与调试；
5.  类型安全：全程使用TypeScript，定义完整的接口、类型，避免类型错误，提升代码可维护性。

### 5.2 代码目录结构（langgraph TS + NestJS，适配Qwen 3.5 Max API调用）
```
intent-agent/                  # 项目根目录（TS项目）
├── src/                       # 核心源码目录
│   ├── config/                # 配置模块（对应文档3.1模型参数、意图体系）
│   │   ├── model.config.ts    # 模型参数配置（温度、输出长度、API密钥等）
│   │   └── intent.config.ts   # 意图体系配置（一级/二级意图映射，同步intent_system.csv）
│   ├── core/                  # 核心业务模块（langgraph节点+意图识别逻辑）
│   │   ├── langgraph/         # langgraph流程编排核心
│   │   │   ├── nodes/         # langgraph节点（每个节点对应一个核心功能）
│   │   │   │   ├── modelCall.node.ts  # Qwen 3.5 Max调用节点（封装API请求）
│   │   │   │   ├── intentParse.node.ts # 意图解析节点（提取intents、判断多意图）
│   │   │   │   ├── slotExtract.node.ts # 槽位抽取节点（实体抽取、格式标准化）
│   │   │   │   ├── confidenceRouter.node.ts # 置信度路由节点（对应文档4.2）
│   │   │   │   └── replyGenerate.node.ts # 回复生成节点（生成反问/确认话术）
│   │   │   └── graph.ts       # langgraph流程编排（定义节点关系、执行流程）
│   │   ├── intent/            # 意图相关逻辑（辅助langgraph节点）
│   │   │   ├── intent.recognizer.ts # 意图解析核心逻辑
│   │   │   └── intent.validator.ts  # 意图格式校验
│   │   └── slot/              # 槽位相关逻辑（辅助langgraph节点）
│   │       └── slot.extractor.ts # 槽位抽取核心逻辑
│   ├── utils/                 # 工具模块（公共复用功能）
│   │   ├── json.validator.ts  # JSON输出校验（对应文档4.1，避免非法JSON）
│   │   ├── logger.ts          # 日志工具（记录请求、响应、错误信息）
│   │   ├── data.loader.ts     # 数据加载（加载CSV表格：测试用例、BadCase等）
│   │   └── qwen.api.ts        # Qwen 3.5 Max API封装（供langgraph节点调用）
│   ├── api/                   # 接口模块（NestJS，对应文档6.接口设计）
│   │   ├── controllers/       # 接口控制器
│   │   │   └── intent.controller.ts # 意图识别接口（POST /api/intent-recognize）
│   │   ├── dtos/              # 接口请求/响应DTO（类型定义，对应接口参数）
│   │   │   ├── request.dto.ts # 请求参数类型（user_id、session_id、query等）
│   │   │   └── response.dto.ts # 响应参数类型（intents、slots等）
│   │   └── modules/           # 接口模块（NestJS模块化）
│   │       └── intent.module.ts # 意图识别接口模块
│   ├── test/                  # 测试模块（对应文档测试用例、BadCase）
│   │   ├── intent.test.ts     # 意图识别测试（执行test_cases.csv用例）
│   │   ├── slot.test.ts       # 槽位抽取测试
│   │   └── badcase.analysis.ts # BadCase分析（统计错误类型，支撑迭代）
│   ├── types/                 # 全局类型定义（TS核心）
│   │   ├── intent.type.ts     # 意图相关类型（一级/二级意图、意图列表等）
│   │   ├── slot.type.ts       # 槽位相关类型（实体类型、槽位格式等）
│   │   └── common.type.ts     # 公共类型（响应格式、错误类型等）
│   └── main.ts                # 项目入口（NestJS启动入口，初始化langgraph）
├── assets/                    # 静态资源目录
│   ├── intent_system.csv      # 意图体系表格（同步config/intent.config.ts）
│   ├── test_cases.csv         # 测试用例表格
│   └── badcase_template.csv   # BadCase收集模板
├── package.json               # 依赖配置（langgraph、@ai/qwen、nestjs等）
├── tsconfig.json              # TS配置文件
└── .env                       # 环境变量（API密钥、端口等，不提交代码）
```

## 6. 接口设计（补充，适配NestJS + TS）
### 6.1 接口类型
- 接口协议：HTTP
- 请求方式：POST
- 接口地址：/api/intent-recognize
- 响应格式：JSON（与文档4.1输出规范一致，适配TS类型）

### 6.2 请求参数（Body）
```json
{
  "user_id": "用户唯一标识",
  "session_id": "会话ID（用于上下文关联）",
  "query": "用户输入的查询内容",
  "context": "上下文对话（可选，用于多轮对话）"
}
```
对应的TS DTO类型（src/api/dtos/request.dto.ts）

### 6.3 响应参数
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "intents": [
      {
        "first_level": "一级意图",
        "second_level": "二级意图",
        "confidence": 0.95
      }
    ],
    "slots": {},
    "is_ambiguous": false,
    "need_ask": false,
    "reply": "简洁回复或反问内容"
  }
}
```
对应的TS DTO类型（src/api/dtos/response.dto.ts）

### 6.4 错误码说明
- 400：请求参数不完整/格式错误（TS类型校验失败）
- 500：模型调用失败/内部逻辑错误（langgraph节点执行异常）
- 503：模型服务不可用

## 7. 部署方案（补充，适配TS + NestJS）
### 7.1 部署环境
- 服务器配置：CPU ≥ 4核，内存 ≥ 8G，带宽 ≥ 10Mbps
- 运行环境：Node.js 16+（适配TS、NestJS、langgraph）
- 依赖包：langgraph（TS版）、@ai/qwen（Qwen 3.5 Max API调用）、nestjs（接口服务）、csv-parser（CSV加载）、winston（日志）、dotenv（环境变量）

### 7.2 部署步骤
1.  环境准备：安装Node.js 16+，配置npm/yarn；
2.  依赖安装：npm install（读取package.json，安装所有依赖）；
3.  配置修改：修改.env文件，填入Qwen 3.5 Max API密钥、接口端口等敏感信息；
4.  构建项目：npm run build（TS编译为JS，生成dist目录）；
5.  启动服务：npm run start:prod（启动NestJS生产环境服务，初始化langgraph流程）；
6.  测试验证：调用接口，执行assets/test_cases.csv中的用例，验证接口响应和意图识别准确率；
7.  监控部署：配置日志监控（winston），定期查看日志，收集BadCase，支撑迭代优化；
8.  可选：使用PM2进程管理工具，确保服务稳定运行（pm2 start dist/main.js）。

## 8. 迭代优化方案
1.  每日自动收集 BadCase（低置信、识别错误、用户修正）
2.  每周人工标注 50–100 条
3.  加入 Few-shot 示例，更新提示词（修改config/model.config.ts）
4.  优化langgraph节点逻辑（如intentParse.node.ts的多意图解析），重新编译部署
5.  重新评估准确率，持续迭代

## 9. 预期效果
- 意图识别准确率：≥95%
- 多意图识别准确率：≥90%
- 槽位抽取准确率：≥92%
- 平均响应：< 1s
- 支持 100+ 意图平滑扩展
- 类型安全：无类型错误，代码可维护性高
- 流程可编排：基于langgraph，便于调整意图识别流程

## 10. 交付物清单
1.  意图体系设计文档
2.  Qwen 3.5 Max 系统提示词
3.  结构化输出规范
4.  接口文档（适配TS DTO）
5.  置信度路由策略
6.  测试用例（50条）
7.  BadCase 收集与迭代方案
8.  完整代码包（langgraph TS + NestJS，含所有模块代码）
9.  部署说明文档（适配Node.js环境）
```

### 文件2：意图体系表格（intent_system.csv）

```csv
一级意图编码,一级意图名称,二级意图编码,二级意图名称,说明
offline_service,线下客服,consultation,业务咨询,线下业务咨询
offline_service,线下客服,handle,业务办理,线下业务办理/操作
offline_service,线下客服,complain,投诉建议,投诉、意见反馈
offline_service,线下客服,other_service,其他线下服务,不属于以上的线下服务
kb_qa,知识库问答,rule_query,规则制度查询,查询规则、制度、条款
kb_qa,知识库问答,process_query,流程查询,查询办理流程、步骤
kb_qa,知识库问答,explain,概念解释,解释名词、术语、定义
kb_qa,知识库问答,unknown_doc,无匹配知识,知识库无对应内容
ecommerce,电商客服,pre_sales,售前咨询,商品、活动、价格、规格
ecommerce,电商客服,order_query,订单查询,查订单状态
ecommerce,电商客服,logistics,物流查询,查包裹、配送
ecommerce,电商客服,after_sales,售后处理,退换货、退款、维修
ecommerce,电商客服,complaint,电商投诉,商品/服务投诉
data_query,数据查询,data_lookup,单指标查询,查单个数据
data_query,数据查询,stat_analysis,统计分析,汇总、趋势、占比
data_query,数据查询,compare,对比分析,同比、环比、对比
data_query,数据查询,chart,图表生成,需要画图/可视化
data_query,数据查询,invalid_query,无效查询,无权限、不合理请求
unknown_intent,兜底意图,unknown_intent,未知意图,无法识别
```

### 文件3：测试用例表格（test_cases.csv）

```csv
编号,场景,用户query,预期一级意图,预期二级意图
1,线下客服,我想问下怎么办理业务,offline_service,consultation
2,线下客服,我要办挂失,offline_service,handle
3,线下客服,我要投诉你们服务差,offline_service,complain
4,线下客服,营业厅在哪里,offline_service,consultation
5,线下客服,上班时间是什么时候,offline_service,consultation
6,线下客服,我要修改信息,offline_service,handle
7,线下客服,我要提个建议,offline_service,complain
8,线下客服,我要注销账户,offline_service,handle
9,线下客服,能帮我查一下进度吗,offline_service,consultation
10,线下客服,我还有别的问题要问,offline_service,other_service
11,知识库,规定是什么,kb_qa,rule_query
12,知识库,政策文件在哪里,kb_qa,rule_query
13,知识库,流程怎么走,kb_qa,process_query
14,知识库,第一步做什么,kb_qa,process_query
15,知识库,这个词什么意思,kb_qa,explain
16,知识库,请解释一下专业术语,kb_qa,explain
17,知识库,标准是什么,kb_qa,rule_query
18,知识库,有什么要求,kb_qa,rule_query
19,知识库,这个概念怎么理解,kb_qa,explain
20,知识库,我不知道的内容,kb_qa,unknown_doc
21,电商,这件衣服多少钱,ecommerce,pre_sales
22,电商,有优惠吗,ecommerce,pre_sales
23,电商,尺码怎么选,ecommerce,pre_sales
24,电商,什么时候发货,ecommerce,pre_sales
25,电商,我要查我的订单,ecommerce,order_query
26,电商,订单号12345状态,ecommerce,order_query
27,电商,我的快递到哪了,ecommerce,logistics
28,电商,什么时候能送到,ecommerce,logistics
29,电商,我要退货,ecommerce,after_sales
30,电商,我要退款,ecommerce,after_sales
31,电商,质量有问题怎么办,ecommerce,after_sales
32,电商,可以换货吗,ecommerce,after_sales
33,电商,我要投诉商品质量差,ecommerce,complaint
34,电商,投诉物流慢,ecommerce,complaint
35,电商,客服不理人,ecommerce,complaint
36,数据,今天销售额多少,data_query,data_lookup
37,数据,查昨日销量,data_query,data_lookup
38,数据,本月统计,data_query,stat_analysis
39,数据,趋势怎么样,data_query,stat_analysis
40,数据,同比增长多少,data_query,compare
41,数据,和上个月对比,data_query,compare
42,数据,帮我画个折线图,data_query,chart
43,数据,生成柱状图,data_query,chart
44,数据,各部门占比,data_query,stat_analysis
45,数据,查机密数据,data_query,invalid_query
46,多意图,我要退货再查订单,ecommerce,after_sales,order_query
47,多意图,解释流程并查规则,kb_qa,explain,process_query
48,模糊意图,我有点事想问你,unknown_intent,unknown_intent
49,模糊意图,随便问问,unknown_intent,unknown_intent
50,跨域,帮我查数据再投诉,data_query,ecommerce,stat_analysis,complaint
```

### 文件4：BadCase收集模板（badcase_template.csv）

```csv
日期,用户ID,Session,用户输入,模型识别意图,模型置信度,正确意图,是否BadCase,处理人,处理结果
2026-03-05,user001,sid123,我要查物流,ecommerce.logistics,0.85,ecommerce.logistics,否,AI,通过
2026-03-05,user002,sid124,帮我看下单,ecommerce.pre_sales,0.6,ecommerce.order_query,是,标注员,已修正
2026-03-06,user003,sid125,查本月销售额,data_query,data_lookup,0.92,data_query.stat_analysis,是,标注员,已修正
2026-03-06,user004,sid126,解释什么是售后,kb_qa,explain,0.96,kb_qa.explain,否,AI,通过
```

## 二、配置模块代码（src/config/）

### 文件5：模型参数配置（src/config/model.config.ts）

```typescript
import dotenv from 'dotenv';
dotenv.config(); // 加载.env环境变量

// 模型参数配置（与设计文档3.1一致）
export const modelConfig = {
  apiKey: process.env.QWEN_API_KEY || '', // 从环境变量读取API密钥，避免硬编码
  model: 'qwen-3.5-max', // 模型版本
  temperature: 0.1, // 温度，越低越严谨
  maxOutputLength: 1024, // 最大输出长度
  systemPrompt: `你是一个工业级高精度意图识别智能体，基于Qwen 3.5 Max运行。
任务：严格识别用户输入的意图，只输出标准JSON，不解释、不闲聊、不扩展。

一、支持的意图体系
一级意图：
offline_service、kb_qa、ecommerce、data_query、unknown_intent

二级意图：
offline_service: consultation、handle、complain、other_service
kb_qa: rule_query、process_query、explain、unknown_doc
ecommerce: pre_sales、order_query、logistics、after_sales、complaint
data_query: data_lookup、stat_analysis、compare、chart、invalid_query
unknown_intent: 兜底意图

二、输出规则
1. 支持单意图、多意图，全部放入intents数组
2. confidence：0~1，越高越确定
3. slots：抽取关键实体（订单号、时间、商品、地点、指标等）
4. is_ambiguous：意图模糊则为true
5. need_ask：需要反问用户则为true
6. 只输出合法JSON，无任何多余文字

三、输出JSON格式
{
  "intents": [
    {
      "first_level": "一级意图",
      "second_level": "二级意图",
      "confidence": 0.95
    }
  ],
  "slots": {},
  "is_ambiguous": false,
  "need_ask": false,
  "reply": "简洁回复或反问内容"
}`,
  // 置信度阈值（与设计文档4.2一致）
  confidenceThreshold: {
    direct: 0.9, // 直接执行阈值
    confirm: 0.7 // 确认意图阈值
  }
};

// 接口配置
export const apiConfig = {
  port: process.env.PORT || 3000, // 接口端口，默认3000
  prefix: '/api', // 接口前缀
  timeout: 5000 // 接口超时时间（ms）
};
```
```

### 文件6：意图体系配置（src/config/intent.config.ts）

```typescript
import { dataLoader } from '../utils/data.loader';
import { FirstLevelIntent, SecondLevelIntent } from '../types/intent.type';

// 加载意图体系CSV文件，同步意图映射
const intentSystem = dataLoader.loadIntentSystem();

// 一级意图映射（编码 -> 名称）
export const firstLevelIntentMap: Record<FirstLevelIntent, string> = {
  offline_service: '线下客服',
  kb_qa: '知识库问答',
  ecommerce: '电商售前售后',
  data_query: '数据查询分析',
  unknown_intent: '兜底意图'
};

// 二级意图映射（一级意图编码 -> 二级意图映射）
export const secondLevelIntentMap: Record<FirstLevelIntent, Record<SecondLevelIntent, string>> = {
  offline_service: {
    consultation: '业务咨询',
    handle: '业务办理',
    complain: '投诉建议',
    other_service: '其他线下服务'
  },
  kb_qa: {
    rule_query: '规则制度查询',
    process_query: '流程查询',
    explain: '概念解释',
    unknown_doc: '无匹配知识'
  },
  ecommerce: {
    pre_sales: '售前咨询',
    order_query: '订单查询',
    logistics: '物流查询',
    after_sales: '售后处理',
    complaint: '电商投诉'
  },
  data_query: {
    data_lookup: '单指标查询',
    stat_analysis: '统计分析',
    compare: '对比分析',
    chart: '图表生成',
    invalid_query: '无效查询'
  },
  unknown_intent: {
    unknown_intent: '未知意图'
  }
};

// 校验二级意图是否属于对应一级意图
export function isSecondLevelIntentValid(firstLevel: FirstLevelIntent, secondLevel: SecondLevelIntent): boolean {
  return secondLevelIntentMap[firstLevel]?.hasOwnProperty(secondLevel) ?? false;
}

// 获取所有一级意图列表
export function getAllFirstLevelIntents(): FirstLevelIntent[] {
  return Object.keys(firstLevelIntentMap) as FirstLevelIntent[];
}

// 获取指定一级意图下的所有二级意图
export function getSecondLevelIntents(firstLevel: FirstLevelIntent): SecondLevelIntent[] {
  return Object.keys(secondLevelIntentMap[firstLevel]) as SecondLevelIntent[];
}
```
```

## 三、类型定义模块代码（src/types/）

### 文件7：意图相关类型（src/types/intent.type.ts）

```typescript
// 一级意图类型（与意图体系严格对应）
export type FirstLevelIntent = 'offline_service' | 'kb_qa' | 'ecommerce' | 'data_query' | 'unknown_intent';

// 二级意图类型（与一级意图关联，严格对应意图体系）
export type SecondLevelIntent = 
  | 'consultation' | 'handle' | 'complain' | 'other_service' // offline_service 对应二级意图
  | 'rule_query' | 'process_query' | 'explain' | 'unknown_doc' // kb_qa 对应二级意图
  | 'pre_sales' | 'order_query' | 'logistics' | 'after_sales' | 'complaint' // ecommerce 对应二级意图
  | 'data_lookup' | 'stat_analysis' | 'compare' | 'chart' | 'invalid_query' // data_query 对应二级意图
  | 'unknown_intent'; // 兜底意图

// 意图项类型（单个意图的详细信息）
export interface IntentItem {
  first_level: FirstLevelIntent; // 一级意图
  second_level: SecondLevelIntent; // 二级意图
  confidence: number; // 置信度（0~1）
}

// 意图识别结果基础类型（供langgraph节点传递数据）
export interface IntentRecognitionResult {
  intents: IntentItem[]; // 意图列表（支持多意图）
  is_ambiguous: boolean; // 是否模糊意图（无法明确用户真实需求）
  need_ask: boolean; // 是否需要反问用户澄清
  reply?: string; // 临时回复/反问话术
}
```
```

### 文件8：槽位相关类型（src/types/slot.type.ts）

```typescript
// 槽位实体类型（可根据业务场景扩展）
export type SlotType = 'order_id' | 'time' | 'product' | 'location' | 'indicator' | 'other';

// 槽位项类型（单个槽位的详细信息）
export interface Slot {
  type: SlotType; // 槽位类型
  value: string; // 槽位值（实体内容）
  confidence: number; // 槽位置信度（0~1）
}

// 槽位抽取结果类型（供langgraph节点传递数据）
export interface SlotExtractResult {
  slots: Record<string, Slot>; // key: 实体名称（如订单号、商品名），value: 槽位信息
}
```
```

### 文件9：公共类型（src/types/common.type.ts）

```typescript
// 错误类型枚举
export enum ErrorType {
  MODEL_CALL_ERROR = 'MODEL_CALL_ERROR', // 模型调用失败
  JSON_VALIDATE_ERROR = 'JSON_VALIDATE_ERROR', // JSON格式校验失败
  INTENT_VALIDATE_ERROR = 'INTENT_VALIDATE_ERROR', // 意图格式校验失败
  SLOT_EXTRACT_ERROR = 'SLOT_EXTRACT_ERROR', // 槽位抽取失败
  PARAM_ERROR = 'PARAM_ERROR', // 请求参数错误
  SYSTEM_ERROR = 'SYSTEM_ERROR' // 系统内部错误
}

// 错误响应类型
export interface ErrorResponse {
  code: number; // 错误码
  message: string; // 错误信息
  type: ErrorType; // 错误类型
  detail?: string; // 错误详情（可选）
}

// 日志级别枚举
export enum LogLevel {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  DEBUG = 'debug'
}

// 日志信息类型
export interface LogInfo {
  timestamp: string; // 日志时间戳
  level: LogLevel; // 日志级别
  message: string; // 日志内容
  detail?: Record<string, any>; // 日志详情（可选，如用户query、模型响应等）
}

// 通用响应格式（适配所有接口）
export interface CommonResponse<T = any> {
  code: number; // 状态码（200成功，其他失败）
  message: string; // 响应信息
  data?: T; // 响应数据（可选）
  error?: ErrorResponse; // 错误信息（可选，失败时返回）
}
```
```

## 四、工具模块代码（src/utils/）

### 文件10：Qwen API封装（src/utils/qwen.api.ts）

```typescript
import { Qwen } from '@ai/qwen';
import { modelConfig } from '../config/model.config';
import { logger } from './logger';
import { ErrorType } from '../types/common.type';

// 初始化Qwen客户端（单例模式，避免重复初始化）
const qwen = new Qwen({
  apiKey: modelConfig.apiKey, // 从配置文件读取API密钥
});

/**
 * 调用Qwen 3.5 Max API，获取意图识别响应
 * @param userQuery 用户输入的查询内容
 * @returns 模型返回的JSON字符串
 * @throws 抛出错误（模型调用失败时）
 */
export async function callQwenApi(userQuery: string): Promise<string> {
  try {
    logger.info('开始调用Qwen 3.5 Max API', { userQuery });
    
    // 调用模型API
    const response = await qwen.chat.completions.create({
      model: modelConfig.model,
      temperature: modelConfig.temperature,
      max_tokens: modelConfig.maxOutputLength,
      response_format: { type: 'json_object' }, // 强制返回JSON格式
      messages: [
        { role: 'system', content: modelConfig.systemPrompt }, // 系统提示词（从配置读取）
        { role: 'user', content: userQuery }
      ]
    });

    // 提取并处理模型响应内容（去除多余空格、换行）
    const content = response.choices[0].message.content?.trim() || '';
    if (!content) {
      logger.error('Qwen API响应为空', { userQuery });
      throw new Error(`[${ErrorType.MODEL_CALL_ERROR}] 模型响应为空`);
    }

    logger.info('Qwen API调用成功', { userQuery, modelResponse: content });
    return content;
  } catch (error) {
    const errorMsg = (error as Error).message;
    logger.error(`Qwen API调用失败: ${errorMsg}`, { userQuery, error });
    throw new Error(`[${ErrorType.MODEL_CALL_ERROR}] ${errorMsg}`);
  }
}
```
```

### 文件11：JSON校验工具（src/utils/json.validator.ts）

```typescript
import { logger } from './logger';
import { ErrorType } from '../types/common.type';

/**
 * JSON校验工具类
 * 职责：校验模型输出的JSON是否符合设计文档4.1的规范
 */
export const jsonValidator = {
  /**
   * 校验JSON字符串合法性及格式规范
   * @param jsonStr 待校验的JSON字符串
   * @returns 校验结果（true：合法，false：非法）
   */
  validate(jsonStr: string): boolean {
    try {
      // 第一步：校验JSON格式合法性
      const jsonData = JSON.parse(jsonStr);
      
      // 第二步：校验核心字段是否存在
      const requiredFields = ['intents', 'slots', 'is_ambiguous', 'need_ask', 'reply'];
      const missingFields = requiredFields.filter(field => !(field in jsonData));
      
      if (missingFields.length > 0) {
        logger.warn('JSON格式不规范：缺少核心字段', { missingFields, jsonStr });
        return false;
      }
      
      // 第三步：校验intents字段格式（数组，每个元素包含指定字段）
      if (!Array.isArray(jsonData.intents)) {
        logger.warn('JSON格式不规范：intents必须是数组', { jsonStr });
        return false;
      }
      
      for (const intent of jsonData.intents) {
        const intentRequiredFields = ['first_level', 'second_level', 'confidence'];
        const intentMissingFields = intentRequiredFields.filter(field => !(field in intent));
        if (intentMissingFields.length > 0) {
          logger.warn('JSON格式不规范：intent缺少核心字段', { intentMissingFields, intent, jsonStr });
          return false;
        }
        
        // 校验置信度范围（0~1）
        if (typeof intent.confidence !== 'number' || intent.confidence < 0 || intent.confidence > 1) {
          logger.warn('JSON格式不规范：confidence必须是0~1的数字', { intent, jsonStr });
          return false;
        }
      }
      
      // 第四步：校验布尔类型字段
      if (typeof jsonData.is_ambiguous !== 'boolean' || typeof jsonData.need_ask !== 'boolean') {
        logger.warn('JSON格式不规范：is_ambiguous和need_ask必须是布尔值', { jsonStr });
        return false;
      }
      
      // 第五步：校验slots字段（对象类型）
      if (typeof jsonData.slots !== 'object' || jsonData.slots === null) {
        logger.warn('JSON格式不规范：slots必须是对象', { jsonStr });
        return false;
      }
      
      // 第六步：校验reply字段（字符串类型，允许为空）
      if (typeof jsonData.reply !== 'string') {
        logger.warn('JSON格式不规范：reply必须是字符串', { jsonStr });
        return false;
      }
      
      // 所有校验通过
      return true;
    } catch (error) {
      logger.error('JSON格式非法：无法解析为JSON', { jsonStr, error: (error as Error).message });
      return false;
    }
  },

  /**
   * 解析JSON字符串（带校验）
   * @param jsonStr 待解析的JSON字符串
   * @returns 解析后的JSON对象
   * @throws 抛出错误（JSON非法或格式不规范时）
   */
  parse(jsonStr: string): Record<string, any> {
    if (!this.validate(jsonStr)) {
      throw new Error(`[${ErrorType.JSON_VALIDATE_ERROR}] JSON格式不规范或非法`);
    }
    return JSON.parse(jsonStr);
  }
};
```
```

### 文件12：日志工具（src/utils/logger.ts）

```typescript
import winston from 'winston';
import { LogLevel, LogInfo } from '../types/common.type';

// 日志格式化器
const logFormatter = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const logInfo: LogInfo = {
    timestamp,
    level: level as LogLevel,
    message,
    detail: meta.detail || {}
  };
  return JSON.stringify(logInfo);
});

// 初始化日志器
export const logger = winston.createLogger({
  level: 'info', // 默认日志级别
  format: winston.format.combine(
    winston.format.timestamp(), // 自动添加时间戳
    logFormatter
  ),
  transports: [
    // 控制台输出（开发环境）
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // 文件输出（生产环境，按日期分割）
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error'
    }),
    new winston.transports.File({
      filename: 'logs/combined.log'
    })
  ]
});

// 开发环境日志级别调整
if (process.env.NODE_ENV === 'development') {
  logger.level = 'debug';
}

// 日志工具方法封装
export const log = {
  info: (message: string, detail?: Record<string, any>) => logger.info(message, { detail }),
  warn: (message: string, detail?: Record<string, any>) => logger.warn(message, { detail }),
  error: (message: string, detail?: Record<string, any>) => logger.error(message, { detail }),
  debug: (message: string, detail?: Record<string, any>) => logger.debug(message, { detail })
};
```
```

### 文件13：数据加载工具（src/utils/data.loader.ts）

```typescript
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { logger } from './logger';
import { ErrorType } from '../types/common.type';

// 静态资源目录路径
const ASSETS_DIR = path.resolve(__dirname, '../../assets');

/**
 * 数据加载工具类
 * 职责：加载assets目录下的CSV文件（意图体系、测试用例、BadCase）
 */
export const dataLoader = {
  /**
   * 加载意图体系表格（intent_system.csv）
   * @returns 意图体系数组
   */
  loadIntentSystem(): Array<{
    first_level_code: string;
    first_level_name: string;
    second_level_code: string;
    second_level_name: string;
    description: string;
  }> {
    const filePath = path.join(ASSETS_DIR, 'intent_system.csv');
    return this.loadCsvFile(filePath);
  },

  /**
   * 加载测试用例表格（test_cases.csv）
   * @returns 测试用例数组
   */
  loadTestCases(): Array<{
    id: string;
    scene: string;
    query: string;
    expected_first_level: string;
    expected_second_level: string;
  }> {
    const filePath = path.join(ASSETS_DIR, 'test_cases.csv');
    return this.loadCsvFile(filePath);
  },

  /**
   * 加载BadCase表格（badcase_template.csv）
   * @returns BadCase数组
   */
  loadBadCases(): Array<{
    date: string;
    user_id: string;
    session: string;
    user_input: string;
    model_intent: string;
    confidence: string;
    correct_intent: string;
    is_badcase: string;
    handler: string;
    result: string;
  }> {
    const filePath = path.join(ASSETS_DIR, 'badcase_template.csv');
    return this.loadCsvFile(filePath);
  },

  /**
   * 通用CSV文件加载方法
   * @param filePath CSV文件路径
   * @returns CSV解析后的数组
   * @throws 抛出错误（文件不存在、解析失败时）
   */
  private loadCsvFile<T = any>(filePath: string): T[] {
    try {
      logger.info(`开始加载CSV文件：${filePath}`);
      
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        logger.error(`CSV文件不存在：${filePath}`);
        throw new Error(`[${ErrorType.SYSTEM_ERROR}] CSV文件不存在：${filePath}`);
      }
      
      // 读取并解析CSV文件
      const results: T[] = [];
      return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (data) => results.push(data))
          .on('end', () => {
            logger.info(`CSV文件加载成功，共加载${results.length}条数据`, { filePath });
            resolve(results);
          })
          .on('error', (error) => {
            logger.error(`CSV文件解析失败：${error.message}`, { filePath, error });
            reject(new Error(`[${ErrorType.SYSTEM_ERROR}] CSV文件解析失败：${error.message}`));
          });
      });
    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error(`CSV文件加载失败：${errorMsg}`, { filePath, error });
      throw new Error(`[${ErrorType.SYSTEM_ERROR}] ${errorMsg}`);
    }
  }
};
```
```

## 五、核心业务模块代码（src/core/）

### 文件14：意图解析辅助逻辑（src/core/intent/intent.recognizer.ts）

```typescript
import { IntentItem, FirstLevelIntent, SecondLevelIntent } from '../../types/intent.type';
import { logger } from '../../utils/logger';
import { getSecondLevelIntents } from '../../config/intent.config';

/**
 * 意图解析辅助类
 * 职责：提供意图解析、多意图判断、模糊意图识别等辅助逻辑
 */
export const intentRecognizer = {
  /**
   * 解析多意图（从模型返回的intents中提取有效多意图）
   * @param intents 模型返回的意图列表
   * @returns 去重、排序后的有效多意图列表（按置信度降序）
   */
  parseMultiIntents(intents: IntentItem[]): IntentItem[] {
    if (intents.length <= 1) {
      return intents; // 单意图直接返回
    }

    // 1. 去重：同一（一级+二级）意图只保留置信度最高的
    const intentMap = new Map<string, IntentItem>();
    for (const intent of intents) {
      const key = `${intent.first_level}-${intent.second_level}`;
      const existing = intentMap.get(key);
      if (!existing || intent.confidence > existing.confidence) {
        intentMap.set(key, intent);
      }
    }

    // 2. 排序：按置信度降序排列
    const sortedIntents = Array.from(intentMap.values()).sort((a, b) => b.confidence - a.confidence);

    // 3. 过滤：只保留置信度≥0.5的意图（低于此阈值视为无效）
    const validIntents = sortedIntents.filter(intent => intent.confidence >= 0.5);

    logger.info('多意图解析完成', { originalIntents: intents.length, validIntents: validIntents.length });
    return validIntents;
  },

  /**
   * 判断是否为模糊意图（无法明确用户真实需求）
   * @param intents 有效意图列表
   * @returns 是否为模糊意图（true：是，false：否）
   */
  isAmbiguousIntent(intents: IntentItem[]): boolean {
    // 情况1：无有效意图
    if (intents.length === 0) {
      return true;
    }

    // 情况2：最高置信度<0.7（置信度过低，无法确定）
    const topIntent = intents[0];
    if (topIntent.confidence < 0.7) {
      return true;
    }

    // 情况3：多意图且最高置信度与次高置信度差值<0.2（无法区分主次）
    if (intents.length >= 2) {
      const secondTopIntent = intents[1];
      if (topIntent.confidence - secondTopIntent.confidence < 0.2) {
        return true;
      }
    }

    // 情况4：意图为unknown_intent且置信度<0.8
    if (topIntent.first_level === 'unknown_intent' && topIntent.confidence < 0.8) {
      return true;
    }

    return false;
  },

  /**
   * 提取用户query中的意图关键词，辅助意图解析
   * @param query 用户输入的查询内容
   * @param firstLevel 一级意图（可选，用于精准提取）
   * @returns 意图关键词数组
   */
  extractIntentKeywords(query: string, firstLevel?: FirstLevelIntent): string[] {
    const keywordsMap: Record<FirstLevelIntent, string[]> = {
      offline_service: ['咨询', '办理', '投诉', '建议', '营业厅', '上班时间', '进度'],
      kb_qa: ['规则', '制度', '流程', '步骤', '解释', '名词', '术语', '概念'],
      ecommerce: ['商品', '价格', '优惠', '订单', '物流', '退货', '退款', '投诉'],
      data_query: ['数据', '统计', '对比', '图表', '销量', '销售额', '占比', '趋势'],
      unknown_intent: []
    };

    // 提取对应一级意图的关键词（无指定则提取所有关键词）
    const allKeywords = firstLevel 
      ? keywordsMap[firstLevel]
      : Object.values(keywordsMap).flat();

    // 匹配query中的关键词（不区分大小写）
    const lowerQuery = query.toLowerCase();
    return allKeywords.filter(keyword => lowerQuery.includes(keyword.toLowerCase()));
  },

  /**
   * 根据关键词推荐可能的二级意图
   * @param keywords 意图关键词数组
   * @param firstLevel 一级意图
   * @returns 推荐的二级意图数组（按匹配度排序）
   */
  recommendSecondLevelIntents(keywords: string[], firstLevel: FirstLevelIntent): SecondLevelIntent[] {
    const secondLevelIntents = getSecondLevelIntents(firstLevel);
    const keywordMap: Record<SecondLevelIntent, string[]> = {
      consultation: ['咨询', '问', '查询', '进度'],
      handle: ['办理', '修改', '注销', '挂失'],
      complain: ['投诉', '建议', '反馈'],
      other_service: ['其他', '别的'],
      rule_query: ['规则', '制度', '规定', '要求'],
      process_query: ['流程', '步骤', '怎么做'],
      explain: ['解释', '名词', '术语', '概念'],
      unknown_doc: ['不知道', '无匹配', '找不到'],
      pre_sales: ['价格', '优惠', '尺码', '发货'],
      order_query: ['订单', '订单号', '状态'],
      logistics: ['物流', '快递', '配送', '送到'],
      after_sales: ['退货', '退款', '换货', '维修'],
      complaint: ['投诉', '质量', '服务', '慢'],
      data_lookup: ['查', '多少', '单个', '数值'],
      stat_analysis: ['统计', '汇总', '趋势', '占比'],
      compare: ['对比', '同比', '环比'],
      chart: ['图表', '画图', '可视化', '折线图', '柱状图'],
      invalid_query: ['机密', '无权', '不合理'],
      unknown_intent: []
    };

    // 计算每个二级意图的匹配度（关键词匹配数量）
    const matchScores = secondLevelIntents.map(secondLevel => {
      const matchCount = keywordMap[secondLevel].filter(keyword => 
        keywords.includes(keyword)
      ).length;
      return { secondLevel, matchCount };
    });

    // 按匹配度降序排序，返回二级意图列表
    return matchScores
      .sort((a, b) => b.matchCount - a.matchCount)
      .map(item => item.secondLevel);
  }
};
```
```

### 文件15：意图格式校验（src/core/intent/intent.validator.ts）

```typescript
import { IntentItem, FirstLevelIntent, SecondLevelIntent } from '../../types/intent.type';
import { logger } from '../../utils/logger';
import { isSecondLevelIntentValid, getAllFirstLevelIntents } from '../../config/intent.config';
import { ErrorType } from '../../types/common.type';

/**
 * 意图格式校验类
 * 职责：校验意图格式是否符合规范，确保与意图体系一致
 */
export const intentValidator = {
  /**
   * 校验单个意图格式
   * @param intent 待校验的意图项
   * @returns 校验结果（true：合法，false：非法）
   */
  validateSingleIntent(intent: IntentItem): boolean {
    try {
      // 1. 校验一级意图合法性（必须在预设的一级意图列表中）
      const allFirstLevelIntents = getAllFirstLevelIntents();
      if (!allFirstLevelIntents.includes(intent.first_level)) {
        logger.warn('意图校验失败：无效的一级意图', { intent, validFirstLevelIntents: allFirstLevelIntents });
        return false;
      }

      // 2. 校验二级意图合法性（必须属于对应一级意图）
      if (!isSecondLevelIntentValid(intent.first_level, intent.second_level)) {
        logger.warn('意图校验失败：二级意图与一级意图不匹配', { intent });
        return false;
      }

      // 3. 校验置信度范围（0~1）
      if (typeof intent.confidence !== 'number' || intent.confidence < 0 || intent.confidence > 1) {
        logger.warn('意图校验失败：置信度必须是0~1的数字', { intent });
        return false;
      }

      // 所有校验通过
      return true;
    } catch (error) {
      logger.error('单个意图校验异常', { intent, error: (error as Error).message });
      return false;
    }
  },

  /**
   * 校验意图列表格式（批量校验）
   * @param intents 待校验的意图列表
   * @returns 校验结果（true：全部合法，false：存在非法意图）
   */
  validateIntentList(intents: IntentItem[]): boolean {
    if (!Array.isArray(intents)) {
      logger.warn('意图列表校验失败：intents必须是数组');
      return false;
    }

    // 批量校验每个意图，只要有一个非法则整体校验失败
    const invalidIntents = intents.filter(intent => !this.validateSingleIntent(intent));
    if (invalidIntents.length > 0) {
      logger.warn('意图列表校验失败：存在非法意图', { invalidIntentsCount: invalidIntents.length });
      return false;
    }

    logger.info('意图列表校验通过', { intentCount: intents.length });
    return true;
  },

  /**
   * 校验意图并抛出错误（用于严格校验场景）
   * @param intents 待校验的意图列表
   * @throws 抛出错误（存在非法意图时）
   */
  validateAndThrow(intents: IntentItem[]): void {
    if (!this.validateIntentList(intents)) {
      throw new Error(`[${ErrorType.INTENT_VALIDATE_ERROR}] 意图格式校验失败，存在非法意图`);
    }
  },

  /**
   * 过滤非法意图（保留合法意图，过滤非法意图）
   * @param intents 待过滤的意图列表
   * @returns 过滤后的合法意图列表
   */
  filterInvalidIntents(intents: IntentItem[]): IntentItem[] {
    if (!Array.isArray(intents)) {
      return [];
    }

    const validIntents = intents.filter(intent => this.validateSingleIntent(intent));
    const invalidCount = intents.length - validIntents.length;
    if (invalidCount > 0) {
      logger.warn(`过滤非法意图：共过滤${invalidCount}个非法意图`, { total: intents.length, valid: validIntents.length });
    }

    return validIntents;
  }
};
```
> （注：文档部分内容可能由 AI 生成）