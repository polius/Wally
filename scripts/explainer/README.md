# Wally film

The Wally promo: a **~67-second, 1920×1080, 60 fps MP4** with a neural
voice-over, an original synthesized score, and sound design cued from the
picture.

It is built from scratch, like the fsend, VAULT, FileSync and RetroX films: a
small web "video engine" (HTML/CSS/JS) rendered deterministically by headless
Chromium, one frame at a time. What's on the screens is the real app in its
light theme, filmed from the demo household.

Design rules the film follows, so any future edit stays on-model:

- **Money, written down.** Wally is a money log, so the film is paper and ink:
  every cut (but the last, into the end card) is a till receipt going by, printed with the next chapter as a line
  item ("October ........ 2,658.00"), that tears off as the scenes cross behind
  it; the background is a ledger's dot grid that ink runs through at every cut;
  amounts the film writes itself roll into place like a till's drum counter.
- **The film keeps its own books.** A category bar runs along the bottom, in the
  app's twelve category colours: it gains a segment with every receipt, and the
  end card takes it over, under the promise.
- **Light, like the app.** The app's pale canvas and white panels, its indigo
  accent, money green and red; the logo's wallet (tan leather, green notes)
  for warmth. Never the dark theme.
- **Show the real app.** No mock-ups of Wally's screens: the Summary, Month in
  review, searches as they're typed, Recurring, the person menu's three views,
  the phone's Add sheet key by key (then split, shared and tagged), and a shared
  bill split three ways in the desktop Add sheet are all real (`capture_app.py`).
  When a claim is said, the app does it on screen; a ring marks what changed.
- **Close enough to read.** Push in rather than shrink: the shared bill's sheet
  comes up over the page, and for the languages the phone's screen fills the
  frame (that also keeps the household's own category names, which aren't
  translated, out of the shot).
- **The logo builds itself from its own SVG** (`web/icons/wally.svg`): the
  wallet's back, two notes sliding in, the pocket, the strap swinging over and
  snapping shut. The snap is the score's downbeat.
- **Only true claims.** Everything said or shown matches the app and the
  README's Features. Check there before changing a line.
- **Every sound has a cause on screen.** Scenes register their own cues: the
  printer and the tear at every cut, notes rustling, the strap snapping, keys,
  coins, a drum counter ticking, a lock.

This folder holds **only the source**. Footage, frames, audio, model weights and
the MP4 are generated and git-ignored.

---

## Setup

Needs **Python 3.10+**, **ffmpeg**, and a network connection for the first run.

```sh
cd scripts/explainer
./setup.sh --models        # venv + deps + chromium + Kokoro weights (~340 MB)
```

## Footage (from a local demo)

```sh
docker run --rm -e DEMO=true -p 80:80 poliuscorp/wally     # or the repo's own build
.venv/bin/python capture_app.py                            # -> app/
```

Before filming, `capture_app.py` renames a few of the demo's shops (names only, every amount and
date stays), so Apple, the film's shop, has a real history to search and for the Add sheet to
remember.
The demo bar is hidden in every shot. The Add sequence saves one expense and
the language shots change the household's language (then put English back);
restart the demo afterwards for a clean one.

## Build

```sh
./make.sh                                         # the whole pipeline
./make.sh --output ~/Desktop/wally-video.mp4
./make.sh --skip-narration --skip-capture         # re-mix / re-encode only
```

Stages (`build.py` prints them as `[n/7]`): narration (Kokoro + faster-whisper
word onsets) → cues → frames (2× supersampled, parallel) → audio (sound design,
the score ducked under the voice, −14 LUFS) → encode (BT.709, x264) → captions
(`captions/wally-video.srt`) → mux.

Stills while iterating on the visuals:

```sh
.venv/bin/python capture.py --preview 2.6,12.0,30.5    # -> preview/*.png
.venv/bin/python capture.py --poster 66.5 --poster-at 960,575 \
    --poster-out ../../assets/video-poster.png          # the README thumbnail
```

## Files

| File | Role |
|---|---|
| `narration.py` | the script + pacing. **Start here** to change the wording. |
| `web/engine.js` | the renderer: `render(t)`, scene layers + cameras, the receipt cuts, the ledger bar, the dot grid, rolling digits, awaited image swaps, the cue registry |
| `web/scenes.js` | the ten scenes: open, add, summary, search, recurring, household, phone, private, selfhost, outro |
| `web/style.css` | palette, type, browser / phone / terminal frames, the receipt paper |
| `capture.py` | http server + Playwright frame loop (`--preview`, `--poster`, `--cues`) |
| `capture_app.py` | films the real app from a demo |
| `music.py` | the score: 100 BPM, F–C–Dm–B♭; marimba and kalimba (modal), a plucked bass (Karplus-Strong), a felt pad, shaker and snaps |
| `sfx.py` | printer, tear, rustle, thump, snap, coin, tick, keys, taps, lock, scramble, bells |
| `build.py` | orchestrates the seven stages |

## Notes

- A frame that swaps an image (a typing step, the phone's languages) returns a
  promise from `__render`; the harness waits for the decode before the screenshot.
- Hidden scene layers use `display: none`, not `visibility: hidden`.
- Geist and Geist Mono are under the SIL Open Font License (`web/fonts/`);
  Geist itself is served from the app's own `web/fonts/`.
