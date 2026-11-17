# 日织 AI Native 开发教学与实施路线

> 基线版本：日织 v1.2.0  
> 适用对象：第一次调用大模型 API、但已经能够继续开发日织的个人开发者  
> 文档性质：学习手册、产品路线和工程实施约束。实际开发中如果产品思路变化，应先更新本文件，再调整代码。

## 1. 先明确最终要做成什么

日织当前已经具备任务、模板、每日基调、长期与短期目标、记录、统计和本地 ASR。下一阶段的目标，不是简单地在页面中增加一个聊天框，也不是让大模型替用户写几段漂亮文字，而是形成下面的闭环：

```text
目标与必要投入
    ↓
当天基调与可用精力
    ↓
生成或调整每日计划
    ↓
用户生活并填写记录
    ↓
识别真实事件和任务完成证据
    ↓
用户确认后更新任务
    ↓
周期评估、形成可执行建议
    ↓
影响下一次计划
```

真正的 AI Native 体验应当减少用户操作，而不是增加一批“AI 按钮”。理想状态是：用户只需要表达目标、记录实际发生的事情、确认少量有歧义的判断，日织负责整理、匹配、提醒和提出下一步方案。

### 1.1 三类能力必须分工

| 能力 | 适合由谁完成 | 日织中的例子 |
| --- | --- | --- |
| 事实计算 | 本地确定性代码 | 日期边界、跨天任务、任务时长、完成率、时间冲突 |
| 语言理解 | LLM | 从日记识别事件、理解“晚上补了半小时单词”、解释偏差原因 |
| 约束优化 | 规则或优化器 | 在睡眠、上班、目标投入、休息上限等约束下安排时间 |
| 表达与沟通 | LLM | 润色、复盘、把统计结果转成自然且不过度指责的建议 |

不要让 LLM 重新计算本地已经可以准确计算的数据，也不要让它直接决定数据库中什么是真的。模型的输出首先是“候选解释”或“变更建议”。

### 1.2 从第一天就坚持的安全原则

1. API Key 不进入渲染进程、不写入源码、不提交 Git、不出现在日志中。
2. 日记正文、目标等隐私数据只发送完成当前功能所需的最小范围。
3. AI 输出先预览；早期阶段未经确认不得修改任务、目标、模板或长期记忆。
4. 每次写入都保存变更前内容，支持撤销。
5. 任务统计、时间统计和跨天规则以本地代码为准。
6. AI 无法判断时必须返回“不确定”，不能为了填满字段而猜测。
7. 模型供应商、模型名称和提示词版本均可替换，业务层不依赖某一家厂商。

## 2. 第一部分：从零调用主流大模型 API

这一部分先在独立脚本中完成，不读取日织数据，也不接 UI。只有最小调用稳定后，才接入 Electron。

### 2.1 需要先理解的八个概念

- **API**：程序之间约定好的调用方式。日织发送请求，模型服务返回结果。
- **API Key**：调用者身份凭证，等同于密码，泄露后别人可能消耗你的额度。
- **模型 ID**：指定使用哪个模型。模型名称会更新，不能散落在业务代码中。
- **输入上下文**：本次发给模型的指令和数据。上下文越长，成本和隐私风险通常越高。
- **Token**：模型计费和上下文长度的基本单位，不等同于一个汉字或一个单词。
- **结构化输出**：要求模型按 JSON Schema 返回固定字段，而不是返回难以解析的自由文本。
- **限流**：单位时间内允许的请求数或 Token 数有限，过快请求可能返回 429。
- **流式输出**：结果生成一部分显示一部分。它改善等待体验，但不是第一阶段的必需项。

### 2.2 先选择一家供应商跑通

建议第一个实验使用 OpenAI 的官方 JavaScript SDK 和 Responses API，原因是资料完整、结构化输出支持清晰，也适合 Node.js。跑通后再增加 Claude 和 Gemini 适配器，不要一开始同时调试三家。

| 供应商 | 官方 Node.js 包 | 主要调用入口 | 建议用途 |
| --- | --- | --- | --- |
| OpenAI | `openai` | Responses API | 作为第一个完整示例 |
| Anthropic Claude | `@anthropic-ai/sdk` | Messages API | 验证多供应商适配层 |
| Google Gemini | `@google/genai` | Gemini API | 验证第三种返回格式和模型配置 |

供应商的模型、价格和 API 细节会变化。实际开发时应从供应商控制台选择当前账户可用的模型，并通过设置或环境变量传入，不在文档和业务代码中长期写死某个模型 ID。

### 2.3 第一次 OpenAI API 调用

#### 第一步：创建项目、密钥和消费上限

1. 在 OpenAI 开发者平台创建 API 项目。
2. 为开发环境创建单独的 API Key，不与未来生产环境共用。
3. 设置较低的项目消费上限和告警。
4. 复制密钥后妥善保存。以后界面通常不会再次显示完整密钥。

官方入口与教程见文末“官方资料”。

#### 第二步：只在当前 PowerShell 会话设置环境变量

```powershell
$env:OPENAI_API_KEY="在这里粘贴密钥"
$env:RIZHI_LLM_MODEL="在控制台选择的模型ID"
```

这两个变量只在当前终端有效，关闭终端后消失，适合第一次实验。确认是否存在时，只检查长度，不要打印完整密钥：

```powershell
$env:OPENAI_API_KEY.Length
$env:RIZHI_LLM_MODEL
```

如果以后使用 `.env` 文件，必须先确保 `.env`、`.env.*` 已加入 `.gitignore`。即使已经忽略，也不要截图或把文件发给别人。

#### 第三步：安装 SDK

在项目目录执行：

```powershell
npm install openai zod
```

`openai` 用于请求 API，`zod` 用于定义和验证结构化数据。安装行为会修改 `package.json` 和 `package-lock.json`，应在正式开始该阶段时单独提交。

#### 第四步：建立无业务数据的冒烟测试

正式开发时可新建 `scripts/llm-smoke-test.mjs`：

```js
import OpenAI from 'openai';

const model = process.env.RIZHI_LLM_MODEL;
if (!process.env.OPENAI_API_KEY) {
  throw new Error('缺少 OPENAI_API_KEY');
}
if (!model) {
  throw new Error('缺少 RIZHI_LLM_MODEL');
}

const client = new OpenAI();
const response = await client.responses.create({
  model,
  input: '请只回复：日织 API 连接成功。'
});

console.log(response.output_text);
```

运行：

```powershell
node scripts/llm-smoke-test.mjs
```

成功标准不是模型写得多好，而是：请求能够返回、密钥没有写入文件、错误能够被看懂、控制台没有输出隐私内容。

#### 第五步：认识常见错误

| 表现 | 常见原因 | 应对方式 |
| --- | --- | --- |
| 401 | Key 错误、撤销或项目不匹配 | 检查环境变量和控制台中的 Key 状态 |
| 403 | 权限、地区或项目策略限制 | 检查供应商控制台与官方说明 |
| 429 | 请求过快、额度或消费上限耗尽 | 区分限流与余额问题；只有临时限流才重试 |
| 500/503 | 供应商临时故障或模型过载 | 尊重 `Retry-After`，有限次数退避重试 |
| 超时/网络错误 | 网络、代理、防火墙或请求过长 | 缩短输入、设置超时、检查网络 |
| 返回空或截断 | 输出额度不足、请求取消或模型拒绝 | 检查响应状态，不把空结果写入业务数据 |

日志可以记录时间、功能名、模型、耗时、输入输出 Token、稳定错误码和供应商请求 ID；默认不要记录 API Key、Authorization Header、完整日记和完整原始响应。

### 2.4 第二次实验：结构化输出

日织的“识别日记并更新任务”不能依赖一段自然语言结果，必须返回可校验的结构。以下是教学示例：

```js
import OpenAI from 'openai';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';

const client = new OpenAI();
const model = process.env.RIZHI_LLM_MODEL;

const JournalExtraction = z.object({
  events: z.array(z.object({
    title: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    evidence: z.string(),
    certainty: z.enum(['certain', 'likely', 'uncertain'])
  })),
  unresolvedText: z.array(z.string())
});

const response = await client.responses.parse({
  model,
  input: [
    {
      role: 'system',
      content: '只提取原文明确支持的事件；无法确认时间时返回 null，不得猜测。'
    },
    {
      role: 'user',
      content: '晚饭后看了四十分钟书，原定的跑步没有进行。'
    }
  ],
  text: {
    format: zodTextFormat(JournalExtraction, 'journal_extraction')
  }
});

console.dir(response.output_parsed, { depth: null });
```

这里必须进一步理解：结构化输出保证“形状正确”，不保证“事实一定正确”。例如模型仍可能错误理解“晚饭后”的时间，因此结果还要经过本地规则、候选任务匹配和用户确认。

### 2.5 再接入 Claude 和 Gemini

不要把三家 SDK 的调用写进功能代码，而是先定义统一接口：

```js
class ModelProvider {
  async generateText(request) {}
  async generateStructured(request) {}
  async testConnection() {}
}
```

`request` 至少包含：

```js
{
  purpose,       // polish_journal、extract_events 等
  model,
  instructions,
  input,
  schema,
  timeoutMs,
  signal
}
```

然后分别实现 `OpenAIProvider`、`AnthropicProvider` 和 `GeminiProvider`。业务功能只调用 `ModelProvider`，不判断供应商名称。各厂商最小调用方式如下：

```js
// Claude：npm install @anthropic-ai/sdk
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic(); // 默认读取 ANTHROPIC_API_KEY
const message = await client.messages.create({
  model: process.env.RIZHI_LLM_MODEL,
  max_tokens: 512,
  messages: [{ role: 'user', content: '只回复连接成功' }]
});
```

```js
// Gemini：npm install @google/genai
import { GoogleGenAI } from '@google/genai';
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const response = await client.models.generateContent({
  model: process.env.RIZHI_LLM_MODEL,
  contents: '只回复连接成功'
});
console.log(response.text);
```

这些示例用于理解差异。真正实现时必须再次核对对应供应商的最新官方文档，并为每家适配器写 Mock 测试。不要假设三家对超时、重试、结构化输出、用量字段和拒绝响应的处理完全相同。

### 2.6 Electron 中正确的调用路径

日织不是普通 Node.js 脚本。渲染层相当于浏览器环境，绝不能直接持有密钥。应沿用仓库已有边界：

```text
renderer 页面
  -> preload 暴露的窄接口
  -> main 进程 IPC（校验调用来源和参数）
  -> src/ai 中的 feature
  -> Provider 适配器
  -> 外部模型 API
```

例如 preload 只暴露：

```js
ai: {
  getStatus: () => ipcRenderer.invoke('ai:get-status'),
  testConnection: () => ipcRenderer.invoke('ai:test-connection'),
  polishJournal: (payload) => ipcRenderer.invoke('ai:polish-journal', payload),
  cancel: (requestId) => ipcRenderer.invoke('ai:cancel', requestId)
}
```

它不能提供 `getApiKey()`，也不能允许页面传任意 URL、任意请求头或任意本地文件路径。

开发时可以使用环境变量；提供 BYOK 设置后，用 Electron `safeStorage` 加密密钥，并只把密文写入本地设置。界面只能读取“已配置/未配置”和密钥尾号等非敏感状态。若未来由日织提供统一模型服务，开发者 Key 必须放在服务端，由客户端携带用户令牌请求日织后端。

### 2.7 在进入产品开发前完成的 API 学习验收

- [ ] 能用 PowerShell 环境变量完成一次最小请求。
- [ ] 能解释 401、429、超时和 5xx 的差别。
- [ ] 能得到一份通过 Zod 校验的结构化结果。
- [ ] 能取消一个请求并保持原数据不变。
- [ ] 能证明渲染进程和日志中没有 API Key。
- [ ] 能用 Mock Provider 在没有网络、没有消费额度时跑自动测试。
- [ ] 能把供应商原始错误转换为 `src/ai/contracts.js` 中的稳定错误码。

## 3. 第二部分：日织 AI 模块的总体设计

仓库已经建立了 `src/ai` 契约和目录骨架。后续应扩展现有设计，而不是在 `renderer.js` 中直接堆模型调用。

建议逐步形成以下模块：

```text
src/ai/
├─ contracts.js                 # 跨 IPC 的稳定动作、状态和错误码
├─ aiService.js                 # 请求编排、取消、超时、日志
├─ features/
│  ├─ journalPolisher.js
│  ├─ journalContinuation.js
│  ├─ journalComposer.js
│  ├─ journalEventExtractor.js
│  ├─ taskUpdateProposer.js
│  ├─ goalProgressEvaluator.js
│  ├─ periodicCoach.js
│  ├─ periodicReportGenerator.js
│  └─ scheduleAdjustmentProposer.js
├─ context/
│  ├─ buildJournalContext.js
│  ├─ buildDailyTimelineContext.js
│  ├─ buildReportContext.js
│  ├─ buildGoalContext.js
│  ├─ buildDailyReviewContext.js
│  └─ buildPlanningContext.js
├─ timeline/
│  ├─ buildDailyTimeline.js
│  ├─ matchEventsToTasks.js
│  └─ detectTimelineConflicts.js
├─ prompts/                     # 提示词带版本号
├─ schemas/                     # 结构化输出 Schema
├─ validation/                  # 输入、输出和业务约束二次校验
├─ memory/
│  ├─ memoryCandidateExtractor.js
│  ├─ memoryRepository.js
│  └─ memorySelector.js
├─ planning/
│  ├─ buildPlanningConstraints.js
│  ├─ scheduleOptimizer.js
│  └─ explainSchedule.js
└─ evals/                       # 固定样例、预期结果和评分脚本

src/modelProviders/
├─ providerRegistry.js
├─ openAiProvider.js
├─ anthropicProvider.js
├─ geminiProvider.js
├─ managedProvider.js
└─ providerErrors.js

src/media/
├─ mediaAnnotation.js
└─ mediaAnnotationValidation.js
```

目录不需要一次建完。每个阶段只增加实际使用并有测试的文件。

### 3.1 核心业务对象

#### 目标不是一句口号

一个可被评估的目标至少应包含：

```js
{
  id,
  title,
  horizon: 'short' | 'long',
  startDate,
  targetDate,
  desiredOutcome,
  requiredEfforts: [
    {
      description,
      categoryId,
      minimumMinutesPerWeek,
      targetMinutesPerWeek,
      targetFrequencyPerWeek,
      evidenceRule
    }
  ],
  guardrails: {
    maximumMinutesPerDay,
    minimumSleepMinutes,
    restDaysPerWeek
  }
}
```

LLM 可以帮助用户把自然语言目标拆成候选投入项，但用户必须确认。数值是否达成由本地统计判断。

#### 当日基调是计划约束，不是装饰标签

例如：

- **休闲日**：只保留必要任务，不因为目标投入偏低而批评用户。
- **平衡日**：完成最低投入，并保留明确休息时间。
- **用功日**：允许更高目标投入，但仍遵守睡眠和最大负荷。
- **恢复日**：降低任务密度，优先睡眠、饮食和低压力活动。

每种基调应转换为本地可计算的预算和限制，LLM 只负责解释为什么某项建议符合这一天的基调。

#### AI 变更必须是一笔事务

```js
{
  id,
  action: 'update_task_status',
  sourceDate,
  createdAt,
  proposals: [],
  beforeSnapshot: {},
  status: 'preview' | 'applied' | 'reverted'
}
```

这样才能做到批量预览、一次确认、整体撤销和问题追踪。

### 3.2 结构化媒体注释与确定性时间线

图片、动态图片和视频不能因为接入 AI 就直接上传。第一步仍然是由用户选择是否让 AI 使用，并为素材提供可追溯的文字信息：

```js
{
  annotation,
  timeline: {
    eventTime,
    eventTitle,
    relatedTaskId,
    includeInAi
  }
}
```

旧媒体数据可能没有 `timeline`，加载时必须兼容并补充默认值，不能破坏原附件。删除关联任务后保留注释，同时把关联显示为已失效。

在调用模型前，由本地时间线模块合并任务、任务状态、任务备注、日记事件和媒体注释。匹配优先级为：用户明确关联任务 > 时间只落入一个任务 > 多候选或无法确定。跨天、重叠、缺失时间和失效引用都要显式标记；同一输入必须得到相同顺序和冲突结果。

默认只向模型发送结构化文字，不发送媒体二进制、本地文件路径或关闭了 `includeInAi` 的素材。未来增加多模态识别时，也应作为用户单独授权的新阶段，而不是悄悄改变这一边界。

## 4. 分阶段开发路线

下面的顺序按风险和依赖关系排列。不要先做“全自动智能安排”，因为它依赖前面所有基础能力。

### 阶段 0：固定 v1.2.0 基线和评测样例

目标：在接 API 前建立可比较的起点。

实施：

- 记录 v1.2.0 当前任务、目标、基调、记录和模板数据结构。
- 准备 30～50 条脱敏日记样例，覆盖完成、未完成、改期、部分完成、跨天、模糊时间和无关闲聊。
- 为每条样例人工标注“应该识别哪些事件”“应该匹配哪个任务”“哪些内容无法判断”。
- 建立 AI 功能开关，默认关闭实验功能。

完成标准：现有 `npm run check` 通过，测试样例不含真实姓名、密钥和敏感附件。

### 阶段 1：模型基础设施与设置页

目标：建立安全、可替换、可观察，但尚不修改业务数据的调用链。

实施：

- Provider 统一接口，先实现 OpenAI，再用 Mock Provider 测试。
- AI 设置页：供应商、模型、连接状态、超时、清除 Key。
- `safeStorage` 密钥保存；main IPC 权限校验；取消请求。
- 稳定错误码、有限重试、并发限制、Token 与耗时记录。
- 连接测试只发送固定短句，不读取日记。

暂不做：流式输出、多模型自动路由、会员、向量数据库。

完成标准：错误 Key、无网络、限流、超时、取消均有明确提示，任何路径都不泄露密钥。

### 阶段 2：文本润色与续写——第一个低风险闭环

目标：让用户感知价值，同时验证完整 UI 流程。

流程：选择文本或当前记录 → 选择润色或续写 → 对比原文与结果 → 用户编辑 → 添加或替换 → 可撤销。

约束：

- 默认不改变事实、数字、时间、人物和否定关系。
- 续写只能使用用户已确认的任务、记录和结构化上下文；信息不足时不得补造事件。
- 不自动保存；请求失败时原文不动。
- 记录提示词版本、模型和耗时，但不默认保存完整正文。

它的意义主要是验证基础设施，不应被当作日织 AI Native 的核心卖点。

### 阶段 3：结构化事件、媒体注释与时间线，只读预览

目标：从每日记录和用户允许使用的媒体注释中整理结构化事件，但不更新任务。

模型输出至少包含：事件标题、可能时间、持续时间、类别候选、原文证据、确定度、是否明确提到完成状态。

本地代码负责：

- 规范化日期和时间；
- 兼容旧媒体数据，过滤未授权素材和本地文件路径；
- 按“明确关联优先、单一时间匹配其次”构建确定性时间线；
- 根据任务标题、分类、时间重叠和别名生成候选任务；
- 检查模型引用的原文证据是否真的存在；
- 标记跨天和时间冲突。

界面应把“模型识别”和“任务匹配”分开显示，允许用户纠正。

在这条时间线稳定后，可以增加“素材成文”：生成前显示本次使用的任务数、日记事件数、媒体注释数和冲突数；模型必须区分计划、已完成、部分完成、未完成和未确认；生成结果只进入可编辑草稿，不自动保存。

完成标准：在固定样例上重复运行，输出结构和冲突结果稳定；任何识别错误都不会改变任务；关闭 `includeInAi` 的素材绝不进入上下文。

### 阶段 4：任务状态变更建议

目标：用户写完记录后，日织提出可一次确认的任务更新。

建议使用两段式判断：

1. 本地匹配器找出候选任务和确定性证据。
2. LLM 只在有多个候选或自然语言较复杂时消歧。

每条建议显示：原任务、建议状态、原文证据、匹配理由和置信等级。处理策略：

| 情况 | 行为 |
| --- | --- |
| 标题和时间明确对应，原文明说完成 | 默认勾选，仍需用户整体确认 |
| 只提到做过，但程度不明 | 建议“部分完成”或保持未确认 |
| 多个任务都可能匹配 | 要求用户选择 |
| 原文没有证据 | 不提出状态变更 |
| 与现有状态冲突 | 明确显示冲突，不静默覆盖 |

采用后形成一笔可撤销事务。早期版本不提供后台静默修改。

### 阶段 5：目标投入模型与周期评估

目标：让长期/短期目标真正影响任务与复盘。

实施顺序：

1. 让用户为目标确认“必要投入”，包括频率、时间、里程碑和休息护栏。
2. 任务可关联一个或多个目标投入项。
3. 本地统计周期内的计划投入和已确认完成情况。
4. LLM 根据确定性统计生成解释和一条可执行建议。

评估不能只说“学习时间不足”。应能表达：

```text
本周目标要求：三次英语学习，每次至少 30 分钟。
已确认完成：两次，共 75 分钟。
差距：频率少一次，累计时间已经达到最低值。
建议：下周优先增加一次短学习，不必再延长已有两次。
```

同时考虑当日基调和护栏。休闲日不应被评价为“不够努力”；连续高负荷、睡眠不足或计划拥挤时，应建议减量而不是继续加任务。

### 阶段 6：个性化教练与可解释建议

目标：从“展示统计”升级为“帮助用户决定下一步”。

每次周期复盘最多突出一到三项真正重要的内容：

- 哪个目标投入最需要调整；
- 哪类计划经常改期或无法完成；
- 负荷是否与睡眠、基调冲突；
- 下一周期应该增加、保持还是减少什么。

确定性代码提供数字，LLM 负责把数字、用户记录和目标背景组织为自然语言。建议必须附带依据，用户可以点回相关日期和任务。

评价质量不看文章长度，而看“建议采用率”“用户修改率”和“采用后是否减少计划偏差”。

这一阶段同时统一日报、周报、月报、季报和年报：

- 任务数量、状态分布、分类和计划时长全部由本地代码计算；计划时长不能写成实际投入时长。
- 报告上下文可以包含用户允许使用的日记、任务备注、标签和媒体事件摘要。
- 先完成日报，再复用同一管线扩展其他周期，周期边界必须与统计页一致。
- 报告单独保存，不混入普通日记；支持编辑、重新生成、复制和删除。
- 保存 `sourceFingerprint`。源任务或记录变化后，旧报告应提示“数据已经更新”，不能伪装成当前结论。
- 空周期、跨月周、跨年周和少量数据都要有测试；数据不足时明确说明，而不是凑出建议。

### 阶段 7：可管理的长期记忆

目标：让日织记住稳定偏好和反复模式，而不是每次从零开始。

长期记忆不要等同于把所有日记放进向量数据库。先使用小而明确的结构：

```js
{
  id,
  type: 'preference' | 'constraint' | 'habit' | 'pattern',
  content,
  evidenceRefs: [],
  confidence,
  createdAt,
  lastConfirmedAt,
  expiresAt,
  status: 'candidate' | 'confirmed' | 'rejected'
}
```

例子：

- 偏好：用户更愿意在晚饭后阅读。
- 约束：周一到周五 13:00～21:30 通常上班。
- 模式：连续安排三项高强度学习时，最后一项经常改期。
- 非记忆：某一天心情不好，不应自动上升为长期性格判断。

记忆候选必须显示来源并由用户确认；设置页提供查看、修改、停用和删除。过期记忆不再参与计划。向量检索只在记忆量明显增大、关键词检索不足时再加入。

### 阶段 8：计划调整建议与约束优化

目标：根据目标、基调、固定安排、历史完成模式和临时变化，提出更可行的日程。

不要让 LLM 直接自由生成整天时间表。建议管线：

```text
LLM 把自然语言需求转换为结构化约束
    ↓
本地规则检查固定任务、跨天规则和冲突
    ↓
启发式算法或约束优化器产生候选日程
    ↓
LLM 解释取舍
    ↓
用户预览差异并确认写入
```

第一版可使用简单启发式算法：固定任务不可移动；先满足睡眠和必要事项；再分配目标最低投入；最后填入弹性任务和休息。数据和约束稳定后，可以研究 OR-Tools CP-SAT 等优化技术。这比“让模型猜时间”更能体现算法岗位能力。

完成标准：任何建议都不产生时间重叠；能解释移动了什么、为什么移动；用户可以只接受其中一部分。

### 阶段 9：有限自治，而不是突然全自动

可以把 AI 权限分级：

| 等级 | 权限 |
| --- | --- |
| L0 | 只分析和展示，不产生变更 |
| L1 | 生成变更建议，用户逐项确认 |
| L2 | 默认选中高置信建议，用户一次确认 |
| L3 | 对用户明确授权的低风险动作自动执行，并可撤销 |

例如“从日记识别到明确完成”可以逐步升到 L2；删除任务、改目标、修改长期记忆、批量移动日程不应自动升到 L3。升级权限必须以评测数据和用户主动选择为依据。

### 阶段 10：多设备与服务端（可选，并非 AI Native 前置条件）

日织可以继续本地优先：BYOK 模式由 Electron 主进程直接调用模型，用户数据留在本机，只有本次必要上下文发送给模型供应商。

以下情况才需要日织自己的服务器：

- 提供开发者统一付费的模型额度；
- 账号、会员和跨设备同步；
- 多设备异步访问同一份数据；
- 服务端推送或跨设备自动化。

隐私友好的同步方案可以是端到端加密：设备首次通过二维码交换设备公钥和同步密钥；本地加密后上传；服务器只存密文和同步元数据。纯设备间扫码直传虽然不需要服务器保存正文，但要求设备同时在线，对离线同步、历史恢复和冲突合并不友好。更现实的是“二维码配对 + 加密中继服务器”。

服务端属于后期基础设施，不应抢在产品闭环之前开发。一个没有明显使用价值的应用，即使拥有登录、数据库和云服务器，也不会因此更有吸引力。

如果未来提供“日织托管模型”，还需要实现 `managedProvider`，但客户端安装包中绝不能包含开发者模型 Key。服务端至少要具备用户认证、令牌刷新、会员或额度管理、模型代理、限流、审计、滥用防护、隐私政策和数据删除机制。会员到期或服务不可用不能影响用户读取本地任务、日记和历史报告；界面要明确显示当前使用 BYOK 还是托管模型，以及本次调用是否消耗额度。

### 阶段 11：发布前加固

目标：把“开发环境能用”提升到适合正式发布。

实施和验收：

- 限制请求长度、并发和重试次数，处理休眠恢复、网络切换、窗口关闭和软件退出。
- 清理敏感日志；崩溃报告、设置文件和安装包中不得出现明文密钥或完整日记。
- 保存提示词版本、Schema 版本、上下文版本和业务数据指纹，支持问题复现但不默认保存正文。
- 完成旧版本数据升级、打包安装、更新、卸载和重新安装测试。
- 用脱敏的超长文本、空数据、跨周期数据和故障 Provider 做稳定性测试。
- 更新 README、用户教程、隐私说明和每个 AI 功能的数据发送说明。

完成标准：完整自动测试、打包测试和旧数据兼容测试通过；密钥、隐私、异常恢复和回退路径经过人工检查。

## 5. 功能优先级总表

| 功能 | 直接用户价值 | LLM 角色 | 本地/算法角色 | 风险 | 前置阶段 |
| --- | --- | --- | --- | --- | --- |
| 文本润色 | 中 | 改写表达 | 保留原文、撤销 | 低 | 1 |
| 日记续写 | 中 | 按已确认上下文续写 | 上下文筛选、原文保留 | 中 | 1 |
| 素材成文 | 高 | 把可靠时间线组织成草稿 | 媒体授权、时间线与冲突检测 | 中 | 3 |
| 日记事件提取 | 高 | 理解自然语言 | 时间规范化、证据校验 | 中 | 1 |
| 任务状态建议 | 很高 | 复杂语义消歧 | 候选匹配、事务写入 | 高 | 3 |
| 目标投入拆解 | 高 | 生成候选要求 | 数值校验、用户确认 | 中 | 1 |
| 周期个性化建议 | 高 | 解释和建议 | 准确统计、趋势检测 | 中 | 5 |
| 周期报告 | 高 | 组织复盘文字 | 周期边界、统计、数据指纹 | 中 | 5 |
| 长期记忆 | 高 | 提取候选模式 | 生命周期、检索、删除 | 高 | 6 |
| 智能安排 | 很高 | 解析约束、解释取舍 | 规则/约束优化 | 很高 | 5、7 |
| 日织托管模型 | 间接 | 提供统一模型能力 | 认证、额度、代理与审计 | 很高 | 产品闭环稳定后 |
| 多设备同步 | 间接 | 通常不需要 | 加密、同步、冲突合并 | 很高 | 产品闭环稳定后 |

## 6. 评测：让“智能”可以被证明

AI 功能不能只靠“我试了一次感觉不错”。从阶段 0 开始维护脱敏评测集，并记录：

- `caseId` 与场景类型；
- 输入数据和期望结构；
- 允许存在的多种正确答案；
- 模型供应商、模型 ID、提示词版本和 Schema 版本；
- 实际输出、人工评分和错误类别；
- 耗时、Token 用量和估算成本。

关键指标：

| 功能 | 主要指标 |
| --- | --- |
| 事件提取 | 事件、时间、状态和证据字段的准确率/召回率 |
| 任务匹配 | 匹配准确率、歧义召回率、错误自动选中率 |
| 状态更新 | 用户采用率、修改率、撤销率、错误写入数 |
| 周期建议 | 建议采用率、重复建议率、是否能追溯到数据 |
| 周期报告 | 本地数字一致率、源数据变化检出率、事实错误数 |
| 智能安排 | 时间冲突数、计划变动量、用户保留比例 |
| 长期记忆 | 用户确认率、过期记忆误用率、删除后残留率 |

推荐的上线门槛：

1. 先在离线评测集运行。
2. 再进入“影子模式”，后台计算但不向业务写入。
3. 再开放只读预览。
4. 最后开放用户确认写入。
5. 只有低风险动作长期稳定后，才讨论自动执行。

不要只记录模型自报的 `confidence`。可信度应综合本地匹配分数、证据完整性、候选数量和评测表现。

## 7. 成本、性能与隐私控制

### 7.1 控制上下文

- 只发送当前功能需要的日期和字段。
- 统计数据先在本地聚合，不发送整个数据库。
- 长期记忆先筛选相关项，再加入上下文。
- 设置输入和输出长度上限。
- 同一输入、提示词和模型可以短期缓存，但缓存也属于隐私数据。

### 7.2 控制请求

- 同一功能限制并发；按钮进行中时避免重复点击。
- 429/503 只做有限次数指数退避，并尊重 `Retry-After`。
- 余额不足、Key 错误等需要用户处理的问题不自动重试。
- 支持 `AbortController` 取消请求。
- 软件退出、切换日期或关闭窗口时正确处理中断。

### 7.3 让用户知道发送了什么

第一次使用 AI 时说明：

- 使用的供应商；
- 本次发送的数据类型和日期范围；
- 是否包含日记、目标、任务详情或长期记忆；
- 数据由谁处理；
- 如何关闭 AI、清除 Key 和删除 AI 记忆。

对于特别私密的日记，应允许用户标记“禁止发送给 AI”。

## 8. 建议的学习与开发顺序

不要按日历赶进度，按“能否独立验收”推进：

1. **HTTP、JSON、异步和环境变量**：理解请求、响应和异常。
2. **API 冒烟测试**：只发固定短句。
3. **结构化输出**：用 Zod 得到稳定对象。
4. **Provider 适配层**：Mock + OpenAI，之后再加其他供应商。
5. **Electron IPC 安全链路**：Key 留在 main。
6. **文本润色纵向切片**：UI、调用、预览、采用、撤销全部走通。
7. **结构化注释与时间线**：先用本地代码整理任务、记录和获授权素材。
8. **日记事件评测集**：先评估，再接真实任务。
9. **任务变更事务**：建议、确认、写入、撤销。
10. **目标和基调评估**：确定性统计 + LLM 表达。
11. **周期报告、长期记忆和计划优化**：有了足够真实纠正数据后再做。

在前四个智能阶段完成前，暂时不要投入大量精力到 RAG、向量数据库、微调、复杂 Agent 框架或云端账号系统。它们都是工具，不是用户价值本身。微调也应等积累了足够多、获得用户授权且质量可靠的纠正样例后再评估。

## 9. 下一开发里程碑建议

可以把 v1.2.0 之后的第一个 AI 里程碑限制为：

- AI 设置页与 BYOK；
- OpenAI Provider 和 Mock Provider；
- 连接测试、超时、取消、错误映射；
- 日记润色的对比预览与撤销；
- 结构化事件提取的开发者预览，不修改任务；
- 至少 30 条脱敏评测样例；
- 隐私说明和“本条记录禁止 AI 使用”开关。

本里程碑明确不包含：自动更新任务、长期记忆、自动排程、会员、服务端同步。完成后再根据评测结果进入任务状态建议，能够显著降低一次性工程风险。

每个阶段结束时记录：

```text
阶段与版本：
实现范围：
非目标：
自动测试结果：
评测集结果：
人工验收案例：
已知错误：
隐私与密钥检查：
成本与延迟：
是否允许进入下一阶段：
```

## 10. 官方资料

以下链接用于实际编码前核对最新 API。不要依赖博客中已经过时的模型名和参数。

- [OpenAI Developer Quickstart](https://developers.openai.com/api/docs/quickstart)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [OpenAI API Overview 与密钥安全](https://developers.openai.com/api/reference/overview)
- [OpenAI Error Codes](https://developers.openai.com/api/docs/guides/error-codes)
- [OpenAI Rate Limits](https://developers.openai.com/api/docs/guides/rate-limits)
- [Anthropic API Overview](https://platform.claude.com/docs/en/api/overview)
- [Anthropic TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript)
- [Google Gemini API Get Started](https://ai.google.dev/gemini-api/docs/get-started)
- [Google Gemini Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output)

## 11. 文档维护方式

本文已经合并原 `AI功能实现指南_Version1.md` 中有关媒体注释、确定性时间线、日记续写、素材成文、周期报告、托管模型和发布加固的有效内容。自 2026-11-07 起，本文是日织 AI 开发的唯一总路线，不再维护两份并行指南。

后续讨论形成新决定时，应按以下顺序同步：

1. 先修改本文中的产品原则、阶段范围和完成标准。
2. 再修改 `src/ai`、`src/media` 和 `src/modelProviders` 下对应目录说明与契约。
3. 最后实施代码、测试和用户界面，避免文档、契约和实现使用不同概念。
4. 模块复杂到需要独立说明时可以新增专题文档，但专题文档不得重新定义总路线。

日织的核心竞争力不应是“使用了某个大模型”，而应是：能在尊重隐私和用户控制的前提下，把零散目标、计划和生活记录整理成可解释、可执行、持续改善的个人反馈闭环。
