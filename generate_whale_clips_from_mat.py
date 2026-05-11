#!/usr/bin/env python3
"""
Generate 88 whale-call WAV clips from .mat spectrogram files.

Each of the 88 piano keys (A0–C8) is matched to the best-fitting bowhead
whale call in the dataset (Types 1-7, i.e. confirmed whale calls, not noise).
Audio is reconstructed from the SNR_gram via Griffin-Lim, then pitch-shifted
to the exact piano-key frequency, and saved at 44100 Hz to wav-clips/.
"""

import os
import glob
import numpy as np
import scipy.io as sio
import scipy.signal as sig
import soundfile as sf

# ── constants ────────────────────────────────────────────────────────────────
MAT_DIR   = "/Users/oceaneboulais/Github/ThodeLab/BCB_Whale_Datasets/Unsupervised_database_ManyWhaleCalls.dir"
OUT_DIR   = "/Users/oceaneboulais/BowheadRingtones/wav-clips"
OUT_SR    = 44100        # output sample rate for browser playback
CLIP_SECS = 3.0          # desired output clip length in seconds

# STFT parameters inferred from the .mat metadata
# dF = 3.9062 Hz  →  n_fft = fs / dF
# dT = 0.026 s    →  hop   = dT * fs
# 121 freq bins (real STFT)  →  n_fft/2 + 1 = 121  →  n_fft = 240  →  fs = 937.5 Hz
FS_NATIVE  = 937.5
N_FFT      = 240
HOP        = 24          # 0.026 * 937.5 = 24.375  ≈ 24
DF         = FS_NATIVE / N_FFT   # 3.906 Hz

# 88 piano key frequencies, A0 → C8
PIANO_FREQUENCIES = [
    27.50,  29.14,  30.87,  32.70,  34.65,  36.71,  38.89,  41.20,
    43.65,  46.25,  49.00,  51.91,  55.00,  58.27,  61.74,  65.41,
    69.30,  73.42,  77.78,  82.41,  87.31,  92.50,  98.00, 103.83,
   110.00, 116.54, 123.47, 130.81, 138.59, 146.83, 155.56, 164.81,
   174.61, 185.00, 196.00, 207.65, 220.00, 233.08, 246.94, 261.63,
   277.18, 293.66, 311.13, 329.63, 349.23, 369.99, 392.00, 415.30,
   440.00, 466.16, 493.88, 523.25, 554.37, 587.33, 622.25, 659.25,
   698.46, 739.99, 783.99, 830.61, 880.00, 932.33, 987.77,1046.50,
  1108.73,1174.66,1244.51,1318.51,1396.91,1479.98,1567.98,1661.22,
  1760.00,1864.66,1975.53,2093.00,2217.46,2349.32,2489.02,2637.02,
  2793.83,2959.96,3135.96,3322.44,3520.00,3729.31,3951.07,4186.01,
]

NOTE_NAMES = [
    'A0','A#0','B0','C1','C#1','D1','D#1','E1','F1','F#1','G1','G#1',
    'A1','A#1','B1','C2','C#2','D2','D#2','E2','F2','F#2','G2','G#2',
    'A2','A#2','B2','C3','C#3','D3','D#3','E3','F3','F#3','G3','G#3',
    'A3','A#3','B3','C4','C#4','D4','D#4','E4','F4','F#4','G4','G#4',
    'A4','A#4','B4','C5','C#5','D5','D#5','E5','F5','F#5','G5','G#5',
    'A5','A#5','B5','C6','C#6','D6','D#6','E6','F6','F#6','G6','G#6',
    'A6','A#6','B6','C7','C#7','D7','D#7','E7','F7','F#7','G7','G#7',
    'A7','A#7','B7','C8',
]

assert len(PIANO_FREQUENCIES) == 88
assert len(NOTE_NAMES) == 88

# ── Griffin-Lim reconstruction ───────────────────────────────────────────────
def griffin_lim(magnitude, n_fft=N_FFT, hop_length=HOP, n_iter=60):
    """Reconstruct a time-domain signal from a magnitude spectrogram."""
    # Random initial phase
    rng = np.random.default_rng(42)
    angles = np.exp(1j * 2 * np.pi * rng.random(magnitude.shape))
    
    window = np.hanning(n_fft)
    
    for _ in range(n_iter):
        # ISTFT with current estimate
        _, audio = sig.istft(
            magnitude * angles,
            fs=FS_NATIVE,
            window=window,
            nperseg=n_fft,
            noverlap=n_fft - hop_length,
            nfft=n_fft,
        )
        # Re-analyse
        _, _, Z = sig.stft(
            audio,
            fs=FS_NATIVE,
            window=window,
            nperseg=n_fft,
            noverlap=n_fft - hop_length,
            nfft=n_fft,
        )
        # Update angles from new STFT, keep original magnitude
        n_rows = magnitude.shape[0]
        n_cols = magnitude.shape[1]
        angles = np.exp(1j * np.angle(Z[:n_rows, :n_cols]))
    
    _, audio = sig.istft(
        magnitude * angles,
        fs=FS_NATIVE,
        window=window,
        nperseg=n_fft,
        noverlap=n_fft - hop_length,
        nfft=n_fft,
    )
    return audio.astype(np.float32)


def dominant_freq(snr_gram):
    """Return the dominant frequency (Hz) of an SNR_gram."""
    mean_snr = snr_gram.astype(float).mean(axis=1)   # avg over time
    peak_bin = int(np.argmax(mean_snr))
    return peak_bin * DF


def resample_to(audio, from_sr, to_sr):
    """Resample audio from from_sr to to_sr (preserves pitch)."""
    n_out = int(round(len(audio) * to_sr / from_sr))
    return sig.resample(audio, n_out).astype(np.float32)


def pitch_shift_resample(audio, sr, from_freq, to_freq):
    """
    Shift pitch from from_freq → to_freq by resampling.
    The ratio to_freq/from_freq is how much faster/slower we replay.
    This changes length; we correct back to the original length afterward.
    """
    if from_freq <= 0 or to_freq <= 0:
        return audio
    ratio = to_freq / from_freq
    # Resample to ratio*sr (pitch shifts up by ratio)
    n_out = int(round(len(audio) / ratio))
    shifted = sig.resample(audio, n_out).astype(np.float32)
    return shifted


# ── Index all confirmed whale call files ─────────────────────────────────────
print("Indexing whale call .mat files …")
all_mat_files = sorted(glob.glob(os.path.join(MAT_DIR, "*.mat")))

whale_calls = []   # list of dicts: {path, dominant_freq, type}
for path in all_mat_files:
    basename = os.path.basename(path)
    # Skip Type0 (noise only)
    if "_Type0.mat" in basename:
        continue
    mat = sio.loadmat(path)
    snr = mat["SNR_gram"].astype(np.float32)
    df = dominant_freq(snr)
    call_type = int(basename.split("_Type")[1].replace(".mat", ""))
    whale_calls.append({
        "path": path,
        "dom_freq": df,
        "type": call_type,
        "snr_gram": snr,
    })

print(f"  Found {len(whale_calls)} confirmed whale call files (Types 1-7)")

# Sort by dominant frequency for easier assignment
whale_calls.sort(key=lambda x: x["dom_freq"])

dom_freqs = np.array([c["dom_freq"] for c in whale_calls])

# ── Assign one unique .mat to each of the 88 piano keys ──────────────────────
print("Assigning whale calls to piano keys …")

used_indices = set()
assignments = []   # (piano_key_idx, whale_call_dict, actual_dom_freq)

# Two-pass greedy assignment: for each key find closest unused whale call
piano_freqs = np.array(PIANO_FREQUENCIES)

# Clamp target to actual whale call frequency range to find best match
freq_min = dom_freqs.min()
freq_max = dom_freqs.max()

for key_idx, target_freq in enumerate(PIANO_FREQUENCIES):
    # Find closest available whale call
    clamped = np.clip(target_freq, freq_min, freq_max)
    dist = np.abs(dom_freqs - clamped)
    
    # Walk outward from best match until we find an unused one
    order = np.argsort(dist)
    chosen = None
    for idx in order:
        if idx not in used_indices:
            chosen = idx
            break
    
    if chosen is None:
        # Fallback: reuse the best match (shouldn't happen with 2073 files for 88 keys)
        chosen = int(np.argmin(dist))
    
    used_indices.add(chosen)
    assignments.append((key_idx, whale_calls[chosen]))

# ── Generate WAVs ─────────────────────────────────────────────────────────────
os.makedirs(OUT_DIR, exist_ok=True)
target_len_native = int(CLIP_SECS * FS_NATIVE)
target_len_out    = int(CLIP_SECS * OUT_SR)

print(f"\nGenerating {len(assignments)} WAV clips …\n")
for key_idx, call in assignments:
    note  = NOTE_NAMES[key_idx]
    piano_freq = PIANO_FREQUENCIES[key_idx]
    dom_f = call["dom_freq"]
    fname = f"whale_sound_{key_idx+1:03d}.WAV"
    out_path = os.path.join(OUT_DIR, fname)

    snr = call["snr_gram"]
    
    # Convert uint8 SNR (dB) to linear magnitude for Griffin-Lim
    # Clip negatives, convert dB → amplitude: A = 10^(dB/20)
    snr_db = np.clip(snr.astype(float), 0, None)
    magnitude = np.power(10.0, snr_db / 20.0)
    
    # Reconstruct audio at native sample rate
    audio_native = griffin_lim(magnitude)
    
    # Resample to output sample rate (preserves frequency content)
    audio_out = resample_to(audio_native, FS_NATIVE, OUT_SR)
    
    # Pitch-shift to match the piano key frequency
    audio_shifted = pitch_shift_resample(audio_out, OUT_SR, dom_f, piano_freq)
    
    # Trim or loop-tile to exactly CLIP_SECS
    if len(audio_shifted) > target_len_out:
        audio_shifted = audio_shifted[:target_len_out]
    elif len(audio_shifted) < target_len_out:
        # Tile (loop) instead of zero-pad so high keys don't end in silence
        repeats = int(np.ceil(target_len_out / len(audio_shifted)))
        audio_shifted = np.tile(audio_shifted, repeats)[:target_len_out]
    
    # Normalize to prevent clipping
    peak = np.abs(audio_shifted).max()
    if peak > 0:
        audio_shifted = audio_shifted / peak * 0.9
    
    # Apply short fade-in / fade-out to avoid clicks
    fade_samps = int(0.02 * OUT_SR)  # 20 ms
    fade_in  = np.linspace(0, 1, fade_samps)
    fade_out = np.linspace(1, 0, fade_samps)
    audio_shifted[:fade_samps]  *= fade_in
    audio_shifted[-fade_samps:] *= fade_out
    
    sf.write(out_path, audio_shifted, OUT_SR, subtype="PCM_16")
    print(f"  [{key_idx+1:2d}/88] {note:5s}  target={piano_freq:7.2f}Hz  "
          f"source={dom_f:6.1f}Hz  type={call['type']}  → {fname}")

print(f"\n✓ Done! {len(assignments)} clips written to {OUT_DIR}")
