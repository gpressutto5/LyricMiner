# LyricMiner

Learn a language from the music you already listen to. Open a YouTube song, get time-synced lyrics, step
through the lines with the arrow keys while Yomitan scans the text, and push audio / image / sentence into the Anki
card you just made.

LyricMiner is a static website: nothing to install and no server. Songs play through the YouTube embed, lyrics come
straight from [LRCLIB](https://lrclib.net), cards go straight to AnkiConnect on your machine, and clip audio is
recorded from the tab while you listen.

## Requirements

- Chrome or Edge. Tab audio capture is Chromium-only; Firefox and Safari can play and read lyrics but not mine clips.
- Anki with the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on. Add the site's origin to
  AnkiConnect's `webCorsOriginList` (the in-app **Setup** guide shows the exact value with a copy button).
- [Yomitan](https://yomitan.wiki/) in your browser, for lookups.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173 and add `http://localhost:5173` to `webCorsOriginList`.

`npm run build` writes a static site to `dist/` (relative asset paths, so it works at a domain root or a sub-path).
The included GitHub Actions workflow deploys `main` to GitHub Pages; enable Pages → "GitHub Actions" in the repo
settings once.

## How to use

1. Paste a YouTube link into the box (a website can't search YouTube itself; the in-app **Setup** guide has a
   bookmarklet that sends the video you're watching here in one click). Songs you open are kept in the library
   (browser storage).
2. Synced lyrics are fetched from [LRCLIB](https://lrclib.net) automatically. If the wrong version is picked
   (romaji instead of kana, for example) hit **Change** in the bar above the lyrics and choose another result, or paste your
   own LRC. Use the **Offset** control if the highlight runs early or late.
3. Study. Click anywhere on a line to play it (the text itself stays selectable for Yomitan); the **+** in its
   left margin opens the mining dialog for that line. Or use the keyboard:

   | Key | Action |
   | --- | --- |
   | `←` / `→` | Previous / next line |
   | `↑` | Replay current line |
   | `space` | Play / pause |
   | `A` | Toggle auto-pause at the end of each line |
   | `R` | Toggle repeat of the current line |
   | `M` | Open the mining dialog for the current line |
   | `U` | Update the last Anki card with this line's audio, image and sentence |

4. Press **Start capture** and allow sharing this tab (keep "Share tab audio" ticked). From now on every line
   you hear is recorded; the green bar under the seek slider shows what has been captured.
5. Mine: look a word up with Yomitan and add it to Anki as usual. Then press `U` (or **Update last card**) and
   LyricMiner writes the line's trimmed audio, a video frame and the sentence into that note.
   Use `M` instead to fine-tune the audio start/end, pick a different frame, or edit the sentence before sending.
   **Add new card** creates a standalone note in the deck / note type chosen in Settings.

Configure field names, deck and note type under **Settings**. Fields that don't exist on the target note type are
skipped.

## How capture works

The browser cannot download YouTube media, but it can record what it plays. `Start capture` asks Chrome to share
the current tab (`getDisplayMedia`). The audio track is recorded continuously with `MediaRecorder`, and a small
timeline maps player time to recording time for every uninterrupted stretch of playback at 1×. Every half second
a frame of the player area is grabbed from the shared video track. When you mine a line, the matching slice is cut
with Web Audio, peak-normalised, encoded to MP3 in the browser, and sent to AnkiConnect together with the nearest
frame. Lines you have not heard yet (or only heard at another speed) cannot be mined until you play them.

Measured against ffmpeg cuts of the downloaded file, captured clips line up within about 50 ms.

Limitations: the recording lives in memory for the current page; some label-owned videos disable embedding
("Open on YouTube" is shown instead); the first listen has to happen in real time.

## Layout

- `web/` — Vite + React front end (everything)
- `shared/` — types
- `download-server` branch — the earlier version with a Node server that downloads media with yt-dlp and clips it with
  ffmpeg; kept for reference

---

<sub>The mining workflow — line-by-line stepping, "update last card", audio and screenshot capture — takes its cues
from [asbplayer](https://github.com/killergerbah/asbplayer), which does this for video subtitles.</sub>
