/**
 * Mehfil song reports -> Google Sheet.
 *
 * Paste this whole file into Extensions > Apps Script on a new Sheet, then
 * Deploy > New deployment > Web app, with:
 *
 *   Execute as:      Me
 *   Who has access:  Anyone
 *
 * "Anyone" is required because our server calls this with no Google identity.
 * That is also why the deployment URL must never reach the browser: anybody
 * holding it can append rows. It goes in Vercel as FEEDBACK_WEBHOOK_URL and is
 * used only by /api/feedback, which validates every report before forwarding.
 *
 * HEADERS must match the field names /api/feedback sends, in order. Adding a
 * field there means adding it here; anything missing arrives as a blank cell
 * rather than shifting the row.
 */

/**
 * The spreadsheet to write to, by id.
 *
 * Leave blank only if this script was created from inside the sheet
 * (Extensions > Apps Script), which binds the two. A standalone script created
 * at script.google.com has no "active" spreadsheet, and
 * getActiveSpreadsheet() returns null there — which surfaces as
 * "Cannot read properties of null (reading 'getSheets')".
 *
 * The id is the long segment in the sheet's own URL:
 *   https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
 */
const SHEET_ID = '';

const HEADERS = [
  'at',                // ISO timestamp, set on our server
  'kind',              // 'wrong-track' | 'missing-song'
  'songId',            // catalogue id, for looking the song back up
  'songTitle',
  'songFilm',
  'currentVideoId',    // what was playing when it was reported as wrong
  'suggestedVideoId',  // extracted id — this is what the pipeline consumes
  'suggestedUrl',      // the link as pasted, so a bad parse is visible
  'note',
  'reporterName',      // blank when they would rather not be credited
  'userAgent',
];

// Ids are text. Without this Sheets reads "-Al-S1uishM" as a formula and
// "3gADoivNR-U" as something to reformat, and the id you need is destroyed.
const TEXT_COLUMNS = ['suggestedVideoId', 'currentVideoId', 'songId'];

// A cell beginning with any of these is a formula, not a note. Reports come
// from strangers, so a note reading =IMPORTXML("http://…","//a") would be
// evaluated by the sheet on open — fetching a URL of their choosing under the
// account that owns it. Everything written here is text, whatever it starts
// with.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'empty request' });
    }

    const report = JSON.parse(e.postData.contents);
    const sheet = targetSheet();

    // The first write lays down the header, so the sheet can start empty and
    // nobody has to type eleven column names correctly.
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    sheet.appendRow(
      HEADERS.map(function (key) {
        const value = report[key];
        if (value === undefined || value === null || value === '') {
          return '';
        }
        const text = String(value);
        // A leading apostrophe is how Sheets is told "this is text". Applied to
        // the id columns always, and to anything that would otherwise be read
        // as a formula.
        if (TEXT_COLUMNS.indexOf(key) !== -1 || FORMULA_PREFIX.test(text)) {
          return "'" + text;
        }
        return text;
      })
    );

    return json({ ok: true });
  } catch (err) {
    // Reported back rather than swallowed: /api/feedback logs a non-ok reply,
    // so a broken deployment shows up in the logs instead of looking like
    // reports that were never sent.
    return json({ ok: false, error: String(err) });
  }
}

/**
 * The first tab of the target spreadsheet.
 *
 * By id when one is given, which works whether or not this script is bound to
 * a sheet. Falling back to the active spreadsheet keeps a bound script working
 * with no id set, and says plainly what is wrong when there is neither — the
 * raw failure is a null dereference that names none of this.
 */
function targetSheet() {
  const book = SHEET_ID
    ? SpreadsheetApp.openById(SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!book) {
    throw new Error(
      'No spreadsheet. This script is not bound to one, so set SHEET_ID to ' +
      'the id from your sheet URL: docs.google.com/spreadsheets/d/<ID>/edit'
    );
  }
  return book.getSheets()[0];
}

/** A GET is not how reports arrive; answering one confirms the deployment. */
function doGet() {
  return json({ ok: true, message: 'Mehfil feedback endpoint is deployed.' });
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
