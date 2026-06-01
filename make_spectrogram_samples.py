#!/usr/bin/env python3
"""
make_spectrogram_samples.py — render one representative INPUT spectrogram per
bowhead call type (from the dataset .mat `SNR_gram`) for the Latent Space page's
"Spectrogram Sampler" mode, copy a real model-reconstruction example for the
"output", and write a meta.json with a literature-based call-type descriptor.

No third-party imaging deps (disk is tight, torch/PIL unavailable): PNGs are
written with a tiny pure-stdlib encoder and an on-theme ocean colormap.

Usage:
    python make_spectrogram_samples.py
"""
import glob, json, os, re, struct, zlib
from pathlib import Path
import numpy as np
import scipy.io

HERE = Path(__file__).resolve().parent
OUT = HERE / "spectrogram_samples"
DATASET_DIRS = [
    "/Volumes/R3D_2024_1/BowheadDeepLearningMATLAB/BCB_Whale_Datasets/Unsupervised_database_Auto_100K_ADG_Y08101214_centered_16Apr2026.dir",
    "/Volumes/R3D_2024_1/BowheadDeepLearningMATLAB/BCB_Whale_Datasets/Unsupervised_database_Manual_100K_ADG_Y08101214_centered_16Apr2026.dir",
]
RECON_EXAMPLE = "/Volumes/R3D_2024_1/BowheadDeepLearningMATLAB/BCB_Whale_Datasets/LD32/Autoencoder_v13_100E_32LD_32C_AutoManual_Combined_100K_Date20260416-180022.dir/image_results/recon_panel_001.jpg"

# Bowhead call-type descriptors grounded in the call-classification literature
# (Clark & Johnson 1984; Würsig & Clark 1993; Blackwell, Thode et al. 2015, JASA
# 137(5):2398 — automated bowhead call detection/classification). These are
# indicative morphology descriptors for each dataset call type.
TYPE_LITERATURE = {
    0: ("Simple FM upsweep", "Short frequency-modulated call sweeping upward in frequency — the most common bowhead simple-call form."),
    1: ("Simple FM downsweep", "Frequency-modulated call sweeping downward; paired with upsweeps among the dominant simple calls."),
    2: ("Constant-frequency tonal", "Near-flat tonal call with little frequency modulation."),
    3: ("U-shaped (inflected)", "Down-then-up inflected contour — an undulated simple call."),
    4: ("N-shaped (inflected)", "Up-then-down inflected contour."),
    5: ("Undulated / multi-inflected", "Several inflection points; a more modulated call contour."),
    6: ("Complex / pulsive", "Broadband, pulsive or harmonically rich complex call."),
    7: ("Song element", "Repeated, structured unit characteristic of bowhead song."),
}
CITATION = "Bowhead call-type descriptors after Blackwell, Thode et al. 2015 (JASA 137:2398) and Clark & Johnson 1984."

TYPE_RE = re.compile(r"_Type(\d+)", re.IGNORECASE)

# ── on-theme ocean colormap (dark blue → teal → cyan → pale yellow) ──────────
_ANCHORS = np.array([
    [2, 6, 15], [12, 44, 88], [20, 110, 140], [54, 194, 255],
    [120, 230, 210], [240, 250, 180],
], dtype=np.float64)
def colormap(v):  # v in [0,1] array -> RGB uint8
    n = len(_ANCHORS) - 1
    f = np.clip(v, 0, 1) * n
    i = np.clip(f.astype(int), 0, n - 1)
    t = (f - i)[..., None]
    return (_ANCHORS[i] * (1 - t) + _ANCHORS[i + 1] * t).astype(np.uint8)


def write_png(path, rgb):
    h, w, _ = rgb.shape
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw.extend(rgb[y].tobytes())
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n"
                 + chunk(b"IHDR", ihdr)
                 + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
                 + chunk(b"IEND", b""))


def render_gram(gram, scale=3):
    im = gram[:120, :104].astype(np.float32)
    # Suppress the noise floor and stretch the high-SNR call ridge, then gamma-
    # brighten so the call contour reads clearly instead of the background.
    lo, hi = np.percentile(im, [70, 99.5])
    im = np.clip((im - lo) / (hi - lo + 1e-9), 0, 1) ** 0.7
    im = np.flipud(im)                      # low freq at bottom
    rgb = colormap(im)
    return np.repeat(np.repeat(rgb, scale, 0), scale, 1)   # nearest-neighbour upscale


def find_best(type_idx, sample=70):
    """Pick the most legible example: highest call prominence in SNR_gram."""
    cands = []
    for d in DATASET_DIRS:
        cands += sorted(glob.glob(os.path.join(d, f"*_Type{type_idx}.mat")))
    if not cands:
        return None
    step = max(1, len(cands) // sample)
    cands = cands[::step][:sample]
    best, best_score = None, -1
    for c in cands:
        try:
            g = scipy.io.loadmat(c)["SNR_gram"][:120, :104].astype(np.float32)
            score = float(np.percentile(g, 99.9) - np.percentile(g, 50))  # call vs floor
            if score > best_score:
                best, best_score = c, score
        except Exception:
            continue
    return best


def main():
    OUT.mkdir(exist_ok=True)
    meta = {"citation": CITATION, "types": {}}
    import shutil
    if os.path.isfile(RECON_EXAMPLE):
        shutil.copy2(RECON_EXAMPLE, OUT / "recon_example.jpg")
        meta["recon_example"] = "spectrogram_samples/recon_example.jpg"

    for t in range(8):
        f = find_best(t)
        name, desc = TYPE_LITERATURE.get(t, ("Unlabeled", ""))
        entry = {"name": name, "desc": desc, "input": None, "source": None}
        if f:
            try:
                gram = scipy.io.loadmat(f)["SNR_gram"]
                rgb = render_gram(gram)
                out_png = OUT / f"input_Type{t}.png"
                write_png(out_png, rgb)
                entry["input"] = f"spectrogram_samples/input_Type{t}.png"
                entry["source"] = os.path.basename(f)
                print(f"Type {t}: {name}  ← {os.path.basename(f)}  ({rgb.shape[1]}x{rgb.shape[0]})")
            except Exception as e:
                print(f"Type {t}: render failed: {e}")
        else:
            print(f"Type {t}: no .mat found")
        meta["types"][t] = entry

    (OUT / "samples.json").write_text(json.dumps(meta, indent=2))
    print(f"\nwrote {OUT/'samples.json'}")


if __name__ == "__main__":
    main()
