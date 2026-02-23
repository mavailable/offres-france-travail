/**
 * AI / Agents configuration keys stored in Script Properties.
 * Keep it separate from France Travail OAuth secrets.
 */
export const AI_CONFIG_KEYS = {
  OPENAI_API_KEY: "OPENAI_API_KEY",
  OPENAI_MODEL: "OPENAI_MODEL",
  TEMPERATURE: "OPENAI_TEMPERATURE",
  MAX_OUTPUT_TOKENS: "OPENAI_MAX_OUTPUT_TOKENS",
  REQUEST_TIMEOUT_MS: "OPENAI_REQUEST_TIMEOUT_MS",
  RATE_LIMIT_MS: "OPENAI_RATE_LIMIT_MS",
  DRY_RUN: "OPENAI_DRY_RUN",
  LOG_PAYLOADS: "OPENAI_LOG_PAYLOADS",
} as const;

export interface AiConfig {
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  rateLimitMs: number;
  dryRun: boolean;
  logPayloads: boolean;
}

const DEFAULTS: Omit<AiConfig, "apiKey"> = {
  model: "gpt-5.2",
  temperature: 0.2,
  maxOutputTokens: 400,
  requestTimeoutMs: 90_000,
  rateLimitMs: 800,
  dryRun: false,
  logPayloads: true,
};

function getProps(): GoogleAppsScript.Properties.Properties {
  return PropertiesService.getScriptProperties();
}

function toBool(v: string | null, fallback: boolean): boolean {
  if (v == null || v === "") return fallback;
  return /^(1|true|yes|y|on)$/i.test(String(v).trim());
}

function toNumber(v: string | null, fallback: number): number {
  if (v == null || v === "") return fallback;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : fallback;
}

export function getAiConfig(): AiConfig {
  const p = getProps();
  const apiKey = (p.getProperty(AI_CONFIG_KEYS.OPENAI_API_KEY) || "").trim();

  const model = (p.getProperty(AI_CONFIG_KEYS.OPENAI_MODEL) || DEFAULTS.model).trim() || DEFAULTS.model;
  const temperature = toNumber(p.getProperty(AI_CONFIG_KEYS.TEMPERATURE), DEFAULTS.temperature);
  const maxOutputTokens = Math.max(16, Math.floor(toNumber(p.getProperty(AI_CONFIG_KEYS.MAX_OUTPUT_TOKENS), DEFAULTS.maxOutputTokens)));
  const requestTimeoutMs = Math.max(5_000, Math.floor(toNumber(p.getProperty(AI_CONFIG_KEYS.REQUEST_TIMEOUT_MS), DEFAULTS.requestTimeoutMs)));
  const rateLimitMs = Math.max(0, Math.floor(toNumber(p.getProperty(AI_CONFIG_KEYS.RATE_LIMIT_MS), DEFAULTS.rateLimitMs)));
  const dryRun = toBool(p.getProperty(AI_CONFIG_KEYS.DRY_RUN), DEFAULTS.dryRun);
  const logPayloads = toBool(p.getProperty(AI_CONFIG_KEYS.LOG_PAYLOADS), DEFAULTS.logPayloads);

  return {
    apiKey,
    model,
    temperature,
    maxOutputTokens,
    requestTimeoutMs,
    rateLimitMs,
    dryRun,
    logPayloads,
  };
}

export function hasAiApiKey(): boolean {
  try {
    return Boolean(getAiConfig().apiKey);
  } catch (_e) {
    return false;
  }
}

export function promptAndStoreAiConfig(): AiConfig {
  const ui = SpreadsheetApp.getUi();

  const title = "Configuration Agents IA";

  const rKey = ui.prompt(
    title,
    "Saisir OPENAI_API_KEY :",
    ui.ButtonSet.OK_CANCEL
  );
  if (rKey.getSelectedButton() !== ui.Button.OK) {
    throw new Error("Configuration annulée (OPENAI_API_KEY manquante).");
  }
  const apiKey = (rKey.getResponseText() || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY est vide.");

  // Optional: model override.
  const rModel = ui.prompt(
    title,
    `Modèle OpenAI (défaut: ${DEFAULTS.model}) :`,
    ui.ButtonSet.OK_CANCEL
  );
  if (rModel.getSelectedButton() !== ui.Button.OK) {
    throw new Error("Configuration annulée (modèle non confirmé).");
  }
  const model = (rModel.getResponseText() || "").trim() || DEFAULTS.model;

  const props = getProps();
  // IMPORTANT: do NOT delete other script properties (France Travail secrets, triggers markers, etc.)
  props.setProperties({
    [AI_CONFIG_KEYS.OPENAI_API_KEY]: apiKey,
    [AI_CONFIG_KEYS.OPENAI_MODEL]: model,
    [AI_CONFIG_KEYS.TEMPERATURE]: String(DEFAULTS.temperature),
    [AI_CONFIG_KEYS.MAX_OUTPUT_TOKENS]: String(DEFAULTS.maxOutputTokens),
    [AI_CONFIG_KEYS.REQUEST_TIMEOUT_MS]: String(DEFAULTS.requestTimeoutMs),
    [AI_CONFIG_KEYS.RATE_LIMIT_MS]: String(DEFAULTS.rateLimitMs),
    [AI_CONFIG_KEYS.DRY_RUN]: String(DEFAULTS.dryRun),
    [AI_CONFIG_KEYS.LOG_PAYLOADS]: String(DEFAULTS.logPayloads),
  });

  return getAiConfig();
}
