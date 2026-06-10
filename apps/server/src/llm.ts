import OpenAI from "openai";
import {
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from "@openai/agents";
import { env } from "./env.js";

/**
 * Configure the @openai/agents SDK to talk to DeepSeek's official
 * OpenAI-compatible endpoint.
 *
 * - Uses chat_completions API (DeepSeek does not support /v1/responses).
 * - Routes every request to env.DEEPSEEK_BASE_URL with DEEPSEEK_API_KEY.
 * - Disables tracing export to avoid spurious calls to OpenAI tracing API.
 */
export function configureDeepSeek(): void {
  const client = new OpenAI({
    apiKey: env.DEEPSEEK_API_KEY,
    baseURL: env.DEEPSEEK_BASE_URL,
  });
  setDefaultOpenAIClient(client);
  setOpenAIAPI("chat_completions");
  setTracingDisabled(true);
}
