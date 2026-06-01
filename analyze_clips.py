#!/usr/bin/env python3
"""
analyze_clips.py — measure the dominant frequency of every whale clip and export
`clip_frequencies.json` for the piano's pitch-lock feature.

The browser app (app.js) resamples each clip onto the pitch of the key it is
assigned to: playbackRate = note_freq / clip_freq. Doing the frequency analysis
here (once, in Python) instead of in the browser makes playback consistent and
instant, and lets us inspect how far each clip sits from its target note.

Outputs
-------
clip_frequencies.json : { "whale_sound_001.WAV": 123.45, ... }  (Hz, by filename)

Optionally logs the full mapping (note, target Hz, clip Hz, playback rate, how
many semitones the clip was shifted) to Weights & Biases as a Table.

Usage
-----
python analyze_clips.py                 # analyze ./wav-clips, write JSON
python analyze_clips.py --wandb         # also log a W&B run + mapping table
python analyze_clips.py --clips wav-clips --manifest manifest.json
"""
from __future__ import annotations
import argparse, json, math, sys, wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
A0 = 27.5  # Hz, piano key 1


def piano_freq(key_index_0based: int) -> float:
    """Equal-tempered frequency of an 88-key piano, A0 = key 0."""
    return A0 * (2.0 ** (key_index_0based / 12.0))


def note_name(key_index_0based: int) -> str:
    names = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]
    name = names[key_index_0based % 12]
    # octave numbering: A0,B0 then C1.. ; C is index 3 in this list-from-A
    octave = (key_index_0based + 9) // 12  # A0->0, C1->1, ...
    return f"{name}{octave}"


def read_wav_mono(path: Path, max_seconds: float = 3.0):
    """Return (samples float64 mono, sample_rate) using only the stdlib."""
    with wave.open(str(path), "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        sw = w.getsampwidth()
        n = min(w.getnframes(), int(sr * max_seconds))
        raw = w.readframes(n)
    if sw == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float64)
    elif sw == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float64)
    elif sw == 1:
        data = np.frombuffer(raw, dtype="u1").astype(np.float64) - 128
    else:
        raise ValueError(f"unsupported sample width {sw}")
    if ch > 1:
        data = data[::ch]  # first channel
    return data, sr


def dominant_freq(path: Path, fmin: float = 40.0, fmax: float = 600.0) -> float | None:
    """FFT peak within the bowhead call band [fmin, fmax]. None on failure."""
    try:
        data, sr = read_wav_mono(path)
        if data.size < 64:
            return None
        data -= data.mean()
        spec = np.abs(np.fft.rfft(data * np.hanning(data.size)))
        freqs = np.fft.rfftfreq(data.size, 1.0 / sr)
        band = (freqs >= fmin) & (freqs <= fmax)
        if not band.any():
            return None
        peak = freqs[band][int(np.argmax(spec[band]))]
        return round(float(peak), 3)
    except Exception as e:  # noqa: BLE001
        print(f"  ! {path.name}: {e}", file=sys.stderr)
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clips", default=str(HERE / "wav-clips"),
                    help="directory of whale clips (default ./wav-clips)")
    ap.add_argument("--manifest", default=str(HERE / "manifest.json"),
                    help="manifest mapping clips to key order (default ./manifest.json)")
    ap.add_argument("--out", default=str(HERE / "clip_frequencies.json"))
    ap.add_argument("--wandb", action="store_true",
                    help="log the note/frequency mapping to Weights & Biases")
    ap.add_argument("--fmin", type=float, default=40.0)
    ap.add_argument("--fmax", type=float, default=600.0)
    args = ap.parse_args()

    clips_dir = Path(args.clips)
    if not clips_dir.is_dir():
        print(f"ERROR: clips dir not found: {clips_dir}", file=sys.stderr)
        return 2

    wavs = sorted(p for p in clips_dir.iterdir() if p.suffix.lower() == ".wav")
    print(f"Analyzing {len(wavs)} clips in {clips_dir} ...")

    freqs: dict[str, float] = {}
    for i, p in enumerate(wavs):
        f = dominant_freq(p, args.fmin, args.fmax)
        if f is not None:
            freqs[p.name] = f
        if (i + 1) % 20 == 0:
            print(f"  ...{i + 1}/{len(wavs)}")

    Path(args.out).write_text(json.dumps(freqs, indent=2))
    print(f"Wrote {args.out} with {len(freqs)} clip frequencies.")

    # Build the note ↔ clip ↔ playback-rate table (uses manifest order if present).
    rows = []
    manifest_path = Path(args.manifest)
    if manifest_path.is_file():
        files = json.loads(manifest_path.read_text()).get("files", [])
        for entry in files:
            key0 = entry["index"] - 1            # manifest index is 1-based
            name = entry["newName"]
            cf = freqs.get(name)
            tf = piano_freq(key0)
            rate = (tf / cf) if cf else None
            semis = (12 * math.log2(rate)) if rate else None
            rows.append({
                "key": entry["index"], "note": note_name(key0),
                "target_hz": round(tf, 2), "clip": name,
                "clip_hz": cf, "playback_rate": round(rate, 4) if rate else None,
                "semitones_shifted": round(semis, 2) if semis is not None else None,
            })
        ok = [r for r in rows if r["clip_hz"]]
        if ok:
            shifts = [abs(r["semitones_shifted"]) for r in ok]
            print(f"Mapping: {len(ok)}/{len(rows)} clips measured; "
                  f"mean |shift| = {sum(shifts)/len(shifts):.1f} semitones, "
                  f"max = {max(shifts):.1f}.")
    else:
        print(f"(no manifest at {manifest_path} — skipping mapping table)")

    if args.wandb:
        try:
            import wandb
        except ImportError:
            print("W&B requested but not installed (pip install wandb) — skipping.",
                  file=sys.stderr)
            return 0
        run = wandb.init(project="bowhead-whale-piano", job_type="clip-analysis",
                         config={"n_clips": len(freqs), "fmin": args.fmin,
                                 "fmax": args.fmax})
        if rows:
            cols = ["key", "note", "target_hz", "clip", "clip_hz",
                    "playback_rate", "semitones_shifted"]
            table = wandb.Table(columns=cols,
                                data=[[r[c] for c in cols] for r in rows])
            wandb.log({"note_clip_mapping": table})
        measured = [f for f in freqs.values()]
        if measured:
            wandb.log({"clip_freq_hz": wandb.Histogram(measured),
                       "clips_measured": len(measured)})
        run.finish()
        print("Logged mapping to Weights & Biases.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
