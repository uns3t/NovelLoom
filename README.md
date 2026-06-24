# NovelLoom

NovelLoom 是一个本地优先的小说创作工作台，面向长篇小说、连载故事和设定密集型创作。它提供书籍管理、Markdown 项目文件创作台、资料库和 AI 协作写作能力，适合在本地开发环境中快速迭代创作流程与写作原型。

> 当前项目重点是本地开发和原型迭代，不是生产级 SaaS 平台。项目默认不包含认证、多用户、云同步、数据库迁移或部署体系。

## 功能亮点

- **书籍管理**：创建、改名、删除书籍，并进入单本书的创作台。
- **Markdown 创作台**：按项目文件树组织小说资料，支持读取、编辑、保存、预览、新建、重命名和删除文件。
- **创作资料库**：围绕人物、世界观和物品管理结构化素材，方便写作时沉淀设定。
- **AI 协作写作**：提供 AI 协作面板、快捷命令、会话记录、AI 预设和 Agent 设置。
- **草稿审阅机制**：AI 对文件的变更先进入待审阅草稿层，用户确认接受后才写入本地文件。
- **本地文件持久化**：默认将书籍数据保存到仓库根目录下的 `data/books`。

## 技术栈

- **Monorepo**：TypeScript、pnpm workspace。
- **前端**：React 18、Vite 5、React Router、`@uiw/react-md-editor`、`@ai-sdk/react`、`lucide-react`。
- **后端**：Fastify 5、Zod、dotenv、AI SDK、OpenAI-compatible provider、`@openai/agents`。
- **共享契约**：`@novelloom/shared` 统一管理前后端共享类型、请求结构、响应结构和校验常量。

## 快速开始

### 前置要求

- Node.js
- pnpm，项目声明的包管理器版本为 `pnpm@9.12.0`

### 安装依赖

```bash
pnpm install
```

### 准备环境变量

```bash
cp .env.template .env
```

如需使用 AI 功能，请在 `.env` 中填写 `LLM_API_KEY`。未配置密钥时，书籍管理和本地文件创作能力仍可使用，AI 协作能力不可用或受限。

### 启动开发服务

```bash
pnpm dev
```

默认访问地址：

- 前端：`http://localhost:3077`
- 后端：`http://localhost:8097`
- 健康检查：`http://localhost:8097/api/health`

## 环境变量

变量来自 `.env.template`：

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `LLM_API_KEY` | AI 功能必填 | 空 | OpenAI-compatible 模型 API key。未配置时后端可启动，但 AI 工作台不可用或受限。 |
| `LLM_PROVIDER` | 否 | `deepseek` | 模型提供方标识，用于运行时诊断展示，例如 `deepseek`、`opencode`、`openrouter`。 |
| `LLM_BASE_URL` | 否 | `https://api.deepseek.com` | 模型服务 base URL，不要包含 `/chat/completions`。 |
| `DEEPSEEK_API_KEY` | 否 | 空 | 旧 DeepSeek API key 变量，仍作为兼容回退。 |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com` | 旧 DeepSeek base URL 变量，仍作为兼容回退。 |
| `PORT` | 否 | `8097` | 后端服务端口。 |
| `HOST` | 否 | `localhost` | 后端监听 host。 |
| `BACKEND_HOST` | 否 | `localhost` | 前端 Vite 代理访问后端时使用的 host。 |
| `WEB_PORT` | 否 | `3077` | 前端 Vite dev / preview 服务端口。 |
| `MODEL` | 否 | `deepseek-v4-pro` | AI 工作台使用的模型名称。 |
| `BOOKS_DIR` | 否 | `data/books` | 本地书籍数据目录，支持相对仓库根目录的路径或绝对路径。 |

请不要提交 `.env` 或任何包含真实密钥的文件。

## 常用命令

根目录命令：

```bash
pnpm dev
pnpm dev:server
pnpm dev:web
pnpm build
pnpm typecheck
```

包级命令示例：

```bash
pnpm --filter @novelloom/web dev
pnpm --filter @novelloom/web build
pnpm --filter @novelloom/web preview
pnpm --filter @novelloom/web typecheck
pnpm --filter @novelloom/server dev
pnpm --filter @novelloom/server build
pnpm --filter @novelloom/server start
pnpm --filter @novelloom/server typecheck
pnpm --filter @novelloom/shared typecheck
```

当前项目没有标准测试脚本、lint 脚本或 format 脚本。

## 项目结构

```text
.
├── apps/
│   ├── web/              # React + Vite 前端应用
│   └── server/           # Fastify 后端 API 与本地文件系统持久化
├── packages/
│   └── shared/           # 前后端共享类型、常量和校验规则
├── .env.template         # 本地环境变量模板
├── AGENTS.md             # 项目开发约定与 AI Agent 指南
├── package.json          # 根 workspace 脚本
├── pnpm-workspace.yaml   # pnpm workspace 配置
└── tsconfig.base.json    # TypeScript 基础配置
```

默认运行时数据目录：

```text
data/books
```

`data/`、`.env`、`.env.local`、`dist/`、`node_modules/` 和日志文件不应提交到仓库。

## 基本使用流程

1. 启动开发服务后打开前端页面。
2. 在书籍管理中创建一本书。
3. 进入创作台，编辑 `idea.md`、`plot.md`、`novel-spec.md`、`style-sample.md`、`story-status.md`、`outline/current.md` 或章节文件。
4. 在资料库中维护人物、世界观和物品素材。
5. 配置模型后，在 AI 协作面板中使用快捷命令或自定义输入辅助创作。
6. 审阅 AI 生成的文件草稿变更，确认接受后再落盘到本地文件。

新建书籍时，后端会生成基础项目文件，包括 `book.json`、`chapters/`、`idea.md`、`plot.md`、`novel-spec.md`、`style-sample.md`、`story-status.md` 和 `outline/`。

`style-sample.md` 用于保存写作风格样例，推荐放 1500-2500 字认可正文，并由 AI 在生成细纲、续写正文和改写润色时参考语感、节奏、对白方式和描写密度。

## AI 模型配置

NovelLoom 使用 OpenAI-compatible 接口接入模型服务。默认配置面向 DeepSeek，也可以按目标服务调整 `LLM_PROVIDER`、`LLM_BASE_URL` 和 `MODEL`。

最小示例：

```env
LLM_API_KEY=your-api-key
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com
MODEL=deepseek-v4-pro
```

注意事项：

- `LLM_BASE_URL` 不需要包含 `/chat/completions`。
- `.env` 位于仓库根目录，包含本地密钥时不要提交。
- 旧变量 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_BASE_URL` 仍可作为兼容回退。

## 当前边界

- 项目当前面向本地开发和原型迭代。
- 本地书籍数据默认存储在文件系统中。
- 项目默认不提供生产级认证、权限、多用户、云同步、数据库迁移或部署体系。
- 如需截图、部署说明、许可证或更完整的贡献规范，可在后续文档迭代中补充。

## 贡献与开发

欢迎通过 issue 或 PR 反馈问题和改进建议。

如果你准备参与开发，建议先阅读 `AGENTS.md`，了解项目定位、架构边界、常用命令和开发约定。
