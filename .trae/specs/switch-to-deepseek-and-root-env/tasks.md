# Tasks

- [x] Task 1: 重定位环境变量到仓库根
  - [x] SubTask 1.1: 在仓库根新增 `.env.example`，包含 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）、`MODEL`（默认 `deepseek-v4-pro`）、`PORT`（默认 `8787`）
  - [x] SubTask 1.2: 删除 `apps/server/.env.example`
  - [x] SubTask 1.3: 确认根 `.gitignore` 已忽略 `.env`（如缺失则补充）

- [x] Task 2: 改造后端 env 加载与校验
  - [x] SubTask 2.1: 更新 `apps/server/src/env.ts`：使用 `dotenv` 显式加载仓库根 `.env`（基于 `process.cwd()` 向上查找或使用相对路径 `../../.env`）
  - [x] SubTask 2.2: 校验并导出 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）、`MODEL`（默认 `deepseek-v4-pro`）、`PORT`
  - [x] SubTask 2.3: 删除对 `OPENAI_API_KEY` 的引用

- [x] Task 3: 将 Agents SDK 接入 DeepSeek
  - [x] SubTask 3.1: 在 `apps/server/src/index.ts`（或新增 `src/llm.ts`）中创建 OpenAI 兼容客户端，`apiKey = env.DEEPSEEK_API_KEY`，`baseURL = env.DEEPSEEK_BASE_URL`
  - [x] SubTask 3.2: 通过 `@openai/agents` 提供的方式（如 `setDefaultOpenAIClient` 或 Agent 构造参数）将该客户端设为默认 LLM 提供方
  - [x] SubTask 3.3: `novelPipeline.ts` 中三个 Agent 的 `model` 字段使用 `env.MODEL`（默认 `deepseek-v4-pro`）

- [x] Task 4: 验证
  - [x] SubTask 4.1: 运行 `pnpm -r typecheck` 通过
  - [x] SubTask 4.2: 运行 `pnpm --filter @novelloom/server dev`，未设置 `DEEPSEEK_API_KEY` 时确认进程立即退出并打印明确错误

# Task Dependencies
- Task 2 依赖 Task 1
- Task 3 依赖 Task 2
- Task 4 依赖 Task 3
