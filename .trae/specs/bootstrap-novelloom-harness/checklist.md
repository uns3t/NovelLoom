# Checklist

- [x] 仓库根存在 `pnpm-workspace.yaml`、`tsconfig.base.json`、根 `package.json`，`pnpm install` 可成功
- [x] `apps/web`、`apps/server`、`packages/shared` 三个工作区结构完整，`tsconfig` 均继承根配置
- [x] `packages/shared` 导出 `RunNovelRequest` 与 `AgentEvent` 联合类型，并被前后端引用
- [x] 后端启动时若缺少 `OPENAI_API_KEY` 会立即报错退出
- [x] `POST /api/novel/run` 以 SSE 形式返回 `agent_started`/`token`/`tool_call`/`agent_finished`/`done` 事件，事件 schema 与 shared 一致
- [x] 后端使用 `@openai/agents` SDK 编排「构思 → 大纲 → 章节写作」三 Agent
- [x] 前端 Vite 配置 `/api` 代理到后端，且使用 React + TypeScript
- [x] 前端页面可输入设定、触发创作，并实时渲染各 Agent 的流式输出与最终章节
- [x] 根脚本 `pnpm dev` 可同时启动前后端
- [x] `pnpm -r typecheck`（或等价的 `tsc --noEmit`）全部通过
- [x] 仓库未提交 `.env` 等敏感文件，提供 `.env.example`
