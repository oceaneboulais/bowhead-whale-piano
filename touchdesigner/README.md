# 🌊 TouchDesigner visualizer — Bowhead Whale Piano

Real-time, audio-reactive **bioluminescent latent ocean** for live performance:
slow vertical jellyfish tendrils, a luminous wake, and seeds injected per note —
driven by the piano over WebSocket **and** the actual audio via a virtual device.

> The piano ships with an in-browser version of this look already (the **🌊 Visualizer**
> button). Use TouchDesigner when you want it full-screen on a projector / second
> screen, higher fidelity, or as part of a larger installation.

## 1. Route the audio in (BlackHole)

TouchDesigner reacts to the real whale sound through a virtual audio device.

```bash
brew install blackhole-2ch
```

Then in **Audio MIDI Setup** (macOS):
- Create a **Multi-Output Device** containing *both* your speakers/headphones **and**
  BlackHole 2ch — so you hear the piano *and* TD receives it.
- Set the Multi-Output Device as the system (or browser) output.

## 2. Build the network

1. Open TouchDesigner (a fresh project is fine).
2. Create a **Text DAT**, paste in `build_whale_viz.py`.
3. Right-click the Text DAT → **Run Script**.

This creates `/whale_viz` with the WebSocket server, audio chain, GLSL feedback
sim, bloom, and an `OUT` TOP. Then:

- Select **`audioin`** → set its **Device** to *BlackHole 2ch*.
- Confirm **`websocket1`** is **Active**, port **9980**.
- Right-click **`OUT`** → **View** (or drag to a Perform window / second screen).

## 3. Play

Open the piano in **Chrome** (`./start.sh` from the repo root, or the live site),
click **Auto-Load**, and play. The page connects to `ws://localhost:9980`
automatically — the status line under the buttons reads **"Visualizer: connected
to TouchDesigner."** Each note injects a glowing seed that drifts upward as a
tendril; louder calls increase rise and turbulence.

## Data protocol (WebSocket, JSON text frames)

The piano sends, on every key:

```jsonc
{ "type": "noteon",  "key": 41, "note": "D4", "pitchHz": 293.66, "clipHz": 157.33, "rate": 1.87, "t": 12.34 }
{ "type": "noteoff", "key": 41, "note": "D4", "t": 12.91 }
```

`build_whale_viz.py` parses these into the `notes` table (one row per active note),
which becomes the `seeds` texture (x, y, hue, intensity) sampled by the shader.
To override the endpoint, set `window.TD_WS_URL = 'ws://host:port'` before `app.js`
loads. The **TouchDesigner link** checkbox in the visualizer popup enables/disables
sending.

## Tuning / troubleshooting

- **Nothing connects:** TD WebSocket DAT must be **server** mode, Active, port 9980.
  Chrome allows `ws://localhost` even from the https site (localhost is exempt from
  mixed-content); other browsers may block it — use Chrome.
- **`OUT` is black:** check the `sim` GLSL TOP has no compile error (its viewer shows
  errors in red). If the pixel shader is blank, paste the `SIM_FRAG` string from
  `build_whale_viz.py` into the GLSL TOP's pixel shader DAT.
- **No audio reactivity:** `audioin` Device must be BlackHole and the system output
  must route to it; `audio_level` should show a moving value.
- **CHOP→TOP seed order:** `seeds` must carry channels in R,G,B,A = x, y, hue,
  intensity order (`seed_select`'s channel names). Adjust if your build reorders them.
- This script targets TD 2022+/2023 Python op names; if a `create()` errors on an op
  type, the operator family name may differ in your build — create that one op by
  hand and re-run.
