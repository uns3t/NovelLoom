import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { InvalidIdError } from "../books/storage.js";
import { env } from "../env.js";

export const llmProvider = createOpenAICompatible({
  name: env.LLM_PROVIDER,
  apiKey: env.LLM_API_KEY ?? "",
  baseURL: env.LLM_BASE_URL,
  includeUsage: true,
});

export function assertModelConfigured(): void {
  if (!env.LLM_API_KEY) {
    throw new InvalidIdError(
      "AI 功能需要先在仓库根目录 .env 中配置 LLM_API_KEY；也兼容旧配置 DEEPSEEK_API_KEY。书籍管理等非 AI 接口不需要该配置。",
    );
  }
}

export function currentModelLabel(): string {
  return `${env.LLM_PROVIDER} / ${env.MODEL}`;
}
