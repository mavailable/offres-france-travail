import { CONFIG } from "./config";

/**
 * Lightweight prompt-result cache to reduce duplicate OpenAI calls.
 *
 * Notes:
 * - Uses CacheService for speed (best effort, may evict).
 * - Keys are hashed to avoid storing large prompts as cache keys.
 * - Not intended for sensitive data durability.
 */

const CACHE_PREFIX = "ai:prompt:";

function sha256Hex(s: string): string {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    s,
    Utilities.Charset.UTF_8
  );
  return bytes
    .map((b) => {
      const x = (b < 0 ? b + 256 : b).toString(16);
      return x.length === 1 ? "0" + x : x;
    })
    .join("");
}

function getCache(): GoogleAppsScript.Cache.Cache {
  // Script cache shares across users; good for de-dup in batch runs.
  return CacheService.getScriptCache();
}

export interface CachedAiValue {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  usedWebSearch?: boolean;
  webSearchFallback?: boolean;
}

export function buildPromptCacheKey(parts: {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  outputMode: string;
  schemaJson?: string;
  prompt: string;
}): string {
  // Include any parameter that can change the output.
  const src = JSON.stringify({
    v: 1,
    model: parts.model,
    temperature: parts.temperature,
    maxOutputTokens: parts.maxOutputTokens,
    outputMode: parts.outputMode,
    schemaJson: parts.schemaJson || "",
    prompt: parts.prompt,
  });
  return CACHE_PREFIX + sha256Hex(src);
}

export function getCachedPromptResult(key: string): CachedAiValue | null {
  try {
    const raw = getCache().get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedAiValue;
  } catch (_e) {
    return null;
  }
}

export function setCachedPromptResult(key: string, value: CachedAiValue): void {
  try {
    // Default TTL: 6 hours. Make it configurable via CONFIG if needed.
    const ttlSeconds = (CONFIG as any)?.AI_CACHE_TTL_SECONDS ?? 6 * 60 * 60;
    getCache().put(key, JSON.stringify(value), ttlSeconds);
  } catch (_e) {
    // best-effort
  }
}
