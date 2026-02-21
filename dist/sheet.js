"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSheets = ensureSheets;
exports.loadExistingOfferIds = loadExistingOfferIds;
exports.appendOffersBatch = appendOffersBatch;
exports.activateSheet = activateSheet;
const config_1 = require("./config");
function ensureSheets(ss) {
    let offres = ss.getSheetByName(config_1.CONFIG.SHEET_OFFRES);
    let offresWasCreated = false;
    if (!offres) {
        offres = ss.insertSheet(config_1.CONFIG.SHEET_OFFRES);
        offresWasCreated = true;
    }
    let exclusions = ss.getSheetByName(config_1.CONFIG.SHEET_EXCLUSIONS);
    if (!exclusions) {
        exclusions = ss.insertSheet(config_1.CONFIG.SHEET_EXCLUSIONS);
        setupExclusionsSheet(exclusions);
    }
    else {
        ensureExclusionsHeaders(exclusions);
    }
    ensureOffresHeaders(offres);
    ensureOffresFormatting(offres, offresWasCreated);
    return { offres, exclusions, offresWasCreated };
}
function ensureOffresHeaders(sheet) {
    const headerRange = sheet.getRange(config_1.CONFIG.HEADER_ROW, 1, 1, config_1.CONFIG.COLS.TOTAL);
    const current = headerRange.getValues()[0].map(String);
    const expected = config_1.HEADERS_OFFRES;
    const same = current.length === expected.length &&
        expected.every((v, i) => (current[i] || "").trim() === v);
    if (!same) {
        headerRange.setValues([expected]);
    }
    sheet.setFrozenRows(1);
    // Header styling
    headerRange
        .setFontWeight("bold")
        .setBackground("#f1f3f4")
        .setHorizontalAlignment("center");
}
function ensureOffresFormatting(sheet, isFirstSetup) {
    // Column widths
    sheet.setColumnWidth(config_1.CONFIG.COLS.dateCreation, config_1.CONFIG.COL_WIDTHS.dateCreation);
    sheet.setColumnWidth(config_1.CONFIG.COLS.intitule, config_1.CONFIG.COL_WIDTHS.intitule);
    sheet.setColumnWidth(config_1.CONFIG.COLS.resume, config_1.CONFIG.COL_WIDTHS.resume);
    sheet.setColumnWidth(config_1.CONFIG.COLS.entrepriseNom, config_1.CONFIG.COL_WIDTHS.entrepriseNom);
    sheet.setColumnWidth(config_1.CONFIG.COLS.codePostal, config_1.CONFIG.COL_WIDTHS.codePostal);
    sheet.setColumnWidth(config_1.CONFIG.COLS.typeContrat, config_1.CONFIG.COL_WIDTHS.typeContrat);
    sheet.setColumnWidth(config_1.CONFIG.COLS.dureeTravail, config_1.CONFIG.COL_WIDTHS.dureeTravail);
    sheet.setColumnWidth(config_1.CONFIG.COLS.offreId, config_1.CONFIG.COL_WIDTHS.offreId);
    // Hide technical column
    sheet.hideColumns(config_1.CONFIG.COLS.offreId);
    // Data range formatting (wrap off, clip)
    const maxRows = Math.max(sheet.getMaxRows(), 200);
    if (sheet.getMaxRows() < maxRows)
        sheet.insertRowsAfter(sheet.getMaxRows(), maxRows - sheet.getMaxRows());
    const dataRange = sheet.getRange(1, 1, maxRows, config_1.CONFIG.COLS.TOTAL);
    dataRange.setWrap(false).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    // Row heights (avoid auto-height from notes)
    // Applying to a "buffer" number of rows keeps the sheet clean without huge cost.
    const heightRows = Math.min(maxRows, 1000);
    sheet.setRowHeights(1, heightRows, config_1.CONFIG.ROW_HEIGHT_PX);
    // Date column format
    sheet.getRange(config_1.CONFIG.DATA_START_ROW, config_1.CONFIG.COLS.dateCreation, maxRows - 1, 1).setNumberFormat("yyyy-mm-dd");
    if (isFirstSetup) {
        // Useful default sort or filter could be added, but spec says keep it minimal.
    }
}
function setupExclusionsSheet(sheet) {
    sheet.getRange(1, 1, 1, 2).setValues([config_1.HEADERS_EXCLUSIONS]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 360);
    sheet.setColumnWidth(2, 360);
    sheet.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#f1f3f4");
}
function ensureExclusionsHeaders(sheet) {
    const headerRange = sheet.getRange(1, 1, 1, 2);
    const current = headerRange.getValues()[0].map(String);
    const expected = config_1.HEADERS_EXCLUSIONS;
    const same = expected.every((v, i) => (current[i] || "").trim() === v);
    if (!same)
        headerRange.setValues([expected]);
    sheet.setFrozenRows(1);
}
function loadExistingOfferIds(offresSheet) {
    var _a;
    const lastRow = offresSheet.getLastRow();
    if (lastRow < config_1.CONFIG.DATA_START_ROW)
        return new Set();
    const numRows = lastRow - config_1.CONFIG.HEADER_ROW;
    const range = offresSheet.getRange(config_1.CONFIG.DATA_START_ROW, config_1.CONFIG.COLS.offreId, numRows, 1);
    const values = range.getValues();
    const ids = new Set();
    for (const row of values) {
        const id = String((_a = row[0]) !== null && _a !== void 0 ? _a : "").trim();
        if (id)
            ids.add(id);
    }
    return ids;
}
/**
 * Append offers in batch:
 * - setValues for all columns
 * - setRichTextValues for intitule column (clickable link)
 * - setNotes for resume column
 */
function appendOffersBatch(offresSheet, rows) {
    if (!rows.length)
        return;
    const startRow = offresSheet.getLastRow() + 1;
    const values = rows.map((r) => [
        r.dateCreation,
        r.intituleText, // will be overwritten by rich text
        r.resume,
        r.entrepriseNom,
        r.codePostal,
        r.typeContratLibelle,
        r.dureeTravailLibelle,
        r.offreId,
    ]);
    const range = offresSheet.getRange(startRow, 1, rows.length, config_1.CONFIG.COLS.TOTAL);
    range.setValues(values);
    // Rich text links only on the "intitule" column
    const richTexts = rows.map((r) => SpreadsheetApp.newRichTextValue().setText(r.intituleText).setLinkUrl(r.intituleUrl).build());
    offresSheet
        .getRange(startRow, config_1.CONFIG.COLS.intitule, rows.length, 1)
        .setRichTextValues(richTexts.map((rt) => [rt]));
    // Notes for resume
    const notes = rows.map((r) => [r.resumeNote]);
    offresSheet.getRange(startRow, config_1.CONFIG.COLS.resume, rows.length, 1).setNotes(notes);
    // Keep consistent row height for appended rows (in case sheet had less rows formatted)
    offresSheet.setRowHeights(startRow, rows.length, config_1.CONFIG.ROW_HEIGHT_PX);
}
function activateSheet(ss, name) {
    const sheet = ss.getSheetByName(name);
    if (sheet)
        ss.setActiveSheet(sheet);
}
