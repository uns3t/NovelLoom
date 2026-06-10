import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load `.env` from the repo root (two levels up from apps/server/src).
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRootEnv = resolve(__dirname, "../../../.env");
loadDotenv({ path: repoRootEnv });

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    console.error(
      `[novelloom] Missing required env var: ${name} (expected in ${repoRootEnv})`,
    );
    process.exit(1);
  }
  return value;
}

export const env = {
  DEEPSEEK_API_KEY: required("DEEPSEEK_API_KEY"),
  DEEPSEEK_BASE_URL:
    process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  PORT: Number(process.env.PORT ?? 8787),
  MODEL: process.env.MODEL ?? "deepseek-v4-pro",
};
