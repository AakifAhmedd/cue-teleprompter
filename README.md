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
node tests/tutorial.test.js
node tests/editor.test.js
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

Open **Format** for a short workflow, optional cue reference and **Copy AI prompt**.
The copied instructions work before or after an existing script in the same AI
conversation. They preserve spoken wording and ask for the script if it is missing. Use `##` headings
for unspoken section labels and `*emphasis*` for highlighted words. Each cue below
must be on its own line:

- `[tempo 170]` changes the section pace; `[tempo reset]` restores the header or
  saved default pace. Live tempo controls apply the same offset across sections.
- `[pause 3]` waits exactly three seconds (positive decimal values up to 3600).
- `[hold Applause]` stops until Play is pressed; the label is optional.
- `[note Hand over microphone]` displays an unspoken presenter note.

Script duration includes fixed pauses and excludes unpredictable waiting at holds.
Word mode keeps the text still during the extra punctuation pause time. Centre guide ignores automatic punctuation pauses; explicit stage cues still apply.

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
down the screen, inside a reading window three rendered text rows tall by default. Choose three,
four or five rows in Settings or Aa; short screens cap the height to keep controls clear. It scrolls continuously through punctuation;
word mode keeps its configured punctuation pauses. Text above the window is
dimmed and blurred; upcoming text is softer and fades into full contrast as it
enters. Explicit `[pause]` and `[hold]` cues work in both modes. Use the **Aa** sheet to compare the modes
while reading; changing focus preserves your place and pace, updates duration
estimates to match the mode, and is remembered
on this device. The short-screen layout keeps playback controls below the guide.

## Visible event agenda

On wide screens the reader has a quiet **Event agenda** panel with numbered
sections, an active marker, earlier/upcoming states and estimated section times.
A `+ hold` label flags open-ended waiting. Phone and tablet layouts keep the text
full-width and show a compact current/next-section strip; tapping it opens the
agenda. All agenda markers come from the script's `##` headings, follow playback
and update when pace changes. Selecting a marker still pauses before moving.
The stored scripts, local backups and playback controls are unchanged by this
layout update.

## Reordering the agenda

Choose **Reorder** in the wide agenda panel or the phone's Agenda dialog. Reading
pauses. Drag a chapter using its dotted handle, or use its Up / Down buttons
(the handle also accepts arrow keys). **Done** leaves reorder mode. Each move
saves the actual script order, keeps the moved chapter selected, and carries its
heading, speech text, notes and cues together. Header metadata and any opening
text before the first heading stay at the top. Tempo cues still apply until
changed or reset in their new order. Reordering does not rewrite your words.

## Built-in tutorial

The **Tutorial** button opens Hamlet's “O what a rogue and peasant slave am I!”
from Act II, Scene II, using the public-domain
[Project Gutenberg text](https://www.gutenberg.org/ebooks/1524). The speech's wording
is retained; six chapter labels, unspoken CUE instructions and two timed pauses
are added. Its 120 WPM pace is intended for a measured three-to-five-minute read.

Tutorial has one dedicated button and stays out of the personal script cards.
Your tutorial edits and reading position remain saved locally, and backups include
the saved practice copy. Untouched Lincoln or Last Broadcast samples upgrade to
Hamlet; edited copies stay intact. The button restores Hamlet if the saved copy
was removed. **Backups** groups library export and import separately below your scripts.

Timed pauses and holds have inline markers so you can see them coming. During
the cue, a large stationary card at the reading line shows the remaining seconds
or hold reason, with the script dimmed behind it. Pauses resume automatically;
holds wait for Play. A manually paused countdown stays frozen. The cue card
does not change the scrolling geometry or timing. The tutorial is regression-tested at 300 WPM to check
these transitions on phone and desktop layouts.

## Reading width and line spacing

Settings and the reader's **Aa** sheet offer reading width (50–100% of the normal
text column) and line spacing (1.2–2.2×). The defaults remain full width and 1.5×.
Aa applies changes immediately without moving the token position, changing WPM,
or restarting playback. Both choices are remembered on the device. The focus
window continues to measure actual rendered rows at your chosen line spacing.

## Paused quick editing

Pause, open **Aa → Quick edit**, or press **E** while paused. The editor opens
near your current chapter. **Save quick edits** updates the existing script and
keeps reading paused, preserving your place in unchanged text or returning to
the start of the passage you changed. **Discard changes** leaves the script
untouched. Quick editing is disabled during playback. Empty scripts cannot be
saved, and edits from another tab are not overwritten silently.

## Visual and text editing

Both the library editor and paused Quick edit open in **Visual** view. Speech,
sections, notes, pauses, holds and tempo changes appear as editable blocks.
Choose a block and use **+ Note**, **+ Pause** or another palette button to add
below it. On a computer, drag a palette item to a **+** gap between blocks, then
fill in its text or duration. Pause seconds use a number control with up/down
steps and accept decimals. **Title & pace** edits the script header; leave base
tempo empty to use your saved delivery default.

Drag a block's dotted handle to move it, or use its Up/Down buttons (arrow keys
also work on the handle). **Remove** deletes a block from the draft; **Undo** can
restore it or reverse a visual edit. On phones, tapping palette items and the
move arrows provides the same controls without dragging.

**Text** shows the ordinary CUE source for pasting or precise edits. Switching
views alone preserves the exact source, including header fields and unsupported
lines. Existing files and backups keep the same format. Changes remain drafts
until Save; paused Quick edit also offers Discard. Invalid visual cue values
must be corrected before saving. Scripts changed in another tab are not silently
overwritten by either editor.
