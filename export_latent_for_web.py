#!/usr/bin/env python3
"""
export_latent_for_web.py — export a compact, web-friendly subset of the 100K-point
PaCMAP 2D embedding for the piano site's interactive "Latent Space" page.

Reads pacmap_embeddings_2d.mat, subsamples (default 8000 points, evenly), parses
the bowhead call type from each filename (`_TypeN`), normalizes coordinates to
0..1, and writes latent_embedding.json:

  { "n": 8000, "types": ["Type 0", ...],
    "x": [...], "y": [...], "t": [...] }   # t = index into types

Usage:
    python export_latent_for_web.py <PaCMAP_dir> [--max 8000] [--out latent_embedding.json]
"""
import argparse, json, re
from pathlib import Path
import numpy as np
import scipy.io

HERE = Path(__file__).resolve().parent
TYPE_RE = re.compile(r"_Type(\d+)", re.IGNORECASE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pacmap_dir")
    ap.add_argument("--max", type=int, default=8000)
    ap.add_argument("--out", default=str(HERE / "latent_embedding.json"))
    args = ap.parse_args()

    mat = scipy.io.loadmat(str(Path(args.pacmap_dir) / "pacmap_embeddings_2d.mat"))
    xy = np.asarray(mat["pacmap_embeddings_2d"], dtype=np.float64)
    names = [str(n[0]) if hasattr(n, "__len__") and len(n) else str(n)
             for n in mat["original_filenames"].ravel()]

    n = xy.shape[0]
    if n > args.max:                       # even subsample
        idx = np.linspace(0, n - 1, args.max).astype(int)
        xy, names = xy[idx], [names[i] for i in idx]

    types_for = [(TYPE_RE.search(nm).group(0)[1:] if TYPE_RE.search(nm) else "Unlabeled")
                 for nm in names]
    type_list = sorted(set(types_for), key=lambda s: (s == "Unlabeled", s))
    tindex = {t: i for i, t in enumerate(type_list)}

    # normalize to 0..1 (with a touch of padding)
    mn, mx = xy.min(0), xy.max(0)
    span = np.where((mx - mn) == 0, 1, mx - mn)
    norm = (xy - mn) / span
    norm = 0.04 + norm * 0.92

    out = {
        "n": int(norm.shape[0]),
        "types": [t.replace("Type", "Type ") for t in type_list],
        "x": [round(float(v), 4) for v in norm[:, 0]],
        "y": [round(float(v), 4) for v in norm[:, 1]],
        "t": [tindex[t] for t in types_for],
    }
    Path(args.out).write_text(json.dumps(out, separators=(",", ":")))
    kb = Path(args.out).stat().st_size / 1024
    print(f"wrote {args.out}  ({out['n']} pts, {len(type_list)} types, {kb:.0f} KB)")


if __name__ == "__main__":
    main()
