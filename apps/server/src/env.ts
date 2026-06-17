import { config as loadDotenv, parse as parseDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(process.cwd(), __dirname);
const repoRootEnv = resolve(repoRoot, ".env");
loadDotenv({ path: repoRootEnv, override: true });
const rootEnv = existsSync(repoRootEnv)
  ? parseDotenv(readFileSync(repoRootEnv))
  : {};

function findRepoRoot(...starts: string[]): string {
  for (const start of starts) {
    let current = resolve(start);
    while (true) {
      if (existsSync(resolve(current, "pnpm-workspace.yaml"))) {
        return current;
      }
      const parent = resolve(current, "..");
      if (parent === current) break;
      current = parent;
    }
  }
  return resolve(__dirname, "../../..");
}

function envValue(name: string): string | undefined {
  return rootEnv[name] ?? process.env[name];
}

function optionalEnvValue(name: string): string | undefined {
  const value = envValue(name);
  return value && value.trim() !== "" ? value : undefined;
}

function resolveBooksDir(): string {
  const raw = envValue("BOOKS_DIR");
  if (!raw || raw.trim() === "") {
    return resolve(repoRoot, "data/books");
  }
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw);
}

function optionalPort(name: string, fallback: number): number {
  // Prefer the repo .env value so stale system vars on Windows cannot shadow it.
  const value = envValue(name);
  if (!value || value.trim() === "") return fallback;
  return Number(value);
}

function normalizeProvider(value: string | undefined): string {
  const provider = value?.trim().toLowerCase();
  return provider || "deepseek";
}

function defaultBaseUrlForProvider(provider: string): string {
  if (provider === "opencode") {
    return "https://opencode.ai/zen/go/v1";
  }
  if (provider === "openrouter") {
    return "https://openrouter.ai/api/v1";
  }
  return "https://api.deepseek.com";
}

const BOOKS_DIR = resolveBooksDir();
const LLM_PROVIDER = normalizeProvider(optionalEnvValue("LLM_PROVIDER"));
const LLM_API_KEY =
  optionalEnvValue("LLM_API_KEY") ?? optionalEnvValue("DEEPSEEK_API_KEY");
const LLM_BASE_URL =
  optionalEnvValue("LLM_BASE_URL") ??
  optionalEnvValue("DEEPSEEK_BASE_URL") ??
  defaultBaseUrlForProvider(LLM_PROVIDER);
const MODEL = optionalEnvValue("MODEL") ?? "deepseek-v4-pro";

export function ensureRuntimeDirs(): void {
  mkdirSync(BOOKS_DIR, { recursive: true });
}

export const env = {
  REPO_ROOT: repoRoot,
  ENV_FILE: repoRootEnv,
  ENV_FILE_LOADED: existsSync(repoRootEnv),
  LLM_PROVIDER,
  LLM_API_KEY,
  LLM_BASE_URL,
  DEEPSEEK_API_KEY: optionalEnvValue("DEEPSEEK_API_KEY"),
  DEEPSEEK_BASE_URL:
    optionalEnvValue("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com",
  HOST: envValue("HOST") ?? "localhost",
  PORT: optionalPort("PORT", 8097),
  MODEL,
  BOOKS_DIR,
};
