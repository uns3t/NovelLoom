import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(process.cwd(), __dirname);
const rootEnvPath = resolve(repoRoot, ".env");

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
  return resolve(__dirname, "../..");
}

function readRootEnv(): Record<string, string> {
  if (!existsSync(rootEnvPath)) return {};
  return Object.fromEntries(
    readFileSync(rootEnvPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.replace(/^export\s+/, ""))
      .map((line) => {
        const equalsIndex = line.indexOf("=");
        if (equalsIndex < 0) return [line, ""];
        const key = line.slice(0, equalsIndex).trim();
        const rawValue = line.slice(equalsIndex + 1).trim();
        const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");
        return [key, value];
      })
      .filter(([key]) => key),
  );
}

function envPort(value: string | undefined, fallback: number): number {
  if (!value || value.trim() === "") return fallback;
  return Number(value);
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const rootEnv = readRootEnv();
  // Prefer the repo .env value so a stale system PORT on Windows cannot shadow it.
  const webPort = envPort(rootEnv.WEB_PORT ?? env.WEB_PORT, 3077);
  const serverPort = envPort(rootEnv.PORT ?? env.PORT, 8097);
  const backendHost = rootEnv.BACKEND_HOST ?? env.BACKEND_HOST ?? rootEnv.HOST ?? env.HOST ?? "localhost";
  const backendTarget = `http://${backendHost}:${serverPort}`;

  console.log(`[novelloom] Vite repo root: ${repoRoot}`);
  console.log(`[novelloom] Vite env file: ${rootEnvPath} (loaded: ${existsSync(rootEnvPath)})`);
  console.log(`[novelloom] Vite dev server port: ${webPort}`);
  console.log(`[novelloom] Vite proxy /api -> ${backendTarget}`);

  return {
    plugins: [react()],
    server: {
      port: webPort,
      proxy: {
        "/api": {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: webPort,
    },
  };
});
