#!/usr/bin/env python3
"""Generate the score: warm, light, acoustic-feeling, arranged to the film.

The other films in the family score themselves with synths and a chiptune;
Wally's is a kitchen-table tune: a marimba, a plucked upright-ish bass, a felt
pad, a kalimba melody, a shaker and finger snaps. Synthesized from scratch (no
samples, no licensing): the marimba and kalimba are modal (a few tuned
partials, each with its own decay), the bass is a plucked string
(Karplus-Strong). The arrangement is read from timeline.json and cues.json:
the beat grid is anchored on the wallet's snap, every section change snaps to
that grid, and the end card lands on the outro's hit.

  open      a count-in (till ticks, a bass pickup)  ->  the snap  ->  bass, kick, snaps,
            offbeat marimba chords; the shaker comes in
  add       + shaker and snaps (the groove)
  summary   + the kalimba melody
  private   breakdown: pad and kalimba only, the drums step out
  selfhost  back in, full
  outro     the hit, a ringing F major chord, the marimba winds down

  music.py --timeline timeline.json --cues cues.json --out music.wav
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 48000
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT

# F – C – Dm – B♭, a bar each: (bass root, chord tones) as MIDI notes
CHORDS = [(41, [65, 69, 72]), (36, [64, 67, 72]), (38, [62, 65, 69]), (34, [62, 65, 70])]

# the kalimba: eight bars of eighth notes over the progression (None = rest)
LEAD = [
    [81, None, 84, 81, 79, None, 77, None],
    [79, None, 76, 79, 84, None, 79, None],
    [77, None, 81, 77, 74, None, 76, 77],
    [74, None, 77, 79, 77, None, None, None],
    [81, 84, 86, 84, 81, None, 79, 81],
    [84, None, 79, None, 76, 79, 81, None],
    [77, 79, 81, None, 84, None, 81, 79],
    [77, None, None, 74, 77, None, None, None],
]

rng = np.random.default_rng(23)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, "low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def add(buf, start, x, pan=0.0):
    """Mix mono `x` into stereo `buf` at `start` seconds, equal-power pan."""
    i = int(round(start * SR))
    if i >= buf.shape[0] or i + x.size <= 0:
        return
    if i < 0:
        x, i = x[-i:], 0
    x = x[: buf.shape[0] - i]
    a = (pan + 1) * np.pi / 4
    buf[i:i + x.size, 0] += x * np.cos(a)
    buf[i:i + x.size, 1] += x * np.sin(a)


def reverb_ir(seconds=2.0, decay=0.6):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-t / decay)[:, None]
    ir[:, 0] = lp(ir[:, 0], 5500); ir[:, 1] = lp(ir[:, 1], 5500)
    ir[: int(0.012 * SR)] = 0
    return ir / np.sqrt((ir ** 2).sum(axis=0))


# ---- instruments ---------------------------------------------------------------------
def mallet(f, dur, bright=0.5):
    """A marimba bar: the fundamental and its tuned overtones (about 3.9x and
    9.2x), the higher ones dying first, and a soft mallet knock."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    d0 = 0.55 * (330 / f) ** 0.35
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t / d0)
         + 0.32 * bright * np.sin(2 * np.pi * f * 3.93 * t) * np.exp(-t / (d0 * 0.22))
         + 0.10 * bright * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t / (d0 * 0.08)))
    k = int(0.003 * SR)
    knock = np.zeros(n)
    knock[:k] = lp(rng.standard_normal(k), 2500) * np.hanning(2 * k)[k:] * 0.25
    return (x + knock) * np.minimum(1, t / 0.0015) * np.clip((dur - t) / 0.02, 0, 1)


def kalimba(f, dur):
    """A thumb piano tine: a pure tone with a bright, quickly fading overtone
    near 5.9x, and a little pitch settle as it's plucked."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    bend = 1 + 0.006 * np.exp(-t / 0.02)
    ph = 2 * np.pi * np.cumsum(f * bend) / SR
    x = (np.sin(ph) * np.exp(-t / 0.9) + 0.22 * np.sin(5.93 * ph) * np.exp(-t / 0.06)
         + 0.08 * np.sin(2 * ph) * np.exp(-t / 0.3))
    return x * np.minimum(1, t / 0.002) * np.clip((dur - t) / 0.03, 0, 1)


def pluck(f, dur, damp=0.996):
    """A plucked string (Karplus-Strong): a burst of noise through a tuned,
    slowly losing delay loop."""
    n = int(dur * SR)
    N = max(2, int(round(SR / f)))
    exc = np.zeros(n)
    exc[:N] = lp(rng.standard_normal(N), 1800) * np.hanning(N)
    den = np.zeros(N + 2)
    den[0] = 1.0
    den[N] = -damp / 2
    den[N + 1] = -damp / 2
    y = signal.lfilter([1.0], den, exc)
    y = lp(y, 900)
    t = np.arange(n) / SR
    return y / (np.abs(y).max() + 1e-9) * np.clip((dur - t) / 0.04, 0, 1)


def saw(f, n):
    """A band-limited saw, additive (the pad only needs a dozen harmonics)."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(1, 14):
        if f * k > SR / 2.5:
            break
        out += np.sin(2 * np.pi * f * k * t) / k
    return out


def pad(notes, dur, attack=0.8):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = sum(saw(hz(m) * (1 + d), n) for m in notes for d in (-0.003, 0.0, 0.0035)) / (3 * len(notes))
    x = lp(x, 1400, 2)
    env = np.minimum(1, t / attack) * np.clip((dur - t) / 0.9, 0, 1)
    return x * env


def kick():
    t = np.arange(int(0.3 * SR)) / SR
    f = 48 + 72 * np.exp(-t / 0.035)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16) * 0.9


def fsnap():
    """finger snap: a few overlapping bursts of band noise and a short ring"""
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for dt in (0.0, 0.004, 0.009):
        i = int(dt * SR)
        b = bp(rng.standard_normal(n - i), 1300, 4200) * np.exp(-np.arange(n - i) / SR / 0.018)
        x[i:] += b
    x += np.sin(2 * np.pi * 2100 * t) * np.exp(-t / 0.012) * 0.3
    return x * 0.5


def shaker(accent=1.0):
    n = int(0.07 * SR)
    t = np.arange(n) / SR
    env = np.minimum(1, t / 0.012) * np.exp(-np.maximum(0, t - 0.012) / 0.02)
    return hp(rng.standard_normal(n), 5500) * env * 0.22 * accent


def tick():
    """a till's soft tick: a wooden click, short and bright"""
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    x = bp(rng.standard_normal(n), 2500, 7000) * np.exp(-t / 0.004) * 0.6
    x += np.sin(2 * np.pi * 1850 * t) * np.exp(-t / 0.01) * 0.35
    return x


def swell(dur, peak=0.25):
    """a soft rising air, into a hit"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = bp(rng.standard_normal(n), 400, 6000)
    return x * (t / dur) ** 2.2 * peak


# ---- arrangement ------------------------------------------------------------------------
def build(timeline, cues):
    dur = timeline["video_end"]
    n = int(dur * SR) + SR
    mus, lead, drums, send = (np.zeros((n, 2)) for _ in range(4))

    starts = {s["name"]: s["start"] for s in timeline["scenes"]}
    hits = sorted(c["t"] for c in cues if c["type"] == "hit")
    h0, h1 = hits[0], hits[-1]
    snap = lambda t: h0 + round((t - h0) / BAR) * BAR
    groove, melody = snap(starts["add"]), snap(starts["summary"])
    brk, back = snap(starts["private"]), snap(starts["selfhost"])
    bars = [h0 + i * BAR for i in range(int((h1 - h0) / BAR) + 1)]

    # the intro: no wash, a count-in. A till's soft ticks on the eighths, louder as the wallet comes
    # together, a bass pickup (C, E) and an air swell fall into the snap: the downbeat, with a kick,
    # the low F and a marimba chord
    for k in range(int(h0 / (BEAT / 2))):
        tt = h0 - (k + 1) * BEAT / 2
        if tt < 0.25:
            break
        add(drums, tt, tick() * (0.55 - 0.1 * k) * (1.0 if k % 2 else 0.7), pan=0.22)
    for m, tt, d in ((36, h0 - BEAT * 1.0, 0.45), (40, h0 - BEAT * 0.5, 0.45)):
        add(mus, tt, pluck(hz(m + 12), d) * 0.34)
    add(mus, max(0, h0 - 1.4), swell(1.4, 0.2))
    add(drums, h0, kick() * 0.8)
    add(mus, h0, pluck(hz(41 + 12), 1.4) * 0.5)
    for m, pan in ((65, -0.3), (69, 0.25), (72, -0.1), (77, 0.3)):
        x = mallet(hz(m), 1.6, 0.7) * 0.15
        add(mus, h0, x, pan=pan)
        add(send, h0, x * 0.6, pan=-pan)

    def intro_bar(b0, root, tones, last):
        """Between the snap and the first Add: the groove, lighter. Bass and a kick, snaps on 2 and 4,
        and the marimba as short offbeat chords instead of running eighths; the shaker comes in
        over the last bar, into the full groove."""
        for beat, m, d in ((0, root, 1.4), (1.5, root + 7, 0.6), (2, root, 0.9), (3.5, root + 12, 0.5)):
            add(mus, b0 + beat * BEAT, pluck(hz(m + 12), d * BEAT * 1.6) * 0.42)
        for beat in (0, 2):
            add(drums, b0 + beat * BEAT, kick() * 0.5)
        for beat in (1, 3):
            add(drums, b0 + beat * BEAT, fsnap() * 0.85, pan=0.18)
            add(send, b0 + beat * BEAT, fsnap() * 0.3)
        for beat in (0.5, 1.5, 2.5, 3.5):
            for j, m in enumerate((tones[1], tones[2] + 0, tones[0] + 12)):
                x = mallet(hz(m), 0.32, 0.65) * 0.1
                add(mus, b0 + beat * BEAT, x, pan=(-0.3, 0.3, 0.05)[j])
                add(send, b0 + beat * BEAT, x * 0.5)
        x = pad(tones, BAR + 0.6, attack=0.9) * 0.08
        add(mus, b0, x)
        if last:
            for s in range(8, 16):
                add(drums, b0 + s * BEAT / 4, shaker(1.0 if s % 2 else 0.55) * (s - 7) / 8, pan=-0.25)

    for bi, b0 in enumerate(bars):
        if b0 >= h1 - 1e-6:
            break
        root, tones = CHORDS[bi % 4]
        broken = brk <= b0 < back
        full = groove <= b0 and not broken
        if b0 < groove - 1e-6:
            intro_bar(b0, root, tones, last=b0 + BAR >= groove - 1e-6)
            continue
        # the pad: every bar, softer under the groove
        x = pad(tones, BAR + 0.6, attack=0.5) * (0.36 if broken else 0.2)
        add(mus, b0, x)
        add(send, b0, x * 0.4)
        # the bass: root on 1, fifth on the and of 2, root again on 3 (gone in the breakdown)
        if not broken:
            for beat, m, d in ((0, root, 1.4), (1.5, root + 7, 0.6), (2, root, 0.9), (3.5, root + 12, 0.5)):
                add(mus, b0 + beat * BEAT, pluck(hz(m + 12), d * BEAT * 1.6) * 0.42)
        # the marimba: eighths up and down the chord
        pat = [tones[0], tones[1], tones[2], tones[0] + 12, tones[2], tones[1], tones[2] , tones[1] + 12]
        if not broken:
            for s in range(8):
                m = pat[s]
                vel = (0.2 if s % 2 == 0 else 0.13) * (1 if full else 0.8)
                x = mallet(hz(m), 0.9, 0.55) * vel
                pan = 0.32 if s % 2 else -0.32
                add(mus, b0 + s * BEAT / 2, x, pan=pan)
                add(send, b0 + s * BEAT / 2, x * 0.35, pan=-pan)
        # drums: a soft kick on 1 and 3, snaps on 2 and 4, a shaker in sixteenths
        if full:
            for beat in (0, 2):
                add(drums, b0 + beat * BEAT, kick() * 0.55)
            for beat in (1, 3):
                add(drums, b0 + beat * BEAT, fsnap(), pan=0.18)
                add(send, b0 + beat * BEAT, fsnap() * 0.3)
            for s in range(16):
                add(drums, b0 + s * BEAT / 4, shaker(1.0 if s % 2 else 0.55), pan=-0.25)
        # the melody, on the kalimba
        if b0 >= melody:
            phrase = LEAD[(bi - int(round((melody - h0) / BAR))) % len(LEAD)]
            for s, m in enumerate(phrase):
                if m is None:
                    continue
                x = kalimba(hz(m), 1.2) * (0.16 if broken else 0.13)
                add(lead, b0 + s * BEAT / 2, x, pan=0.08)
                add(send, b0 + s * BEAT / 2 + BEAT * 0.75, x * 0.4, pan=-0.35)   # a soft echo, an eighth later

    # into the end card: a swell, then the hit and a ringing F major chord
    add(mus, h1 - 1.6, swell(1.6, 0.2))
    tail = dur - h1
    for m, pan in ((65, -0.3), (69, 0.3), (72, -0.15), (77, 0.15)):
        x = mallet(hz(m), min(3.5, tail), 0.5) * 0.16
        add(mus, h1, x, pan=pan)
        add(send, h1, x * 0.6, pan=pan)
    add(mus, h1, pad([65, 69, 72, 77], tail, attack=0.3) * 0.32)
    add(mus, h1, pluck(hz(41 + 12), 2.2) * 0.5)
    for k in range(10):
        tt = h1 + 0.6 + k * BEAT / 2
        x = mallet(hz([77, 81, 84, 89][k % 4]), 0.8, 0.6) * 0.12 * np.exp(-k / 4.5)
        add(mus, tt, x, pan=0.35 if k % 2 else -0.35)
        add(send, tt, x * 0.6)

    ir = reverb_ir()
    wet = np.stack([signal.fftconvolve(send[:, c], ir[:, c])[:n] for c in range(2)], axis=1)
    out = mus + lead + drums * 0.75 + wet * 0.45
    out = out[: int(dur * SR)]
    t = np.arange(out.shape[0]) / SR
    out *= np.clip((dur - t) / 2.0, 0, 1)[:, None]
    out = lp(out.T, 11000).T
    out = np.tanh(out * 1.2) / 1.2
    return out / max(1e-9, np.abs(out).max()) * 0.6


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeline", default=os.path.join(HERE, "timeline.json"))
    ap.add_argument("--cues", default=os.path.join(HERE, "cues.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "music.wav"))
    args = ap.parse_args()
    data = build(json.load(open(args.timeline)), json.load(open(args.cues)))
    sf.write(args.out, data, SR, subtype="PCM_24")
    print(f"music: {args.out}  {data.shape[0] / SR:.1f}s")


if __name__ == "__main__":
    main()
