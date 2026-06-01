#!/usr/bin/env python3
"""
export_latent_for_web.py — export a compact, web-friendly subset of the PaCMAP
embeddings for the piano site's interactive "Latent Space" page.

Exports BOTH the 3D and 2D PaCMAP embeddings (aligned by sample), the bowhead
call type (parsed from `_TypeN`), and the cluster id — so the page can toggle
2D/3D and color by type or cluster.

latent_embedding.json:
  { "n", "dim":3, "types":[...], "nclusters":2,
    "x","y","z",        # 3D coords, 0..1
    "x2","y2",          # 2D coords, 0..1
    "t",                # type index into types[]
    "c" }               # cluster id

Usage:
    python export_latent_for_web.py <PaCMAP_dir> [--max 8000]
"""
import argparse, json, re
from pathlib import Path
import numpy as np
import scipy.io

HERE = Path(__file__).resolve().parent
TYPE_RE = re.compile(r"_Type(\d+)", re.IGNORECASE)


def names_of(mat):
    return [str(n[0]) if hasattr(n, "__len__") and len(n) else str(n)
            for n in mat["original_filenames"].ravel()]


def norm01(a):
    mn, mx = a.min(0), a.max(0)
    span = np.where((mx - mn) == 0, 1, mx - mn)
    return 0.04 + (a - mn) / span * 0.92


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pacmap_dir")
    ap.add_argument("--max", type=int, default=8000)
    ap.add_argument("--out", default=str(HERE / "latent_embedding.json"))
    args = ap.parse_args()
    d = Path(args.pacmap_dir)

    m3 = scipy.io.loadmat(str(d / "pacmap_embeddings_3d.mat"))
    m2 = scipy.io.loadmat(str(d / "pacmap_embeddings_2d.mat"))
    xyz = np.asarray(m3["pacmap_embeddings_3d"], dtype=np.float64)
    xy2 = np.asarray(m2["pacmap_embeddings_2d"], dtype=np.float64)
    names = names_of(m3)
    clusters = np.asarray(m3["clusters"]).ravel().astype(int)

    n = xyz.shape[0]
    idx = np.linspace(0, n - 1, args.max).astype(int) if n > args.max else np.arange(n)

    # sanity: 2D and 3D should be embeddings of the same samples in the same order
    names2 = names_of(m2)
    mism = sum(1 for i in idx if names[i] != names2[i])
    if mism:
        print(f"WARNING: {mism}/{len(idx)} filename mismatches between 2D and 3D order")

    xyz, xy2 = norm01(xyz[idx]), norm01(xy2[idx])
    names_s = [names[i] for i in idx]
    clusters_s = clusters[idx]

    types_for = [(TYPE_RE.search(nm).group(0)[1:] if TYPE_RE.search(nm) else "Unlabeled")
                 for nm in names_s]
    type_list = sorted(set(types_for), key=lambda s: (s == "Unlabeled", s))
    tindex = {t: i for i, t in enumerate(type_list)}

    r = lambda col: [round(float(v), 4) for v in col]
    out = {
        "n": int(len(idx)), "dim": 3,
        "types": [t.replace("Type", "Type ") for t in type_list],
        "nclusters": int(clusters_s.max()) + 1 if clusters_s.size else 0,
        "x": r(xyz[:, 0]), "y": r(xyz[:, 1]), "z": r(xyz[:, 2]),
        "x2": r(xy2[:, 0]), "y2": r(xy2[:, 1]),
        "t": [tindex[t] for t in types_for],
        "c": [int(v) for v in clusters_s],
    }
    Path(args.out).write_text(json.dumps(out, separators=(",", ":")))
    kb = Path(args.out).stat().st_size / 1024
    print(f"wrote {args.out}  ({out['n']} pts, {len(type_list)} types, "
          f"{out['nclusters']} clusters, {kb:.0f} KB)")


if __name__ == "__main__":
    main()
