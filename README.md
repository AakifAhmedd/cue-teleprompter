# CUE — a local-only teleprompter

CUE is a teleprompter for MCing and announcing at events. Import a script, set a tempo in words per minute, and it scrolls at your pace, with a big pause/play button for when you need a breather.

Everything runs in the browser. Scripts are stored on the device and nothing is sent anywhere.

**Live app:** https://aakifahmedd.github.io/cue-teleprompter/

## Development

Static HTML, CSS, and JavaScript with no build step and no dependencies. To serve it locally:

```bash
python3 -m http.server 8000
```

Versioning rules for every change are in [VERSIONING.md](VERSIONING.md).

## Checks

```bash
node tests/format.test.js
node tests/store.test.js
node tests/backup.test.js
```

Browser regressions use Playwright as a development-only tool; the app has no
runtime dependencies. With Playwright and Chromium available:

```bash
node tests/browser.test.js
```

To use an installed Chrome browser instead, set `CUE_BROWSER_CHANNEL=chrome`.
The browser tests start and stop their own local server. They check reading
tempo, keyboard controls, phone layouts, wake-lock cleanup, storage failures,
and offline upgrades under the same subdirectory path used by GitHub Pages.

Open the app online once before relying on offline use. Updates keep the last
complete offline copy until the new copy is fully cached. If browser storage is
blocked or full, a warning explains that edits will only last for the current
session; copy your scripts before closing the tab.

## Delivery defaults

Open **Settings** in the library to set your default WPM and punctuation pauses.
The starting pace is 140 WPM, with an extra 0.25 seconds at commas and 0.5 seconds
at sentence endings. Pauses can be switched off or adjusted independently of WPM.
Standard, Formal and Lively profiles provide starting points; saving keeps your
adjustments on this device. A script's `tempo:` header overrides the default pace.
Settings apply when a script is opened; live tempo buttons still move in 5 WPM steps.

## Stage cues and script format

Open **Format** for an example and a **Copy AI prompt** button. Use `##` headings
for unspoken section labels and `*emphasis*` for highlighted words. Each cue below
must be on its own line:

- `[tempo 170]` changes the section pace; `[tempo reset]` restores the header or
  saved default pace. Live tempo controls apply the same offset across sections.
- `[pause 3]` waits exactly three seconds (positive decimal values up to 3600).
- `[hold Applause]` stops until Play is pressed; the label is optional.
- `[note Hand over microphone]` displays an unspoken presenter note.

Script duration includes fixed pauses and excludes unpredictable waiting at holds.
Punctuation pauses keep the text still during the extra pause time.

## Agenda and getting ready

The reader's **Agenda** button lists the script's `##` headings. Opening the list
pauses reading; selecting a section moves there safely, ready for Play. Keys 1–9
jump to the first nine sections. Page Down moves to the next heading; Page Up
returns to the current heading or the previous one if already at its start.
These deliberate jumps pause playback, while touches on the reading text remain
inert during playback.

Settings offers an optional 3, 5 or 10 second countdown on first Play and Restart.
Pause cancels the countdown; ordinary pause/resume after starting is immediate.
The reader also shows word count and active reading time, excluding countdowns,
manual pauses and holds. Remaining time follows the script's pace and timed cues.

## Local library and backups

Search filters scripts instantly on this device. Each card's **More** menu offers
**Duplicate** for recurring events, **Export text**, and Delete. Duplicates get a
new title and start from the top while keeping the script's formatting and cues.

**Back up scripts** downloads a JSON copy of the library. **Import backup** adds
scripts from that file without overwriting existing scripts, skips identical
script text, and validates the complete file before importing anything. Backups
contain script text, including title/tempo headers; they do not contain delivery
settings, reader positions or device identifiers. Imported scripts start paused
at the top. JSON imports are limited to 10 MB. Keep these local files somewhere
safe: scripts and backups are plain text. Nothing is uploaded to a server.

## Reading focus

Settings offers **Word by word** (the default) and **Centre guide**. Word mode
keeps the current word underlined. Centre guide puts the reading marker halfway
down the screen, with a subtle fixed band and softer text above and below it.
Scrolling and cue timing stay the same. Use the **Aa** sheet to compare the modes
while reading; changing focus preserves your position and pace and is remembered
on this device. The short-screen layout keeps playback controls below the guide.

## Visible event agenda

On wide screens the reader has a quiet **Event agenda** panel with numbered
sections, an active marker, earlier/upcoming states and estimated section times.
A `+ hold` label flags open-ended waiting. Phone and tablet layouts keep the text
full-width and show a compact current/next-section strip; tapping it opens the
agenda. All agenda markers come from the script's `##` headings, follow playback
and update when pace changes. Selecting a marker still pauses before moving.
The stored scripts, punctuation timing, local backups and playback controls are
unchanged by this layout update.
