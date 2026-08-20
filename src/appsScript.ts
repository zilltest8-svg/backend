/**
 * The sheet this project was set up for. Used as the starting value so the
 * setup dialog opens with the script already written for it; changing the link
 * in the dialog overrides it.
 */
export const DEFAULT_SHEET_ID = "1GaCxdtWKt_IL-Fd3KH673DgpKiCobU-2MiyNAQYRtT4";

/** Pull the document id out of any Google Sheets URL. */
export function sheetIdFrom(url: string): string | null {
  const m = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/.exec(url.trim());
  return m?.[1] ?? null;
}

export function sheetUrlFrom(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

/**
 * The Apps Script to paste into the user's project, with their sheet id baked
 * in. Written with `openById` rather than `getActiveSpreadsheet` so it works
 * whether the script is bound to the sheet or created standalone at script.new.
 */
export function buildScript(sheetId: string, tabName = "Office Time"): string {
  return `/**
 * Office Time Calculator -> Google Drive + Sheets
 * Generated for sheet: ${sheetId}
 *
 * 1. Paste this whole file into a new project at script.new
 *    (or your sheet's Extensions -> Apps Script).
 * 2. Deploy -> New deployment -> Web app.
 *      Execute as:     Me
 *      Who has access: Anyone
 * 3. Authorise it. It asks for Drive and Sheets access because it
 *    saves a CSV into your Drive and appends rows to your sheet.
 * 4. Copy the /exec URL it gives you back into the app.
 *
 * Re-sending the same date replaces that day's file and rows, so nothing
 * is ever duplicated.
 */

var SHEET_ID = '${sheetId}';
var TAB_NAME = '${tabName}';
var FOLDER_NAME = '${tabName}';

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    return reply_(payload.mode === 'drive' ? toDrive_(payload) : toSheet_(payload), null);
  } catch (err) {
    return reply_({ ok: false, error: String(err) }, null);
  }
}

/**
 * A page opened from the file system cannot read a normal cross-origin reply,
 * so the app calls this over JSONP instead — that is the only way it can show
 * you the real Drive link straight after saving.
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.mode === 'drive') {
      return reply_(toDrive_({ filename: p.filename, csv: p.csv }), p.callback);
    }
    return reply_({
      ok: true,
      sheet: SpreadsheetApp.openById(SHEET_ID).getName(),
      tab: TAB_NAME,
      driveFolder: getFolder_(FOLDER_NAME).getName()
    }, p.callback);
  } catch (err) {
    return reply_({ ok: false, error: String(err) }, p.callback);
  }
}

/** Save the day as a CSV file in a Drive folder, replacing that date's file. */
function toDrive_(payload) {
  var name = payload.filename || 'office-time.csv';
  var folder = getFolder_(FOLDER_NAME);

  var existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);

  var file = folder.createFile(name, payload.csv || '', MimeType.CSV);
  return {
    ok: true,
    mode: 'drive',
    file: file.getName(),
    url: file.getUrl(),
    folder: folder.getName(),
    folderUrl: folder.getUrl()
  };
}

function reply_(obj, callback) {
  var text = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + text + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

function getFolder_(name) {
  var found = DriveApp.getFoldersByName(name);
  return found.hasNext() ? found.next() : DriveApp.createFolder(name);
}

/** Append the rows to the spreadsheet, replacing that date's rows. */
function toSheet_(payload) {
  var headers = payload.headers || [];
  var rows = payload.rows || [];
  if (!rows.length) return { ok: false, error: 'no rows' };

  var sheet = getSheet_(headers);
  var date = rows[0][0];
  removeDate_(sheet, date);

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  sheet.autoResizeColumns(1, headers.length);
  return { ok: true, mode: 'sheet', added: rows.length, date: date };
}

function getSheet_(headers) {
  var book = SpreadsheetApp.openById(SHEET_ID);
  var sheet = book.getSheetByName(TAB_NAME);
  if (!sheet) sheet = book.insertSheet(TAB_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    var head = sheet.getRange(1, 1, 1, headers.length);
    head.setFontWeight('bold');
    head.setBackground('#0e1522');
    head.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Drop existing rows for this date so a re-send replaces rather than duplicates. */
function removeDate_(sheet, date) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var column = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (var i = column.length - 1; i >= 0; i--) {
    if (column[i][0] === date) sheet.deleteRow(i + 2);
  }
}
`;
}
