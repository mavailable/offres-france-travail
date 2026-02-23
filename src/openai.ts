import type { AiConfig } from "./aiConfig";

export interface OpenAiCallResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Whether the request attempted to use the Web Search tool. */
  usedWebSearch?: boolean;
  /** Whether we had to retry without Web Search due to a tool-related error. */
  webSearchFallback?: boolean;
}

function sleepMs(ms: number): void {
  if (ms > 0) Utilities.sleep(ms);
}

function isRetryableHttp(code: number): boolean {
  return code === 408 || code === 429 || (code >= 500 && code <= 599);
}

function jitter(ms: number): number {
  // +/-20% jitter
  const r = 0.8 + Math.random() * 0.4;
  return Math.floor(ms * r);
}

function doFetch(cfg: AiConfig, payload: any): OpenAiCallResult {
  const url = "https://api.openai.com/v1/responses";

  const options: any = {
    method: "post",
    muteHttpExceptions: true,
    contentType: "application/json",
    payload: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    // Apps Script supports `deadline` in seconds.
    deadline: Math.max(5, Math.floor(Math.max(5_000, cfg.requestTimeoutMs) / 1000)),
  };

  const res = UrlFetchApp.fetch(url, options);

  const code = res.getResponseCode();
  const raw = res.getContentText() || "";

  if (code < 200 || code >= 300) {
    const err: any = new Error(`OpenAI HTTP ${code}: ${raw ? raw.slice(0, 800) : "(empty)"}`);
    err.httpStatus = code;
    err.httpBody = raw;
    throw err;
  }

  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch (_e) {
    json = null;
  }
  if (!json) throw new Error("OpenAI: réponse JSON invalide");

  // Best-effort extraction for Responses API.
  const text =
    json.output_text ??
    (Array.isArray(json.output)
      ? json.output
          .flatMap((o: any) => (Array.isArray(o.content) ? o.content : []))
          .map((c: any) => c.text)
          .filter(Boolean)
          .join("\n")
      : "");

  const usage = json.usage || {};

  return {
    text: String(text || ""),
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
  };
}

function doFetchWithRetry(cfg: AiConfig, payload: any): OpenAiCallResult {
  const maxAttempts = 3;
  const baseBackoffMs = 600;

  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return doFetch(cfg, payload);
    } catch (e: any) {
      lastErr = e;

      const httpStatus = Number(e?.httpStatus);
      const msg = String(e?.message || e);
      const looksLikeTimeout = /timed out|timeout|exceeded maximum execution time/i.test(msg);
      const retryable = (Number.isFinite(httpStatus) && isRetryableHttp(httpStatus)) || looksLikeTimeout;

      if (!retryable || attempt === maxAttempts) throw e;

      const backoff = jitter(baseBackoffMs * Math.pow(2, attempt - 1));
      sleepMs(backoff);
    }
  }

  // Should be unreachable.
  throw lastErr ?? new Error("OpenAI: échec inconnu");
}

export function callOpenAiText(
  cfg: AiConfig,
  prompt: string,
  opts?: { rateLimitMsOverride?: number; useWebSearch?: boolean }
): OpenAiCallResult {
  const rate = Math.max(0, opts?.rateLimitMsOverride ?? cfg.rateLimitMs);
  sleepMs(rate);

  const basePayload: any = {
    model: cfg.model,
    input: prompt,
    temperature: cfg.temperature,
    max_output_tokens: cfg.maxOutputTokens,
  };

  if (opts?.useWebSearch) {
    const payloadWithSearch = { ...basePayload, tools: [{ type: "web_search_preview" }] };
    try {
      const r = doFetchWithRetry(cfg, payloadWithSearch);
      return { ...r, usedWebSearch: true, webSearchFallback: false };
    } catch (e: any) {
      const msg = String(e?.message || e);
      const looksLikeToolIssue = /tool|web_search|unsupported|not allowed|not authorized|invalid/i.test(msg);
      if (looksLikeToolIssue) {
        const r2 = doFetchWithRetry(cfg, basePayload);
        return { ...r2, usedWebSearch: true, webSearchFallback: true };
      }
      throw e;
    }
  }

  const r = doFetchWithRetry(cfg, basePayload);
  return { ...r, usedWebSearch: false, webSearchFallback: false };
}

export function getLastCallDurationMs(): number {
  // reserved (not used yet)
  return 0;
}
