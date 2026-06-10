# NovelLoom Harness 技术方案 Spec

## Why
NovelLoom 是一个面向小说创作的产品级 UI Harness：用户在前端工作台中描述创作意图，后端通过 OpenAI Agents SDK 编排多 Agent（构思、大纲、写作、润色等）协作完成长文本生成。当前仓库为空，需要先搭建一套清晰、可演进、端到端 TypeScript 的最小骨架，让后续创作功能能够顺利迭代。

## What Changes
- 初始化 pnpm workspace monorepo，统一 TypeScript 工具链。
- 新建 `apps/web`：基于 Vite + React + TypeScript 的小说创作前端工作台。
- 新建 `apps/server`：基于 Node.js + Fastify + `@openai/agents` SDK 的后端服务。
- 新建 `packages/shared`：跨端共享的类型与协议定义（Agent 事件、请求/响应 schema）。
- 提供端到端的 SSE 流式创作通路：前端发起一次创作请求，后端以 SSE 推送 Agent 流式 token、工具调用、阶段事件。
- 提供最小可运行的「构思 → 大纲 → 章节草稿」三 Agent 编排示例，验证骨架可用。
- 提供 `.env.example`、根 `README` 之外**不**新增多余文档。

## Impact
- 影响范围：整个仓库结构（首次落地）。
- 关键文件/系统：
  - 根 `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`
  - `apps/web/`（Vite + React 应用）
  - `apps/server/`（Fastify + Agents SDK 服务）
  - `packages/shared/`（共享类型）

## ADDED Requirements

### Requirement: Monorepo 骨架
The system SHALL 以 pnpm workspace 形式组织 `apps/web`、`apps/server`、`packages/shared` 三个工作区，并通过根 `tsconfig.base.json` 统一 TS 编译选项。

#### Scenario: 一键安装与启动
- **WHEN** 开发者在仓库根目录执行 `pnpm install` 后再执行 `pnpm dev`
- **THEN** 前端 Vite dev server 与后端 Fastify dev server 同时启动，前端可通过代理访问后端 API

### Requirement: 后端 Agent 编排服务
The system SHALL 使用 `@openai/agents` SDK 在 `apps/server` 中实现一个最小创作流水线：构思 Agent → 大纲 Agent → 章节写作 Agent，并以 SSE 形式向前端流式返回执行事件。

#### Scenario: 流式创作请求
- **WHEN** 前端 POST `/api/novel/run` 携带 `{ premise: string }`
- **THEN** 后端建立 SSE 连接，按时间顺序推送 `agent_started`、`token`、`tool_call`、`agent_finished`、`done` 等事件，事件 schema 来自 `packages/shared`

### Requirement: 前端创作工作台
The system SHALL 提供一个 React 页面：左侧输入小说设定 / 触发按钮，右侧实时展示当前 Agent 名称、流式输出文本与阶段切换。

#### Scenario: 实时查看创作过程
- **WHEN** 用户填写设定并点击「开始创作」
- **THEN** 页面通过 `EventSource`/`fetch` SSE 订阅后端事件，实时渲染各 Agent 的输出，并在 `done` 事件后展示完整章节草稿

### Requirement: 共享协议包
The system SHALL 在 `packages/shared` 中导出 SSE 事件、请求体的 TypeScript 类型与（可选的）zod schema，前后端均通过工作区依赖引用，杜绝重复定义。

#### Scenario: 类型一致性
- **WHEN** 后端修改某个事件字段
- **THEN** 前端 TypeScript 编译会立即报错，开发者必须同步更新前端处理逻辑

### Requirement: 环境变量与密钥
The system SHALL 通过 `apps/server/.env`（`OPENAI_API_KEY`、`PORT`、`MODEL` 等）注入运行时配置，仓库提供 `.env.example`，且 `.env` 加入 `.gitignore`。

#### Scenario: 本地启动校验
- **WHEN** 缺失 `OPENAI_API_KEY` 时启动后端
- **THEN** 服务在启动阶段抛出明确错误并退出，而不是在请求时才失败

## MODIFIED Requirements
（无，首次落地）

## REMOVED Requirements
（无）

## 技术选型摘要
- 语言：TypeScript（strict）
- 包管理：pnpm workspace
- 前端：Vite + React 18 + TypeScript；最小依赖，UI 暂用原生 + 少量 CSS Modules，不引入大型组件库
- 后端：Node.js ≥ 20 + Fastify + `@openai/agents`；使用 `@fastify/cors`，SSE 通过 Fastify 的 `reply.raw` 手写以保持依赖最少
- 共享：`packages/shared` 仅导出类型 + zod（如需要）
- 开发体验：根脚本 `pnpm dev` 借助 `concurrently` 同时启动前后端；前端 Vite 通过 `server.proxy` 将 `/api` 转发到后端
