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

## How to use

1. Paste a YouTube link into the box (a website can't search YouTube itself; the in-app **Setup** guide has a
   bookmarklet that sends the video you're watching here in one click). Songs you open are kept in the library
   (browser storage).
2. Synced lyrics are fetched from LRCLIB automatically. If the wrong version is picked (romaji instead of kana, for
   example) hit **Change** in the bar above the lyrics and choose another result, or paste your own LRC. Use the
   **Offset** control if the highlight runs early or late: − / + nudge by 100 ms (1 s with Shift), clicking the
   value lets you type one, and for videos with a long intro press **First line starts now** the moment the first
   line is actually sung.
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
   | `U` | Update the last Anki card with this line's audio, image and sentence (the newest note added to your deck in the last 10 minutes) |

4. Press **Start capture** and allow sharing this tab (keep "Share tab audio" ticked). From now on every line
   you hear is recorded; the green bar under the seek slider shows what has been captured. Mining a line you have
   not heard yet replays it once at normal speed to record it, then puts the playhead back.
5. Mine: look a word up with Yomitan and add it to Anki as usual. Then press `U` and
   LyricMiner writes the line's trimmed audio, a video frame and the sentence into that note.
   Press `M` to open **Mine** and fine-tune the audio start/end, pick a different frame, or edit the sentence before sending.
   **Add new card** creates a standalone note in the deck / note type chosen in Settings.
6. Optional, one-click mining: turn on **Detect new Anki cards** in Settings. While capture is on, LyricMiner
   polls Anki once a second for cards added to your deck, matches each card's sentence to a lyric line, and
   fills the card in straight away (a toast offers **Adjust** if the match looks wrong). Choose **Open the mining
   dialog** instead to review each match first, with the card preselected. This is the same polling approach
   GameSentenceMiner uses; cards made while the tab is hidden or idle are ignored.

Configure field names, deck and note type under **Settings**. Fields that don't exist on the target note type are
skipped.

## How capture works

The browser cannot download YouTube media, but it can record what it plays. `Start capture` asks Chrome to share the
current tab (`getDisplayMedia`); the audio track is recorded continuously with `MediaRecorder`, and a frame of the
player area is grabbed every half second. When you mine a line, the matching slice is cut with Web Audio,
peak-normalised, encoded to MP3 in the browser, and sent to AnkiConnect with the nearest frame. Measured against
ffmpeg cuts of the downloaded file, captured clips line up within about 50 ms.

The embed paints a large play/pause glyph over the video for about 4.5 s after every play or seek, so frames grabbed
in that window are never used. Lines you have listened through have clean frames; a line replayed to record it
does not, so its card gets the video's thumbnail instead, and the mining dialog offers **Record frame**, a longer
replay that starts early enough for the glyph to have gone.

Limitations: the recording lives in memory for the current page; some label-owned videos disable embedding
("Open on YouTube" is shown instead); the first listen has to happen in real time.

## Development

```bash
npm install
npm run dev
```

Open http://localhost:5173 and add that origin to `webCorsOriginList`.

`npm run build` writes a static site to `dist/`, with relative asset paths so it works at a domain root or a sub-path.
The included GitHub Actions workflow deploys `main` to GitHub Pages.

The front end lives in `web/` (Vite + React) and shared types in `shared/`. The `download-server` branch keeps the
earlier version that downloaded media with yt-dlp and clipped it with ffmpeg.

## Support

If LyricMiner is useful to you:

<a href="https://www.buymeacoffee.com/gpressutto5"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=gpressutto5&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" height="40" alt="Buy me a coffee" /></a>

---

<sub>The mining workflow — line-by-line stepping, "update last card", audio and screenshot capture — takes its cues
from [asbplayer](https://github.com/killergerbah/asbplayer), which does this for video subtitles.</sub>
