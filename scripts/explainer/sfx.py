#!/usr/bin/env python3
"""Sound design: render the scenes' cue list (cues.json) into one effects track.

The scenes register every cue themselves (api.cue in web/), so a sound always
sits on the frame that causes it. Everything is synthesized, and it is tactile
rather than electronic, like the film: the wallet's notes rustling and its strap snapping
shut, coins, a drum counter ticking, soft taps on glass, a lock.

  sfx.py --cues cues.json --duration 65.7 --out sfx.wav
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
import soundfile as sf
from scipy import signal

from music import SR, add, bp, hp, lp, mallet, reverb_ir

HERE = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(7)


def T(sec):
    return np.arange(int(sec * SR)) / SR


def noise(n):
    return rng.standard_normal(n)


def decay(t, d):
    return np.exp(-t / d)


def mix(*xs):
    """add sounds of different lengths"""
    out = np.zeros(max(x.size for x in xs))
    for x in xs:
        out[: x.size] += x
    return out


def tone(f, sec, d, attack=0.002):
    t = T(sec)
    return np.sin(2 * np.pi * f * t) * np.minimum(1, t / attack) * decay(t, d)


# ---- the wallet ---------------------------------------------------------------
def rustle():
    """a banknote sliding in: a few grains of paper"""
    out = np.zeros(int(0.35 * SR))
    for k in range(4):
        g = bp(noise(int(0.08 * SR)), 2000 + 900 * k, 7000) * np.hanning(int(0.08 * SR))
        i = int((0.02 + k * 0.06 + rng.random() * 0.02) * SR)
        out[i:i + g.size] += g[: out.size - i] * (0.7 - 0.12 * k)
    return out * 0.12


def thump():
    """a soft leather thud"""
    t = T(0.3)
    f = 95 * np.exp(-t / 0.06) + 52
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * decay(t, 0.12)
    felt = lp(noise(t.size), 900) * decay(t, 0.03) * 0.6
    return (body + felt) * 0.3


def snap():
    """the strap's press stud: a sharp click with a tiny ring"""
    t = T(0.18)
    click = hp(noise(t.size), 3000) * decay(t, 0.0025)
    ring = np.sin(2 * np.pi * 2350 * t) * decay(t, 0.03) * 0.35 + np.sin(2 * np.pi * 3720 * t) * decay(t, 0.018) * 0.2
    knock = np.sin(2 * np.pi * 180 * t) * decay(t, 0.03) * 0.5
    return (click * 0.9 + ring + knock) * 0.32


def hit():
    """the logo lands: a warm low swell under an F major mallet chord"""
    t = T(2.8)
    sub = np.sin(2 * np.pi * np.cumsum(48 + 60 * np.exp(-t / 0.06)) / SR) * decay(t, 0.8) * 0.8
    chord = sum(mallet(f, 2.6, bright=0.6) * a for f, a in ((349.2, 0.5), (440.0, 0.42), (523.3, 0.38), (698.5, 0.3), (880.0, 0.18)))
    air = lp(noise(t.size), 3000) * decay(t, 0.25) * 0.08
    x = np.zeros(t.size)
    x[: chord.size] += chord
    return np.tanh(1.1 * (sub + x * 0.9 + air)) * 0.5


def chime():
    """the end: F, A, C, F on a soft bell"""
    out = np.zeros(int(2.6 * SR))
    for k, f in enumerate((698.5, 880.0, 1046.5, 1396.9)):
        x = mallet(f, 2.2, bright=0.9) * (0.5 - 0.06 * k)
        i = int(k * 0.09 * SR)
        out[i:i + x.size] += x[: out.size - i]
    return out * 0.35


# ---- money -----------------------------------------------------------------------------
def coin():
    """a coin dropping onto the counter: two strikes, metallic"""
    out = np.zeros(int(0.9 * SR))
    for k, (dt, g) in enumerate(((0.0, 1.0), (0.085, 0.55), (0.14, 0.3))):
        t = T(0.7)
        x = sum(np.sin(2 * np.pi * f * t + k) * decay(t, d) * a
                for f, d, a in ((2093, 0.35, 0.6), (3520, 0.22, 0.4), (5274, 0.12, 0.25), (6644, 0.08, 0.15)))
        x += hp(noise(t.size), 4000) * decay(t, 0.004) * 0.6
        i = int(dt * SR)
        out[i:i + x.size] += x[: out.size - i] * g
    return out * 0.09


def tick():
    """a drum counter rolling to a stop"""
    out = np.zeros(int(0.7 * SR))
    tt = 0.0
    for k in range(10):
        x = tone(2600, 0.012, 0.003) * 0.4
        x[: int(0.006 * SR)] += hp(noise(int(0.006 * SR)), 2500) * decay(T(0.006), 0.0015)
        i = int(tt * SR)
        out[i:i + x.size] += x[: out.size - i] * (1 - k * 0.06)
        tt += 0.03 + k * 0.009
    return out * 0.12


def ding():
    """a gentle notification bell"""
    return mix(mallet(1318.5, 1.4, bright=1.0) * 0.16, mallet(1975.5, 0.9, bright=1.0) * 0.06)


# ---- touch --------------------------------------------------------------------------
def key():
    """a tap on the phone's keypad"""
    t = T(0.06)
    return (hp(noise(t.size), 1800) * decay(t, 0.004) * 0.5 + tone(1150 + rng.random() * 80, 0.06, 0.012) * 0.5) * 0.18


def type_():
    """a laptop key"""
    t = T(0.05)
    click_ = hp(noise(t.size), 2500) * decay(t, 0.004)
    thock = np.sin(2 * np.pi * (240 + rng.random() * 60) * t) * decay(t, 0.012) * 0.5
    return (click_ * 0.6 + thock) * 0.12


def tap():
    t = T(0.08)
    return (lp(hp(noise(t.size), 600), 5000) * decay(t, 0.006) * 0.6 + tone(820, 0.08, 0.02) * 0.5) * 0.16


def enter():
    t = T(0.14)
    return (hp(noise(t.size), 1500) * decay(t, 0.006) * 0.5 + np.sin(2 * np.pi * 170 * t) * decay(t, 0.03)) * 0.22


def pop():
    t = T(0.09)
    f = 420 + 700 * (1 - np.exp(-t / 0.02))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.minimum(1, t / 0.003) * decay(t, 0.03) * 0.15


def blip():
    return mix(mallet(2093.0, 0.25, bright=1.0) * 0.5, mallet(3136.0, 0.18, bright=1.0) * 0.2) * 0.3


def stamp():
    """a word lands"""
    t = T(0.3)
    body = np.sin(2 * np.pi * np.cumsum(70 + 80 * np.exp(-t / 0.04)) / SR) * decay(t, 0.09)
    paper = bp(noise(t.size), 800, 5000) * decay(t, 0.025) * 0.4
    return (body + paper) * 0.26


def lock():
    """a padlock: click, then the shackle seats"""
    out = np.zeros(int(0.3 * SR))
    for dt, g, f in ((0.0, 0.7, 2900), (0.075, 1.0, 1900)):
        t = T(0.12)
        x = hp(noise(t.size), 2200) * decay(t, 0.003) + np.sin(2 * np.pi * f * t) * decay(t, 0.015) * 0.4
        x += np.sin(2 * np.pi * 140 * t) * decay(t, 0.025) * 0.5
        i = int(dt * SR)
        out[i:i + x.size] += x[: out.size - i] * g
    return out * 0.3


def scramble():
    """the receipt turns to noise: a chatter of tiny digital blips"""
    sec = 0.8
    out = np.zeros(int(sec * SR))
    for k in range(48):
        f = 900 + rng.random() * 3200
        x = tone(f, 0.02, 0.006) * (0.5 + 0.5 * rng.random())
        i = int((k / 48) * sec * 0.9 * SR + rng.random() * 0.01 * SR)
        out[i:i + x.size] += x[: out.size - i]
    t = np.arange(out.size) / SR
    return out * np.sin(np.pi * t / sec) * 0.1


# ---- air ------------------------------------------------------------------------------------
def sweep(sec, f0, f1, q=0.5):
    n = int(sec * SR)
    x = noise(n)
    out = np.zeros(n)
    hop = int(0.02 * SR)
    for i in range(0, n, hop):
        c = f0 * (f1 / f0) ** (i / n)
        seg = bp(x[max(0, i - 4 * hop): i + hop], c * (1 - q), min(c * (1 + q), SR / 2.2))
        out[i:i + hop] = seg[-min(hop, n - i):]
    u = np.arange(n) / n
    return out * np.sin(np.pi * u) ** 1.6


def swish():
    return sweep(0.35, 1200, 6000) * 0.22


def whoosh():
    return sweep(0.6, 300, 3800) * 0.3


def draw():
    """a marker drawing the bar across"""
    x = sweep(0.7, 1800, 4200, 0.25) * 0.18
    t = T(0.7)
    return x * (0.7 + 0.3 * np.sin(2 * np.pi * 26 * t))


FX = {"rustle": rustle, "thump": thump, "snap": snap, "hit": hit, "chime": chime,
      "coin": coin, "tick": tick, "ding": ding, "key": key, "type": type_, "tap": tap, "enter": enter, "pop": pop,
      "blip": blip, "stamp": stamp, "lock": lock, "scramble": scramble, "swish": swish, "whoosh": whoosh, "draw": draw}
# how much of each effect goes to the reverb
SEND = {"hit": 0.45, "chime": 0.5, "coin": 0.3, "ding": 0.4, "blip": 0.3, "pop": 0.15, "snap": 0.2, "stamp": 0.2,
        "whoosh": 0.3, "swish": 0.25, "lock": 0.15}
PAN = {"hit": 0.0, "chime": 0.0, "whoosh": 0.0}


def render(cues, duration):
    n = int(duration * SR) + SR
    dry = np.zeros((n, 2))
    send = np.zeros((n, 2))
    for c in cues:
        x = FX[c["type"]]() * c.get("gain", 1)
        pan = PAN.get(c["type"], (rng.random() - 0.5) * 0.35)
        add(dry, c["t"], x, pan=pan)
        if c["type"] in SEND:
            add(send, c["t"], x * SEND[c["type"]], pan=pan)
    ir = reverb_ir(1.8, 0.5)
    wet = np.stack([signal.fftconvolve(send[:, ch], ir[:, ch])[:n] for ch in range(2)], axis=1)
    out = (dry + wet * 0.5)[: int(duration * SR)]
    return np.clip(out, -0.98, 0.98)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cues", default=os.path.join(HERE, "cues.json"))
    ap.add_argument("--duration", type=float, required=True)
    ap.add_argument("--out", default=os.path.join(HERE, "sfx.wav"))
    args = ap.parse_args()
    cues = json.load(open(args.cues))
    sf.write(args.out, render(cues, args.duration), SR, subtype="PCM_24")
    print(f"sfx: {len(cues)} cues -> {args.out}")


if __name__ == "__main__":
    main()
