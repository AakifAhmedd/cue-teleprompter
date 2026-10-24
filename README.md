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
