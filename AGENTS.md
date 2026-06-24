# AGENTS.md
本文件面向后续参与 NovelLoom 开发的 AI Agent。开始任何开发任务前，先阅读本文件，再按任务范围阅读相关源码和 `.trae` 下的规格/计划文档。
## 项目定位
NovelLoom 是一个小说创作工作台，当前重点是本地开发和原型迭代。
已具备的核心能力：
- 书籍管理。
- Markdown 项目文件创作台。
- AI 协作写作面板。
- 本地文件系统持久化。
- DeepSeek / OpenAI-compatible 模型接入。
不要默认假设项目已有生产级认证、权限、多用户、云端同步、数据库迁移或部署体系。除非任务明确要求，不要主动引入这些大型能力。
## 当前功能
### 书籍管理
- 前端可以展示书籍列表、创建书籍、删除书籍，并进入单本书的创作台。
- 后端会为新书生成 `book.json`、`chapters`、默认 `idea.md`、`plot.md`、`novel-spec.md`、`style-sample.md`、`story-status.md` 和 `outline/`。
- `plot.md` 用于长期剧情走向、主线支线、伏笔回收、反转和剧情点子池；`style-sample.md` 用于写作风格样例；`novel-spec.md` 只管规格、文风、篇幅和创作规则。
### 创作台
- 展示单本书的项目文件树。
- 支持读取、编辑、保存和预览 Markdown 文件。
- 支持脏状态保护，避免未保存内容被意外覆盖。
### 项目文件管理
- 后端提供文件树、文件读取、文件写入、创建、重命名和删除能力。
- 项目文件路径使用 `/` 分隔。
- 文件路径禁止绝对路径、空片段、尾随 `/`、`.` 和 `..`。
- 路径校验规则位于共享包，跨端修改时必须保持一致。
### AI 协作
- 后端提供 `POST /api/books/:bookId/ai-workspace-runs` 创建 AI 工作台运行，并通过查询和取消接口管理运行状态。
- AI 工作台可以读取和变更项目文件。
- 前端 AI 协作面板包含 `/plan`、`/plot`、`/out`、`/detail`、`/state`、`/check`、`/next`、`/edit`、`/ask` 等快捷命令。
- 快捷命令发送给 AI 的展开 prompt 必须保持精简：单条命令只写该命令特有目标和边界，共用规则放到统一通用边界或后端系统提示词，避免在每条命令中重复。
- 新增或修改 `AI_SLASH_COMMANDS` 时，必须检查实际展开 prompt 长度；除非任务明确要求，单条命令 prompt 应维持在当前压缩版量级，避免超过旧版长度的 50%。
- `plot.md` 相关的快捷指令层约束只放在 `/plot`；其它快捷命令不要要求读取、写入或同步 `plot.md`。
- AI 工作台统一使用 `MODEL` 配置的 DeepSeek / OpenAI-compatible 模型，不再按 Flash/Pro 自动路由。
- AI 工作台不额外设置 DeepSeek `reasoning_effort` 或 thinking provider options，使用模型服务默认行为。
- AI 相关变更需要考虑文件刷新、流式响应、编辑器脏状态，以及 `plot.md`、`style-sample.md`、`story-status.md`、`outline/` 的职责边界。
### 本地持久化与模型
- 后端直接读写本地文件系统。
- 默认书籍数据目录是仓库根目录下的 `data/books`。
- 模型接入使用 DeepSeek / OpenAI-compatible endpoint。
- 模型配置从仓库根目录 `.env` 读取。
## 技术栈
### Monorepo
- TypeScript。
- pnpm workspace。
- workspace 包范围为 `apps/*` 和 `packages/*`。
- 包管理器声明为 `pnpm@9.12.0`。
### 前端
- 路径：`apps/web`。
- 主要依赖：React 18、Vite 5、`@ai-sdk/react`、`@uiw/react-md-editor`、`lucide-react`。
- 依赖共享包 `@novelloom/shared`。
### 后端
- 路径：`apps/server`。
- 主要依赖：Fastify 5、Zod、dotenv、AI SDK、OpenAI-compatible provider、DeepSeek、`@openai/agents`。
- 依赖共享包 `@novelloom/shared`。
### 共享包
- 路径：`packages/shared`。
- 包名：`@novelloom/shared`。
- 入口：`packages/shared/src/index.ts`。
- 职责：共享类型、请求体类型、响应结构和校验常量。
## 仓库结构
- `apps/web`：前端应用，包含页面、组件、样式和前端 API 调用。
- `apps/server`：后端 API、模型接入和本地文件存储逻辑。
- `packages/shared`：前后端共享契约。
- `data/books`：默认本地书籍数据目录，已被忽略，不提交。
- `.trae/specs`：历史规格文档，可作为功能背景。
- `.trae/documents`：计划文档，可作为决策背景。
- `pnpm-workspace.yaml`：workspace 范围配置。
- `tsconfig.base.json`：TypeScript 基础配置。
## 常用命令
必须使用 `pnpm`。不要引入 npm 或 yarn lockfile。
### 根目录命令
- 安装依赖：`pnpm install`
- 启动前后端开发服务：`pnpm dev`
- 单独启动后端：`pnpm dev:server`
- 单独启动前端：`pnpm dev:web`
- 构建全部 workspace 包：`pnpm build`
- 类型检查全部 workspace 包：`pnpm typecheck`
### 包级命令
- 启动前端：`pnpm --filter @novelloom/web dev`
- 构建前端：`pnpm --filter @novelloom/web build`
- 预览前端构建：`pnpm --filter @novelloom/web preview`
- 前端类型检查：`pnpm --filter @novelloom/web typecheck`
- 启动后端：`pnpm --filter @novelloom/server dev`
- 构建后端：`pnpm --filter @novelloom/server build`
- 启动后端构建产物：`pnpm --filter @novelloom/server start`
- 后端类型检查：`pnpm --filter @novelloom/server typecheck`
- 共享包类型检查：`pnpm --filter @novelloom/shared typecheck`
### 当前没有的命令
- 当前没有标准测试脚本。
- 当前没有 lint 脚本。
- 当前没有 format 脚本。
- 不要在说明或交付中声称这些命令存在，除非后续实际添加对应配置。
## 环境变量与本地数据
`.env` 位于仓库根目录。
AI 功能必需环境变量：
- `LLM_API_KEY`：OpenAI-compatible 模型 API key；未配置时后端仍可启动，但 AI 工作台不可用。旧变量 `DEEPSEEK_API_KEY` 仍作为兼容回退。
可选环境变量：
- `LLM_PROVIDER`：模型提供方标识，默认 `deepseek`；可设置为 `opencode` 等 OpenAI-compatible provider。
- `LLM_BASE_URL`：模型服务 base URL；DeepSeek 默认为 `https://api.deepseek.com`，opencode 示例为 `https://opencode.ai/zen/go/v1`。旧变量 `DEEPSEEK_BASE_URL` 仍作为兼容回退。
- `PORT`：后端服务端口。
- `HOST`：后端监听 host，默认 `localhost`。
- `BACKEND_HOST`：前端 Vite 代理访问后端时使用的 host，默认跟随 `HOST`。
- `WEB_PORT`：前端 Vite dev / preview 服务端口。
- `MODEL`：AI 工作台使用的唯一模型名称，未配置时为 `deepseek-v4-pro`。
- `BOOKS_DIR`：书籍数据目录。
默认运行约定：
- 后端默认端口是 `8097`。
- 后端默认监听 `localhost`，前端代理默认访问 `http://localhost:8097`，以兼容 Windows 下 `localhost` / `127.0.0.1` / IPv6 解析差异。
- 前端 Vite dev server 默认端口是 `3077`。
- 仓库根目录 `.env` 中的 `PORT` / `WEB_PORT` / `HOST` / `BACKEND_HOST` 优先于同名系统环境变量，避免 Windows 下残留环境变量覆盖项目配置。
- 前端 `/api` 代理到 `http://${BACKEND_HOST}:${PORT}`，未配置时代理到 `http://localhost:8097`。
- 默认书籍数据目录是 `data/books`。
不要提交：
- `.env`
- `.env.local`
- `data/`
- `dist/`
- `node_modules/`
- 日志文件
## 架构边界
### 共享契约
- 前后端共同依赖的类型、校验规则、请求体和响应结构优先放在 `packages/shared/src/index.ts`。
- 修改共享契约时，必须同步检查 `apps/web` 和 `apps/server` 的调用方。
- 不要在前端和后端之间复制粘贴重复类型来绕过共享包。
### 后端边界
- 后端入口在 `apps/server/src/index.ts`。
- API 路由在 `apps/server/src/routes`。
- 书籍存储逻辑在 `apps/server/src/books/storage.ts`。
- 环境变量解析在 `apps/server/src/env.ts`。
- 模型配置在 `apps/server/src/llm.ts`。
- 路由变更应优先复用共享包中的类型和校验规则。
### 前端边界
- 前端入口在 `apps/web/src/main.tsx`。
- 顶层视图切换在 `apps/web/src/App.tsx`。
- 书籍列表页面在 `apps/web/src/pages/BookShelf.tsx`。
- 创作台页面在 `apps/web/src/pages/Workbench.tsx`。
- AI 协作面板在 `apps/web/src/components/AiCollaborationPanel.tsx`。
- UI 变更优先复用当前 React/Vite 架构，不要无需求引入大型状态管理库。
### Codex 风格 UI 规范
- 整体视觉保持清爽、克制、工具型：白底、细边框、低饱和灰阶、少量蓝色强调，不使用大面积渐变、高饱和装饰或重阴影。
- 字重默认偏轻：正文和说明使用 400-430，表单标签和普通元信息不超过 500，标题和重要名称控制在 540-620；避免大量 650+ 的粗体堆叠。
- 信息层级靠间距、边框、浅背景和字号区分，少用强色块、粗字和厚边框制造层级。
- 组件密度保持紧凑但留白明确：列表项、表单、面板头优先使用 10-16px 级别内边距，避免卡片过厚或按钮过大。
- 状态标签使用轻量 pill：浅背景或白底细边框，小字号、低字重；仅错误和警告使用必要的红/黄提示色。
- 图标作为辅助信息，尺寸以 13-16px 为主，颜色使用灰阶；只有当前选中、主操作或关键状态才使用深色或蓝色。
- 页面级 UI 应与现有 `.ai-*` 协作区风格对齐，新增页面优先复用 `styles.css` 中的变量、按钮、错误提示和面板布局规则。
### 文件路径与安全
- 所有项目文件路径必须保持相对路径。
- 路径分隔符使用 `/`。
- 禁止绝对路径、`..`、空路径片段和尾随 `/`。
- 涉及文件系统读写时，必须确认不会越过书籍目录边界。
## 开发约定
- 遵守 TypeScript strict 配置。
- 避免引入未使用变量和未使用参数。
- 修改共享类型时同步更新前后端。
- 修改 API 时同步更新前端调用和共享请求/响应类型。
- 修改 AI 文件写入行为时，考虑前端文件树刷新和脏状态保护。
- 修改剧情规划行为时，长期剧情走向写入 `plot.md`，当前进度快照写入 `story-status.md`，章节摘要和当前细纲分别写入 `outline/index.md` 与 `outline/current.md`。
- 修改风格参考行为时，具体风格样例写入 `style-sample.md`，长期写作规则、篇幅和禁忌仍写入 `novel-spec.md`。
- 修改本地存储结构时，考虑已有 `data/books` 目录兼容性。
- 文档和计划可以参考 `.trae/specs` 与 `.trae/documents`，但它们不是运行时代码。
- 不要自动修改用户的本地书籍数据，除非任务明确要求。
## AI/Agent 开发流程
开始任务前：
- 先读 `AGENTS.md`。
- 根据任务范围读取相关源码。
- 跨包任务先读 `packages/shared/src/index.ts`。
- 检查 `.trae/specs` 和 `.trae/documents` 是否有相关背景。
修改功能时：
- 先确认影响范围是前端、后端、共享包还是跨包。
- 跨包变更先更新共享契约，再同步调用方。
- 不要破坏本地数据目录结构。
- 不要引入与任务无关的大型架构变化。
完成任务后：
- 至少运行相关包的类型检查。
- 跨包变更运行根目录 `pnpm typecheck`。
- 如涉及构建链路或发布产物，运行相关 `build` 命令。
- 文档-only 变更不需要运行构建或类型检查，但必须检查 Markdown 内容、路径和命令是否准确。
## 验证要求
### 文档-only 变更
- 检查 Markdown 是否结构清晰。
- 检查路径是否真实存在。
- 检查命令是否来自现有 `package.json`。
- 不要声称项目有不存在的测试、lint 或 format 命令。
### 前端变更
- 运行 `pnpm --filter @novelloom/web typecheck`。
- 如影响构建，运行 `pnpm --filter @novelloom/web build`。
- 如涉及后端 API，同步检查共享类型和后端路由。
### 后端变更
- 运行 `pnpm --filter @novelloom/server typecheck`。
- 如影响构建，运行 `pnpm --filter @novelloom/server build`。
- 如涉及前端调用，同步检查共享类型和前端 API 调用。
### 共享包变更
- 运行 `pnpm --filter @novelloom/shared typecheck`。
- 同时运行受影响的前端或后端类型检查。
- 跨包影响较大时运行 `pnpm typecheck`。
### 跨包变更
- 运行 `pnpm typecheck`。
- 必要时运行 `pnpm build`。
## 不要做的事
- 不要提交 `.env`、`.env.local`、`data/`、`dist/`、`node_modules/`。
- 不要引入 npm/yarn lockfile。
- 不要声明不存在的测试、lint、format 命令。
- 不要绕过 `packages/shared` 复制共享类型。
- 不要在文件路径 API 中允许绝对路径或 `..`。
- 不要默认修改用户本地书籍数据。
- 不要在未确认需求时引入认证、多用户、云同步、数据库迁移等大型能力。
- 不要把 `.trae` 文档当作运行时代码依赖。
## 快速定位
- 前端入口：`apps/web/src/main.tsx`
- 前端顶层应用：`apps/web/src/App.tsx`
- 书籍列表页面：`apps/web/src/pages/BookShelf.tsx`
- 创作台页面：`apps/web/src/pages/Workbench.tsx`
- AI 协作面板：`apps/web/src/components/AiCollaborationPanel.tsx`
- 后端入口：`apps/server/src/index.ts`
- 后端路由目录：`apps/server/src/routes`
- 书籍存储：`apps/server/src/books/storage.ts`
- 环境变量：`apps/server/src/env.ts`
- 模型配置：`apps/server/src/llm.ts`
- 共享类型与校验：`packages/shared/src/index.ts`
- workspace 配置：`pnpm-workspace.yaml`
- 根脚本：`package.json`
