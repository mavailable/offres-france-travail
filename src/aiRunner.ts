import { CONFIG } from "./config";
import { getAiConfig } from "./aiConfig";
import { ensureAiSheets } from "./aiSheets";
import { renderTemplate } from "./aiTemplating";
import { appendAiLog, newRequestId } from "./aiLogs";
import { callOpenAiText } from "./openai";
import { buildPromptCacheKey, getCachedPromptResult, setCachedPromptResult } from "./aiCache";

type OutputMode = "json" | "text" | "number";
type WriteStrategy = "overwrite" | "fill_if_empty";

export interface JobConfig {
  jobKey: string;
  enabled: boolean;
  promptTemplate: string;
  outputMode: OutputMode;
  schemaJson?: string;
  targetColumns: string[];
  writeStrategy: WriteStrategy;
  rateLimitMs?: number;
}

function parseCsvList(s: string): string[] {
  return String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function loadJobsConfig(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): Map<string, JobConfig> {
  const { jobs } = ensureAiSheets(ss);
  const lastRow = jobs.getLastRow();
  const map = new Map<string, JobConfig>();
  if (lastRow < 2) return map;

  const values = jobs.getRange(2, 1, lastRow - 1, 8).getValues();
  for (const r of values) {
    const jobKey = String(r[0] ?? "").trim();
    if (!jobKey) continue;
    const enabled = /^(true|1|yes|y)$/i.test(String(r[1] ?? "").trim());
    const promptTemplate = String(r[2] ?? "");
    const outputMode = (String(r[3] ?? "text").trim() || "text") as OutputMode;
    const schemaJson = String(r[4] ?? "").trim() || undefined;
    const targetColumns = parseCsvList(String(r[5] ?? ""));
    const writeStrategy = (String(r[6] ?? "fill_if_empty").trim() || "fill_if_empty") as WriteStrategy;
    const rateLimitMsRaw = String(r[7] ?? "").trim();
    const rateLimitMs = rateLimitMsRaw ? Number(rateLimitMsRaw) : undefined;

    map.set(jobKey, {
      jobKey,
      enabled,
      promptTemplate,
      outputMode,
      schemaJson,
      targetColumns,
      writeStrategy,
      rateLimitMs: Number.isFinite(rateLimitMs as any) ? rateLimitMs : undefined,
    });
  }
  return map;
}

function ensureOffresColumns(offres: GoogleAppsScript.Spreadsheet.Sheet, columns: string[]): void {
  const header = offres.getRange(1, 1, 1, offres.getLastColumn()).getValues()[0].map(String);
  const existing = new Set(header.map((h) => (h || "").trim()).filter(Boolean));

  const missing = columns.filter((c) => !existing.has(c));
  if (!missing.length) return;

  const startCol = header.length + 1;
  offres.getRange(1, startCol, 1, missing.length).setValues([missing]);
  offres.getRange(1, startCol, 1, missing.length).setFontWeight("bold").setBackground("#f1f3f4");
}

function getHeaderIndexMap(offres: GoogleAppsScript.Spreadsheet.Sheet): Map<string, number> {
  const header = offres.getRange(1, 1, 1, offres.getLastColumn()).getValues()[0].map(String);
  const map = new Map<string, number>();
  header.forEach((h, i) => {
    const key = (h || "").trim();
    if (key) map.set(key, i);
  });
  return map;
}

function extractJsonObject(text: string): any {
  const s = String(text || "").trim();
  if (!s) throw new Error("Réponse vide");

  // Try direct parse first.
  try {
    return JSON.parse(s);
  } catch (_e) {
    // continue
  }

  // Try to extract first {...} block.
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sub = s.slice(start, end + 1);
    return JSON.parse(sub);
  }

  throw new Error("JSON introuvable dans la réponse");
}

function parseNumberStrict(text: string): number {
  const s = String(text || "").trim();
  if (!s) throw new Error("Nombre vide");
  const m = s.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) throw new Error(`Nombre introuvable: ${s.slice(0, 80)}`);
  const n = Number(m[0].replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`Nombre invalide: ${m[0]}`);
  return n;
}

export function runJob(jobKey: string): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getAiConfig();

  if (!cfg.apiKey) {
    SpreadsheetApp.getUi().alert(
      "Agents IA",
      "OPENAI_API_KEY manquante. Utilisez le menu Agents > Configurer (OpenAI).",
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }

  const jobs = loadJobsConfig(ss);
  const job = jobs.get(jobKey);
  if (!job) {
    SpreadsheetApp.getUi().alert("Agents IA", `Job introuvable: ${jobKey}`, SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  const { offres, importSheet } = (function () {
    // Lazy import to avoid circular deps; relying on global SpreadsheetApp anyway.
    const _ss = ss;
    const sheetOffres = _ss.getSheetByName(CONFIG.SHEET_OFFRES);
    const sheetImport = _ss.getSheetByName(CONFIG.SHEET_IMPORT);
    if (!sheetOffres || !sheetImport) throw new Error("Onglets Offres/Import manquants. Lancez France Travail > Initialiser.");
    return { offres: sheetOffres, importSheet: sheetImport };
  })();

  // Build map Import: offre_id -> raw_json
  const importLastRow = importSheet.getLastRow();
  const importMap = new Map<string, string>();
  if (importLastRow >= 2) {
    const rows = importSheet.getRange(2, 1, importLastRow - 1, 2).getValues();
    for (const r of rows) {
      const id = String(r[0] ?? "").trim();
      const raw = String(r[1] ?? "");
      if (id) importMap.set(id, raw);
    }
  }

  // Ensure target columns exist.
  ensureOffresColumns(offres, job.targetColumns);
  const headerMap = getHeaderIndexMap(offres);

  // Read Offres rows (batch)
  const lastRow = offres.getLastRow();
  if (lastRow < 2) return;

  const table = offres.getRange(1, 1, lastRow, offres.getLastColumn()).getValues();
  const header = table[0].map(String);

  const idxOffreId = headerMap.get("offre_ID") ?? headerMap.get("offre_id");
  if (idxOffreId == null) throw new Error("Colonne offre_ID introuvable dans Offres");

  const writes: { rowIndex: number; colIndex: number; value: any }[] = [];
  const highlightWrites: { rowIndex: number; colIndex: number }[] = [];

  for (let i = 1; i < table.length; i++) {
    const rowNumber = i + 1;
    const row = table[i];
    const offreId = String(row[idxOffreId] ?? "").trim();
    if (!offreId) continue;

    // Optimization (1): if we only fill empty cells, avoid calling OpenAI when all targets already have values.
    if (job.writeStrategy === "fill_if_empty") {
      let allFilled = true;
      for (const target of job.targetColumns) {
        const colIdx0 = headerMap.get(target);
        if (colIdx0 == null) continue;
        const current = row[colIdx0];
        const isEmpty = current == null || String(current).trim() === "";
        if (isEmpty) {
          allFilled = false;
          break;
        }
      }
      if (allFilled) {
        appendAiLog(
          ss,
          {
            timestamp: new Date().toISOString(),
            jobKey: job.jobKey,
            offreId,
            rowNumber,
            requestId: newRequestId(),
            model: cfg.model,
            promptRendered: "",
            responseText: "",
            durationMs: 0,
            status: "SKIP",
            errorMessage: "FILL_IF_EMPTY: already filled",
          },
          { logPayloads: cfg.logPayloads }
        );
        continue;
      }
    }

    // Variables
    const vars: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      const colName = String(header[c] ?? "").trim();
      if (!colName) continue;
      vars[`Offres.${colName}`] = String(row[c] ?? "");
    }
    vars["Import.raw_json"] = importMap.get(offreId) ?? "";

    const prompt = renderTemplate(job.promptTemplate, vars);

    // Optimization (2): cache by rendered prompt.
    const cacheKey = buildPromptCacheKey({
      model: cfg.model,
      temperature: cfg.temperature,
      maxOutputTokens: cfg.maxOutputTokens,
      outputMode: job.outputMode,
      schemaJson: job.schemaJson,
      prompt,
    });

    const requestId = newRequestId();
    const started = Date.now();

    if (cfg.dryRun) {
      appendAiLog(
        ss,
        {
          timestamp: new Date().toISOString(),
          jobKey: job.jobKey,
          offreId,
          rowNumber,
          requestId,
          model: cfg.model,
          promptRendered: prompt,
          responseText: "",
          durationMs: 0,
          status: "SKIP",
          errorMessage: "DRY_RUN",
        },
        { logPayloads: cfg.logPayloads }
      );
      continue;
    }

    try {
      const cached = getCachedPromptResult(cacheKey);
      let resText = "";
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let totalTokens: number | undefined;
      let durationMs = 0;
      let statusNote = "";

      if (cached) {
        resText = cached.text;
        inputTokens = cached.inputTokens;
        outputTokens = cached.outputTokens;
        totalTokens = cached.totalTokens;
        durationMs = Date.now() - started;

        const flags: string[] = ["CACHE_HIT"];
        if (cached.usedWebSearch) flags.push("WEB_SEARCH");
        if (cached.webSearchFallback) flags.push("WEB_SEARCH_FALLBACK");
        statusNote = flags.join(" |");
      } else {
        const res = callOpenAiText(cfg, prompt, {
          rateLimitMsOverride: job.rateLimitMs,
        });
        durationMs = Date.now() - started;
        resText = res.text;
        inputTokens = res.inputTokens;
        outputTokens = res.outputTokens;
        totalTokens = res.totalTokens;

        const flags: string[] = [];
        if (res.usedWebSearch) flags.push("WEB_SEARCH");
        if (res.webSearchFallback) flags.push("WEB_SEARCH_FALLBACK");
        statusNote = flags.length ? flags.join(" |") : "";

        setCachedPromptResult(cacheKey, {
          text: resText,
          inputTokens,
          outputTokens,
          totalTokens,
          usedWebSearch: res.usedWebSearch,
          webSearchFallback: res.webSearchFallback,
        });
      }

      let parsed: any = null;
      if (job.outputMode === "json") {
        parsed = extractJsonObject(resText);
      } else if (job.outputMode === "number") {
        parsed = parseNumberStrict(resText);
      } else {
        parsed = String(resText ?? "").trim();
      }

      // Apply writes
      for (const target of job.targetColumns) {
        const colIdx0 = headerMap.get(target);
        if (colIdx0 == null) continue;

        const current = row[colIdx0];
        const isEmpty = current == null || String(current).trim() === "";
        if (job.writeStrategy === "fill_if_empty" && !isEmpty) continue;

        let v: any = "";
        if (job.outputMode === "json") {
          // Default behavior: use column name as JSON key
          const defaultValue = parsed && typeof parsed === "object" ? (parsed[target] ?? "") : "";

          // Special mapping for commercial_score job
          if (job.jobKey === "commercial_score" && parsed && typeof parsed === "object") {
            if (target === "Score commercial") v = parsed.score ?? "";
            else if (target === "Keywords +") v = Array.isArray(parsed.keywords_positive) ? parsed.keywords_positive.join(", ") : "";
            else if (target === "Keywords -") v = Array.isArray(parsed.keywords_negative) ? parsed.keywords_negative.join(", ") : "";
            else if (target === "Explication") v = parsed.explanation ?? "";
            else v = defaultValue;
          } else if (job.jobKey === "keywords" && parsed && typeof parsed === "object") {
            const kn = parsed.keywords_negative && typeof parsed.keywords_negative === "object" ? parsed.keywords_negative : null;
            const pick = (k: any): string => (Array.isArray(k) ? k.filter(Boolean).join(", ") : "");

            if (target === "Keywords - Intitule") v = pick(kn?.intitule);
            else if (target === "Keywords - Description") v = pick(kn?.description);
            else if (target === "Keywords - EntrepriseNom") v = pick(kn?.entrepriseNom);
            else if (target === "Keywords - EntrepriseAPropos") v = pick(kn?.entrepriseAPropos);
            else v = defaultValue;
          } else {
            v = defaultValue;
          }
        } else {
          // number/text: same value written to all target columns
          v = parsed;
        }

        // Only count as a write if we're actually setting a non-empty value.
        // (prevents highlighting when model returns empty strings everywhere)
        const willWrite = job.writeStrategy === "overwrite" || isEmpty;
        const hasValue = v != null && String(v).trim() !== "";

        if (willWrite) {
          writes.push({ rowIndex: rowNumber, colIndex: colIdx0 + 1, value: v });
          row[colIdx0] = v; // keep in-memory row updated for subsequent targets

          // Highlight only for the completion job when it added meaningful data.
          if (job.jobKey === "completion" && isEmpty && hasValue) {
            highlightWrites.push({ rowIndex: rowNumber, colIndex: colIdx0 + 1 });
          }
        }
      }

      appendAiLog(
        ss,
        {
          timestamp: new Date().toISOString(),
          jobKey: job.jobKey,
          offreId,
          rowNumber,
          requestId,
          model: cfg.model,
          promptRendered: prompt,
          responseText: resText,
          inputTokens,
          outputTokens,
          totalTokens,
          durationMs,
          status: "OK",
          errorMessage: statusNote,
        },
        { logPayloads: cfg.logPayloads }
      );
    } catch (e: any) {
      const durationMs = Date.now() - started;
      appendAiLog(
        ss,
        {
          timestamp: new Date().toISOString(),
          jobKey: job.jobKey,
          offreId,
          rowNumber,
          requestId,
          model: cfg.model,
          promptRendered: prompt,
          responseText: "",
          durationMs,
          status: "ERROR",
          errorMessage: String(e?.message || e),
        },
        { logPayloads: cfg.logPayloads }
      );
    }
  }

  // Batch write back (fast path)
  // Group writes by row to reduce SpreadsheetApp calls.
  if (writes.length) {
    // IMPORTANT:
    // We must not overwrite non-target columns. The previous implementation wrote a
    // contiguous range per row and filled the gaps with ""; this clears any existing
    // data in between (e.g. CP / Contrat) when target columns are not adjacent.
    //
    // Instead, write only the specific cells we intend to change.
    for (const w of writes) {
      offres.getRange(w.rowIndex, w.colIndex, 1, 1).setValue(w.value);
    }
  }

  // Visual feedback for completion: mark newly filled cells in green.
  // Batch backgrounds per row.
  if (highlightWrites.length) {
    const byRow = new Map<number, { minCol: number; maxCol: number; cols: Set<number> }>();
    for (const h of highlightWrites) {
      const row = h.rowIndex;
      const col = h.colIndex;
      let entry = byRow.get(row);
      if (!entry) {
        entry = { minCol: col, maxCol: col, cols: new Set<number>() };
        byRow.set(row, entry);
      }
      entry.minCol = Math.min(entry.minCol, col);
      entry.maxCol = Math.max(entry.maxCol, col);
      entry.cols.add(col);
    }

    for (const [row, entry] of byRow) {
      const width = entry.maxCol - entry.minCol + 1;
      // Empty string means "no change"? In Apps Script it sets to none/transparent.
      const rowColors: string[] = new Array(width).fill("");
      for (let c = entry.minCol; c <= entry.maxCol; c++) {
        if (entry.cols.has(c)) rowColors[c - entry.minCol] = "#d9ead3";
      }
      offres.getRange(row, entry.minCol, 1, width).setBackgrounds([rowColors]);
    }
  }
}

export function runAllEnabledJobs(): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jobs = loadJobsConfig(ss);
  for (const [k, job] of jobs) {
    if (!job.enabled) continue;
    runJob(k);
  }
}
