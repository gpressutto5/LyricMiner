# LyricMiner

Learn a language from the music you already listen to. Search a song on YouTube, get time-synced lyrics, step
through the lines with the arrow keys while Yomitan scans the text, and push audio / image / sentence into the Anki
card you just made.

## Requirements

- Node 20+
- `ffmpeg` on your PATH (`brew install ffmpeg`)
- yt-dlp: a binary is downloaded automatically into `node_modules` on `npm install`. A system `yt-dlp`
  (e.g. `brew install yt-dlp`) is preferred when present, or set `YTDLP_PATH`.
- Anki with the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on, for card mining
- [Yomitan](https://yomitan.wiki/) in your browser, for lookups

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173.

For a production build: `npm run build && npm start` (serves everything on http://localhost:8787).

## How to use

1. Search for a song (or paste a YouTube URL). The media is downloaded once into `cache/` and reused.
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

4. Mine: look a word up with Yomitan and add it to Anki as usual. Then press `U` (or **Update last card**) and
   LyricMiner writes the line's trimmed audio, a video frame and the sentence into that note.
   Use `M` instead to fine-tune the audio start/end, pick a different frame, or edit the sentence before sending.
   **Add new card** creates a standalone note in the deck / note type chosen in Settings.

Configure field names, deck and note type under **Settings**. Fields that don't exist on the target note type are
skipped.

## Layout

- `server/` — Express API: yt-dlp search/download, ffmpeg clipping and frame grabs, LRCLIB and AnkiConnect proxies
- `web/` — Vite + React front end
- `shared/` — types shared by both

---

<sub>The mining workflow — line-by-line stepping, "update last card", audio and screenshot capture — takes its cues
from [asbplayer](https://github.com/killergerbah/asbplayer), which does this for video subtitles.</sub>
