#!/usr/bin/env python3
"""Narration: the single source of truth for the Wally film's words and timing.

Audio-first: every line is synthesized and measured, then a timeline is laid
out so the visuals can track the voice. For each line you can tag a spoken
substring (an "anchor") and get the moment it is said (faster-whisper word
timestamps); the web scenes use those to land things exactly on the word.

Outputs (all git-ignored):
  audio/<id>.wav      one clip per line (Kokoro neural TTS)
  narration.wav       the stitched voice track (48 kHz stereo)
  timeline.json       segments + scene windows + onsets, consumed by the renderer

Usage:
  python narration.py              # synthesize (Kokoro) then lay out the timeline
  python narration.py --reuse      # reuse audio/*.wav, just re-lay out the timeline
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
AUD = os.path.join(HERE, "audio")

# ---- voice -----------------------------------------------------------------
MODEL = os.environ.get("KOKORO_MODEL", os.path.join(HERE, "models", "kokoro-v1.0.onnx"))
VOICES = os.environ.get("KOKORO_VOICES", os.path.join(HERE, "models", "voices-v1.0.bin"))
VOICE = os.environ.get("KOKORO_VOICE", "af_heart")   # the family's voice: warm, confident
SPEED = float(os.environ.get("KOKORO_SPEED", "1.0"))
LANG = "en-us"

# ---- pacing ----------------------------------------------------------------
FPS = int(os.environ.get("FPS", "60"))
LEAD_IN = 2.9              # the cold open: the wallet puts itself together, the strap snaps
GAP_SAME = 0.4             # pause between two lines in the same scene
GAP_SCENE = 1.0            # pause when the scene changes: room for the scenes to cross
TAIL = 3.4                 # hold after the last line (the end card)
# extra hold before a line (on top of the normal gap), to let a visual land
GAP_EXTRA = {
    "add2": 0.35,          # "from last time" reads before the line about splitting
    "sum1": 0.9,           # the split, shared, tagged receipt is saved before the cut
    "sum2": 0.3,           # the recap card opens
    "rec2": 0.3,           # the price rise lights up
    "home2": 0.2,
    "phone2": 0.2,
    "priv2": 0.35,         # the receipt has scrambled
    "self2": 0.2,
    "outro1": 0.9,         # Wally running next to the terminal holds before the cut
    "outro2": 0.15,
}

# How long before its first line a scene should appear (seconds). The default
# is half the scene-change gap.
SCENE_LEAD = {"outro": 0.8, "summary": 0.55}   # summary: the saved receipt holds before the cut

# ---- the script ------------------------------------------------------------
# id, scene, voice-over, anchors {label: spoken substring}. Short, warm lines;
# every claim is one the app makes (README "Features" and the app itself).
LINES = [
    ("open1", "open", "This is Wally.",
     {"name": "Wally"}),
    ("open2", "open", "A money log for your household: what came in, where it went, and what's coming.",
     {"household": "household", "in": "came in", "went": "where it went", "coming": "what's coming"}),
    ("add1", "add", "Add what you spend in a few seconds.",
     {"add": "Add", "seconds": "few seconds"}),
    ("add2", "add", "Split a receipt, share a cost, or tag a trip.",
     {"split": "Split", "share": "share", "tag": "tag"}),
    ("sum1", "summary", "The Summary shows where it all went, against last month.",
     {"summary": "Summary", "went": "went", "last": "last month"}),
    ("sum2", "summary", "And on the first, a recap of the month before.",
     {"first": "first", "recap": "recap"}),
    ("find1", "search", "Search every month at once: a shop, a tag, a person, an amount.",
     {"search": "Search", "shop": "a shop", "tag": "a tag", "person": "a person", "amount": "an amount"}),
    ("rec1", "recurring", "Rent, subscriptions and salaries add themselves on their day.",
     {"rent": "Rent", "subs": "subscriptions", "salaries": "salaries", "day": "their day"}),
    ("rec2", "recurring", "And when a price goes up, you'll see it.",
     {"price": "price", "see": "see it"}),
    ("home1", "household", "Everyone gets their own view.",
     {"everyone": "Everyone", "own": "own view"}),
    ("home2", "household", "Shared costs split evenly, by income, or by hand.",
     {"shared": "Shared", "evenly": "evenly", "income": "income", "hand": "by hand"}),
    ("phone1", "phone", "On your phone, it installs like an app.",
     {"phone": "phone", "installs": "installs"}),
    ("phone2", "phone", "And it speaks thirteen languages.",
     {"speaks": "speaks", "languages": "languages"}),
    ("priv1", "private", "Set a password, and it's end-to-end encrypted.",
     {"password": "password", "encrypted": "encrypted"}),
    ("priv2", "private", "Not even the server can read it.",
     {"server": "server", "read": "read it"}),
    ("self1", "selfhost", "Wally is free, open source, and yours to host.",
     {"free": "free", "open": "open source", "host": "host"}),
    ("self2", "selfhost", "One Docker command, and it's running.",
     {"docker": "Docker", "running": "running"}),
    ("outro1", "outro", "Wally.",
     {}),
    ("outro2", "outro", "Know where your money goes.",
     {"know": "Know", "money": "money", "goes": "goes"}),
]

# What the voice reads instead of the written word (captions keep the latter).
SAY: dict[str, str] = {}


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def duration(path):
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", path])
    return float(out.strip())


# Lines that reuse a word the voice already said: Kokoro says "Wally." on its own with an odd lilt,
# so the end card's "Wally." is the opening's, cut from "This is Wally." (the film ends on the word
# it began with). line id -> (source line, the word).
ECHO = {"outro1": ("open1", "Wally")}


def echo_words():
    """Cut each ECHO word out of its source clip -> audio/<id>.wav: from where the sound before it
    ends (the "z" of "is" fades from the high band) to the clip's own end."""
    import numpy as np
    import soundfile as sf
    from scipy import signal
    for sid, (src, word) in ECHO.items():
        x, sr = sf.read(os.path.join(AUD, f"{src}.wav"), dtype="float32")
        vo = next(v for i, _s, v, _a in LINES if i == src)
        where = whisper_map(os.path.join(AUD, f"{src}.wav"), vo) or speech_map(os.path.join(AUD, f"{src}.wav"), vo)
        ws = where(vo.index(word))
        hf = signal.sosfilt(signal.butter(4, 3500, "high", fs=sr, output="sos"), x)
        h = int(sr * 0.005)
        db = lambda i: 20 * np.log10(np.sqrt((hf[i:i + h] ** 2).mean()) + 1e-9)
        lo, hi = int((ws - 0.08) * sr), int((ws + 0.08) * sr)
        frames = list(range(max(0, lo), min(len(x) - h, hi), h))
        peak = max(frames, key=db)
        cut = next((i for i in frames if i > peak and db(i) < -33), int(ws * sr))
        y = x[cut:].copy()
        n = int(0.012 * sr)
        y[:n] *= np.linspace(0, 1, n) ** 2
        sf.write(os.path.join(AUD, f"{sid}.wav"), y, sr)
        print(f"  echo  {sid:8s} {len(y) / sr:5.2f}s  \"{word}\" from {src} at {cut / sr:.3f}s")


# Words the voice should say differently: (Kokoro's phonemes, ours). Filled in
# from what whisper hears in the build log, if a word comes out wrong.
PHONEMES: list[tuple[str, str]] = []


def synth():
    """Synthesize every line with the local Kokoro neural voice -> audio/<id>.wav."""
    os.makedirs(AUD, exist_ok=True)
    if not os.path.exists(MODEL) or not os.path.exists(VOICES):
        sys.exit(f"missing Kokoro models:\n  {MODEL}\n  {VOICES}\n"
                 "run ./setup.sh (or set KOKORO_MODEL / KOKORO_VOICES)")
    import soundfile as sf
    from kokoro_onnx import Kokoro
    kokoro = Kokoro(MODEL, VOICES)
    for sid, _scene, vo, _anchors in LINES:
        path = os.path.join(AUD, f"{sid}.wav")
        text = vo
        for a, b in SAY.items():
            text = text.replace(a, b)
        ph = kokoro.tokenizer.phonemize(text, LANG)
        for a, b in PHONEMES:
            ph = ph.replace(a, b)
        samples, sr = kokoro.create(ph, voice=VOICE, speed=SPEED, is_phonemes=True)
        sf.write(path, samples, sr)
        print(f"  synth {sid:8s} {len(samples) / sr:5.2f}s  {vo}")


_WHISPER = []


def whisper_map(path, vo):
    """Map character positions in `vo` to seconds inside its clip from real word
    timestamps (faster-whisper). Also prints what was heard, so a mispronounced
    word shows up in the build log. Returns None when whisper is unavailable."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None
    import difflib
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly
    if not _WHISPER:
        _WHISPER.append(WhisperModel("small.en", device="cpu", compute_type="int8",
                                     download_root=os.path.join(HERE, "models", "whisper")))
    x, sr = sf.read(path, dtype="float32")
    x = resample_poly(x if x.ndim == 1 else x.mean(axis=1), 16000, sr).astype(np.float32)
    segs, _ = _WHISPER[0].transcribe(x, word_timestamps=True, language="en")
    heard = [w for s in segs for w in s.words]
    print(f"    heard: {' '.join(w.word.strip() for w in heard)}")
    if not heard:
        return None
    # align letters only: whisper splits and spells words its own way
    norm = lambda c: c.lower() if c.isalnum() else ""
    vo_pos = [i for i, c in enumerate(vo) if norm(c)]
    vo_l = "".join(norm(vo[i]) for i in vo_pos)
    hw_l, hw_t = "", []
    for w in heard:
        for c in w.word:
            if norm(c):
                hw_l += norm(c); hw_t.append(w.start)
    at = {}
    for a, b, n in difflib.SequenceMatcher(None, vo_l, hw_l, autojunk=False).get_matching_blocks():
        for k in range(n):
            at[vo_pos[a + k]] = hw_t[b + k]
    keys = sorted(at)

    def where(i):
        later = [k for k in keys if k >= i]
        return at[later[0]] if later else at[keys[-1]]
    return where


def make_silence(sec):
    sec = round(sec, 3)
    path = os.path.join(AUD, f"sil_{int(sec * 1000)}.wav")
    if not os.path.exists(path):
        run(["ffmpeg", "-y", "-f", "lavfi", "-t", f"{sec}",
             "-i", "anullsrc=r=24000:cl=mono", path])
    return path


def speech_map(path, vo):
    """Map character positions in `vo` to seconds inside its clip.

    Kokoro pauses at punctuation, so a plain character ratio drifts on lines
    with several clauses. Find the pauses in the audio, pair the longest ones
    with the punctuation breaks in the text, and interpolate by character
    count only inside each clause.
    """
    import numpy as np
    import soundfile as sf
    x, sr = sf.read(path)
    if x.ndim > 1:
        x = x.mean(axis=1)
    hop = int(sr * 0.01)
    rms = np.sqrt(np.convolve(x ** 2, np.ones(hop) / hop, "same")[::hop])
    loud = rms > max(1e-4, 0.08 * np.percentile(rms, 95))
    idx = np.flatnonzero(loud)
    if idx.size == 0:
        return lambda i: len(vo) and 0.0
    first, last = idx[0], idx[-1]
    # silent runs (>= 90 ms) strictly inside the speech
    pauses, run = [], None
    for k in range(first, last + 1):
        if not loud[k]:
            run = k if run is None else run
        elif run is not None:
            if k - run >= 9:
                pauses.append((k - run, run, k))
            run = None
    breaks = [m.end() for m in __import__("re").finditer(r"[,.;:?!\u2014]+\s*", vo) if m.end() < len(vo)]
    knots = [(0, first * 0.01), (len(vo), (last + 1) * 0.01)]
    if breaks and len(pauses) >= len(breaks):
        chosen = sorted(sorted(pauses, reverse=True)[:len(breaks)], key=lambda p: p[1])
        knots[1:1] = [(c, e * 0.01) for c, (_, _, e) in zip(breaks, chosen)]
        # the clause before each break ends where its pause starts
        ends = [(c - 1, s0 * 0.01) for c, (_, s0, _) in zip(breaks, chosen)]
        knots = sorted(knots + ends)
    cs, ts = zip(*knots)
    return lambda i: float(np.interp(i, cs, ts))


def onset(vo, start, where, sub):
    """Time (s) at which `sub` is spoken."""
    i = vo.find(sub)
    if i < 0:
        raise ValueError(f"anchor {sub!r} not found in {vo!r}")
    return round(start + where(i), 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reuse", action="store_true",
                    help="reuse audio/*.wav instead of re-synthesizing")
    args = ap.parse_args()

    if not args.reuse:
        print("synthesizing narration (Kokoro)")
        synth()
    echo_words()

    durs = [duration(os.path.join(AUD, f"{sid}.wav")) for sid, *_ in LINES]

    # ---- lay out the timeline from real audio durations --------------------
    segs, parts, t = [], [make_silence(LEAD_IN)], LEAD_IN
    for i, (sid, scene, vo, anchors) in enumerate(LINES):
        if i > 0:
            gap = GAP_SCENE if scene != LINES[i - 1][1] else GAP_SAME
            gap += GAP_EXTRA.get(sid, 0.0)
            parts.append(make_silence(gap))
            t += gap
        start, dur = t, durs[i]
        clip = os.path.join(AUD, f"{sid}.wav")
        where = whisper_map(clip, vo) or speech_map(clip, vo)
        parts.append(os.path.join(AUD, f"{sid}.wav"))
        t += dur
        segs.append({
            "id": sid, "scene": scene, "vo": vo,
            "start": round(start, 3), "dur": round(dur, 3),
            "end": round(start + dur, 3),
            "onsets": {k: onset(vo, start, where, s) for k, s in anchors.items()},
        })
    parts.append(make_silence(TAIL))
    video_end = round(t + TAIL, 3)

    # ---- stitch the voice track -------------------------------------------
    listfile = os.path.join(AUD, "concat.txt")
    with open(listfile, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    narration = os.path.join(HERE, "narration.wav")
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listfile,
         "-ar", "48000", "-ac", "2", narration])

    # ---- scene windows (boundaries centred in the scene-change gaps) -------
    order = []
    for s in segs:
        if not order or order[-1]["name"] != s["scene"]:
            order.append({"name": s["scene"], "first": s["start"], "last_end": s["end"]})
        else:
            order[-1]["last_end"] = s["end"]
    scenes = []
    for i, sc in enumerate(order):
        if i == 0:
            start = 0.0
        elif sc["name"] in SCENE_LEAD:
            start = sc["first"] - SCENE_LEAD[sc["name"]]
        else:
            start = (order[i - 1]["last_end"] + sc["first"]) / 2
        scenes.append({"name": sc["name"], "start": round(start, 3)})
    for i in range(len(scenes)):
        scenes[i]["end"] = round(scenes[i + 1]["start"], 3) if i + 1 < len(scenes) else video_end

    timeline = {"fps": FPS, "video_end": video_end,
                "narration_dur": round(duration(narration), 3),
                "segments": segs, "scenes": scenes}
    with open(os.path.join(HERE, "timeline.json"), "w") as f:
        json.dump(timeline, f, indent=2)

    print(f"\nnarration {timeline['narration_dur']:.2f}s   video {video_end:.2f}s "
          f"({video_end / 60:.2f} min)")
    for sc in scenes:
        print(f"  {sc['name']:7s} {sc['start']:6.2f} -> {sc['end']:6.2f}")


if __name__ == "__main__":
    main()
