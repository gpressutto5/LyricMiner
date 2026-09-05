# LyricMiner

Learn a language from the music you already listen to. Search a song on YouTube, get time-synced lyrics, step
through the lines with the arrow keys while Yomitan scans the text, and push audio / image / sentence into the Anki
card you just made.

> **This branch (`iframe-capture`)** plays songs through the official YouTube embed instead of downloading them,
> and records the tab's own audio while you listen so lines can still be clipped for Anki. Nothing is downloaded
> and no ffmpeg / yt-dlp is needed for mining. See [How capture works](#how-capture-works).

## Requirements

- Node 20+
- Chrome or Edge (tab audio capture is Chromium-only; Firefox and Safari can play and read, but not mine clips)
- Anki with the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on, for card mining
- [Yomitan](https://yomitan.wiki/) in your browser, for lookups
- yt-dlp, only for the YouTube *search* box (a binary is fetched into `node_modules` on `npm install`). Pasting a
  YouTube link works without it.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173.

For a production build: `npm run build && npm start` (serves everything on http://localhost:8787).

## How to use

1. Search for a song (or paste a YouTube URL). It plays in an embedded YouTube player; songs you open are kept in
   the library (browser storage).
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

- `server/` — Express API: yt-dlp search, LRCLIB and AnkiConnect proxies (download / clip / frame endpoints are
  no longer used by the front end on this branch)
- `web/` — Vite + React front end
- `shared/` — types shared by both

---

<sub>The mining workflow — line-by-line stepping, "update last card", audio and screenshot capture — takes its cues
from [asbplayer](https://github.com/killergerbah/asbplayer), which does this for video subtitles.</sub>
