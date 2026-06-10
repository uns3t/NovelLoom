# Tasks

- [x] Task 1: 初始化 monorepo 骨架
  - [x] SubTask 1.1: 创建根 `package.json`（声明 `packageManager`、根 dev/build 脚本、`concurrently` devDependency）
  - [x] SubTask 1.2: 创建 `pnpm-workspace.yaml` 包含 `apps/*`、`packages/*`
  - [x] SubTask 1.3: 创建 `tsconfig.base.json`（strict、ES2022、moduleResolution=Bundler）
  - [x] SubTask 1.4: 创建根 `.gitignore`（node_modules、dist、.env、.DS_Store）

- [x] Task 2: 搭建 `packages/shared` 共享协议包
  - [x] SubTask 2.1: `package.json`（name `@novelloom/shared`，type=module，导出 `./src/index.ts`）
  - [x] SubTask 2.2: 定义 `RunNovelRequest` 类型与 SSE 事件联合类型 `AgentEvent`（`agent_started`/`token`/`tool_call`/`agent_finished`/`done`/`error`）
  - [x] SubTask 2.3: 添加 `tsconfig.json` 继承根配置

- [x] Task 3: 搭建 `apps/server` 后端服务
  - [x] SubTask 3.1: `package.json`（fastify、@fastify/cors、@openai/agents、zod、dotenv、tsx）
  - [x] SubTask 3.2: 创建 `src/env.ts` 启动时校验 `OPENAI_API_KEY`，缺失则退出
  - [x] SubTask 3.3: 创建 `src/agents/novelPipeline.ts`：定义构思 / 大纲 / 章节写作三个 Agent 与编排逻辑
  - [x] SubTask 3.4: 创建 `src/routes/novel.ts`：`POST /api/novel/run` 通过 `reply.raw` 输出 SSE，将 Agents SDK 流事件映射为共享 `AgentEvent`
  - [x] SubTask 3.5: 创建 `src/index.ts` 启动 Fastify，注册 CORS 与路由
  - [x] SubTask 3.6: 添加 `.env.example`、`tsconfig.json`、`dev` 脚本（tsx watch）

- [x] Task 4: 搭建 `apps/web` 前端工作台
  - [x] SubTask 4.1: 用 Vite React-TS 模板初始化（手写最小 `package.json` + `vite.config.ts` + `index.html` + `src/main.tsx`，避免使用 create 命令）
  - [x] SubTask 4.2: 在 `vite.config.ts` 配置 `server.proxy['/api']` 指向后端
  - [x] SubTask 4.3: 实现 `src/api/runNovel.ts`：用 `fetch` + `ReadableStream` 解析 SSE，回调发出 `AgentEvent`
  - [x] SubTask 4.4: 实现 `src/App.tsx`：左侧设定输入 + 「开始创作」按钮，右侧按 Agent 分块渲染流式输出与最终章节
  - [x] SubTask 4.5: 引入 `@novelloom/shared` 类型，确保事件处理类型安全

- [x] Task 5: 联调与冒烟验证
  - [ ] SubTask 5.1: 在 `apps/server/.env` 配置真实 `OPENAI_API_KEY`，运行 `pnpm dev`（需开发者本地补充 key 后执行）
  - [ ] SubTask 5.2: 浏览器打开前端，输入示例 premise，确认收到流式事件并渲染最终章节（需开发者本地补充 key 后执行）
  - [x] SubTask 5.3: 验证 `pnpm -r typecheck` 全部通过

# Task Dependencies
- Task 2 / Task 3 / Task 4 都依赖 Task 1
- Task 3 与 Task 4 依赖 Task 2（共享类型）
- Task 5 依赖 Task 3 与 Task 4
- Task 3 与 Task 4 在 Task 2 完成后可并行进行
