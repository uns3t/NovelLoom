import OpenAI from "openai";
import {
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from "@openai/agents";
import { env } from "./env.js";

/**
 * Configure the @openai/agents SDK to talk to the selected OpenAI-compatible
 * endpoint.
 *
 * - Uses chat_completions API for broad provider compatibility.
 * - Routes every request to env.LLM_BASE_URL with env.LLM_API_KEY.
 * - Disables tracing export to avoid spurious calls to OpenAI tracing API.
 */
export function configureLlm(): void {
  if (!env.LLM_API_KEY) {
    return;
  }
  const client = new OpenAI({
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL,
  });
  setDefaultOpenAIClient(client);
  setOpenAIAPI("chat_completions");
  setTracingDisabled(true);
}
