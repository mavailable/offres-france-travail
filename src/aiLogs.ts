import { AI_SHEETS, ensureAiSheets } from "./aiSheets";

export type AiLogStatus = "OK" | "ERROR" | "SKIP";

export interface AiLogRow {
  timestamp: string;
  jobKey: string;
  offreId: string;
  rowNumber: number;
  requestId: string;
  model: string;
  promptRendered: string;
  responseText: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs: number;
  status: AiLogStatus;
  errorMessage: string;
}

function uuid(): string {
  // Utilities.getUuid exists in Apps Script.
  try {
    return Utilities.getUuid();
  } catch (_e) {
    return String(Date.now()) + "-" + String(Math.random()).slice(2);
  }
}

export function newRequestId(): string {
  return uuid();
}

function truncate(s: string, max: number): string {
  const text = String(s || "");
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n…(truncated)";
}

export function appendAiLog(
  ss: GoogleAppsScript.Spreadsheet.Spreadsheet,
  row: AiLogRow,
  opts?: { logPayloads?: boolean }
): void {
  const { logs } = ensureAiSheets(ss);

  const logPayloads = opts?.logPayloads !== false;
  const prompt = logPayloads ? truncate(row.promptRendered, 45_000) : "(hidden)";
  const resp = logPayloads ? truncate(row.responseText, 45_000) : "(hidden)";

  const values = [
    row.timestamp,
    row.jobKey,
    row.offreId,
    row.rowNumber,
    row.requestId,
    row.model,
    prompt,
    resp,
    row.inputTokens ?? "",
    row.outputTokens ?? "",
    row.totalTokens ?? "",
    row.durationMs,
    row.status,
    row.errorMessage || "",
  ];

  logs.appendRow(values);

  // Keep logs sheet visible.
  try {
    const s = ss.getSheetByName(AI_SHEETS.LOGS);
    if (s && s.isSheetHidden()) s.showSheet();
  } catch (_e) {
    // ignore
  }
}
