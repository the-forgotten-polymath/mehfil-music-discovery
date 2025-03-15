# Collecting song reports in a Google Sheet

Two things get reported from the site, and both are things the pipeline cannot
work out for itself:

- **A wrong recording.** These pass every automated check — right title, right
  film, right credits, plausible length, plays cleanly — and are still not the
  recording anyone means. Only a listener knows.
- **A missing song.** The resolver found nothing it could confirm. Usually the
  song is on YouTube and no automatic query phrasing reached it.

The site posts to `/api/feedback`, which validates the report and forwards it to
an Apps Script web app. The forwarding happens on our server so the script URL
is never in client JavaScript — an Apps Script web app is unauthenticated, so
publishing its URL would publish a write endpoint to the sheet.

## Setting it up

**1. Create the sheet.** A new Google Sheet; the tab name does not matter.

Note its id — the long segment in its URL, `docs.google.com/spreadsheets/d/<ID>/edit`.
You need it in step 2 unless you create the script from inside the sheet.

**2. Add the script.** Extensions → Apps Script, then paste the whole of
`docs/feedback-apps-script.gs` over what is there. It carries its own notes,
including why the header row must match the fields `/api/feedback` sends.

Then set `SHEET_ID` at the top to the id from step 1. It can stay blank only if
you opened the editor from inside the sheet via Extensions → Apps Script, which
binds the two; a script created at script.google.com is standalone and has no
active spreadsheet, which fails as
`Cannot read properties of null (reading 'getSheets')`.

**3. Deploy it.** Deploy → New deployment → type **Web app**.

- Execute as: **Me**
- Who has access: **Anyone**

"Anyone" is required — our server calls it without a Google identity. It is why
the URL must stay server-side.

**4. Give the URL to Vercel.** Copy the deployment URL (it ends in `/exec`) and
add it as an environment variable:

```
FEEDBACK_WEBHOOK_URL = https://script.google.com/macros/s/…/exec
```

Set it for Production and Preview, then redeploy.

Until it is set the route returns 503 and says reporting is not configured,
rather than accepting a report and dropping it. Reports that arrive while it is
unset are written to the deployment logs, so nothing is silently lost.

## Checking it works

```bash
curl -X POST https://<your-site>/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{"kind":"wrong-track","songId":1,"songTitle":"Test",
       "suggestedUrl":"https://www.youtube.com/watch?v=3gADoivNR-U"}'
```

A row should appear. `{"ok":true}` with no row means the script deployed with
the wrong access setting.

## Turning reports into fixes

The `suggestedVideoId` column is what the pipeline consumes. For a wrong
recording, add an entry to `data/corrections.json`:

```json
"Aankhon Aankhon Mein | Aankhon Aankhon Mein": {
  "video_id": "3gADoivNR-U",
  "note": "reported: was a different recording"
}
```

Then `python3 pipeline/apply_corrections.py data/carvaan.db data/corrections.json`.
Corrections are recorded at confidence 1.0, above anything the matchers produce,
so re-resolution cannot undo them.

The catalogue holds several songs with near-identical names, so match on the
`title | film` pair rather than the title — three separate entries are called
some version of "Ankhon Ankhon Mein", and correcting the wrong one is easy.

## What is deliberately not here

No spam protection beyond a honeypot field and a per-address rate limit held in
memory. The limit resets when the instance recycles and is not shared between
them, so it stops double-clicks and retry loops rather than a determined flood.
For a personal project whose reports a person reads before acting on, the
sheet's own history is the real backstop.
