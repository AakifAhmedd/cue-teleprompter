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
