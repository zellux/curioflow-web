import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sourceRoot = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("next/") && !specifier.endsWith(".js")) {
    return nextResolve(`${specifier}.js`, context);
  }
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);

  const relativePath = specifier.slice(2);
  const candidates = /\.[cm]?[jt]sx?$/.test(relativePath)
    ? [relativePath]
    : [`${relativePath}.ts`, `${relativePath}.tsx`, `${relativePath}.mts`, `${relativePath}/index.ts`];

  for (const candidate of candidates) {
    const url = new URL(candidate, sourceRoot);
    if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context);
  }

  return nextResolve(new URL(relativePath, sourceRoot).href, context);
}
