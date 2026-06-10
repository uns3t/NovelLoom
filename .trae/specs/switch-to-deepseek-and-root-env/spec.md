# 切换到 DeepSeek 与根目录环境变量 Spec

## Why
当前后端环境变量位于 `apps/server/.env.example`，在 monorepo 根操作不便；同时项目仅需对接 DeepSeek 官方 API（OpenAI 兼容接口），不再依赖 OpenAI 服务。需要把环境变量提到仓库根，并将模型层切换为 DeepSeek。

## What Changes
- 在仓库根新增 `.env.example`，集中声明 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`MODEL`、`PORT`。
- **BREAKING** 删除 `apps/server/.env.example`，不再在 `apps/server` 下读取 `.env`；后端启动时改为加载仓库根的 `.env`。
- **BREAKING** 重命名 `OPENAI_API_KEY` → `DEEPSEEK_API_KEY`；默认模型改为 DeepSeek V4 Pro（环境变量 `MODEL` 默认值 `deepseek-v4-pro`，可被覆盖）。
- 将 `@openai/agents` SDK 的底层 OpenAI 客户端 baseURL 指向 `https://api.deepseek.com`（默认值，可由 `DEEPSEEK_BASE_URL` 覆盖），并使用 `DEEPSEEK_API_KEY` 鉴权，从而直接请求 DeepSeek 官网。
- 更新 `apps/server/src/env.ts` 反映新变量；同步更新使用处（`novelPipeline.ts` 与 `index.ts` 启动配置）。
- 更新根 `.gitignore` 已包含 `.env`，确保根 `.env` 不入库。

## Impact
- Affected specs: bootstrap-novelloom-harness 中「环境变量与密钥」「后端 Agent 编排服务」两条需求。
- Affected code:
  - `.env.example`（根，新增）
  - `apps/server/.env.example`（删除）
  - [apps/server/src/env.ts](file:///Users/bytedance/study/NovelLoom/apps/server/src/env.ts)
  - [apps/server/src/agents/novelPipeline.ts](file:///Users/bytedance/study/NovelLoom/apps/server/src/agents/novelPipeline.ts)
  - [apps/server/src/index.ts](file:///Users/bytedance/study/NovelLoom/apps/server/src/index.ts)（如需在启动期注册自定义 OpenAI client）

## ADDED Requirements

### Requirement: 根目录环境变量
The system SHALL 在仓库根提供 `.env.example`，并由后端在启动时加载仓库根的 `.env`（通过 `dotenv` 指定 path）。

#### Scenario: 根 `.env` 生效
- **WHEN** 开发者在仓库根创建 `.env`，写入 `DEEPSEEK_API_KEY=...`
- **THEN** 在仓库根执行 `pnpm dev` 时，后端能读取到该变量并成功启动

### Requirement: DeepSeek-only 模型层
The system SHALL 仅通过 DeepSeek 官方 API（OpenAI 兼容接口）调用模型，默认模型为 `deepseek-v4-pro`，鉴权使用 `DEEPSEEK_API_KEY`，baseURL 默认 `https://api.deepseek.com`。

#### Scenario: 直接请求 DeepSeek
- **WHEN** 后端执行任何 Agent 调用
- **THEN** HTTP 请求目的地为 `https://api.deepseek.com/...`，请求头携带 `Authorization: Bearer ${DEEPSEEK_API_KEY}`，请求体中的 `model` 字段为 `deepseek-v4-pro`（或 `MODEL` 覆盖值）

### Requirement: 启动期密钥校验
The system SHALL 在后端启动时校验 `DEEPSEEK_API_KEY`，缺失则报错并以非零状态退出。

#### Scenario: 缺失 key
- **WHEN** 启动后端但未设置 `DEEPSEEK_API_KEY`
- **THEN** 进程立即输出明确错误信息并退出，而不是在请求时才失败

## MODIFIED Requirements

### Requirement: 环境变量与密钥
The system SHALL 通过仓库根 `.env`（`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`MODEL`、`PORT`）注入运行时配置；仓库提供根 `.env.example`，根 `.gitignore` 忽略 `.env`。`apps/server/.env*` 不再使用。

#### Scenario: 本地启动校验
- **WHEN** 仓库根缺失 `DEEPSEEK_API_KEY` 时启动后端
- **THEN** 服务在启动阶段抛出明确错误并退出

### Requirement: 后端 Agent 编排服务
The system SHALL 使用 `@openai/agents` SDK 配合 DeepSeek OpenAI 兼容端点实现「构思 → 大纲 → 章节写作」流水线，并以 SSE 形式向前端流式返回事件。

#### Scenario: 流式创作请求
- **WHEN** 前端 POST `/api/novel/run` 携带 `{ premise: string }`
- **THEN** 后端通过 DeepSeek API 完成三段式生成，并按事件 schema 推送 SSE 流

## REMOVED Requirements

### Requirement: 使用 OpenAI 服务
**Reason**: 项目只对接 DeepSeek。
**Migration**: 用 `DEEPSEEK_API_KEY` 替代 `OPENAI_API_KEY`；模型名改为 `deepseek-v4-pro`；baseURL 显式设为 `https://api.deepseek.com`。
