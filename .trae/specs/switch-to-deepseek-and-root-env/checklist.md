# Checklist

- [x] 仓库根存在 `.env.example`，包含 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`MODEL`、`PORT`
- [x] `apps/server/.env.example` 已删除
- [x] 后端启动时从仓库根 `.env` 加载环境变量
- [x] `apps/server/src/env.ts` 不再引用 `OPENAI_API_KEY`，改为 `DEEPSEEK_API_KEY` 并在缺失时退出
- [x] `MODEL` 默认值为 `deepseek-v4-pro`，`DEEPSEEK_BASE_URL` 默认值为 `https://api.deepseek.com`
- [x] Agents SDK 通过自定义 OpenAI 兼容客户端将请求路由到 DeepSeek 官方端点，鉴权使用 `DEEPSEEK_API_KEY`
- [x] `novelPipeline.ts` 中 Agent 使用 `env.MODEL`（默认 `deepseek-v4-pro`）
- [x] `pnpm -r typecheck` 全部通过
- [x] 未设置 `DEEPSEEK_API_KEY` 时后端启动会立即报错退出
