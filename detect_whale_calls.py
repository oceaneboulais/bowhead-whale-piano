#!/usr/bin/env python3
"""
Bowhead Whale Call Detector
Specifically detects and extracts:
- Upsweeps (ascending frequency modulation)
- Downsweeps (descending frequency modulation)
- FM calls (complex frequency modulated vocalizations)
"""

import numpy as np
import scipy.io.wavfile as wavfile
from scipy import signal
from pathlib import Path
import json
import subprocess
import sys
from dataclasses import dataclass
from typing import List, Tuple, Optional

# Bowhead whale vocalization characteristics
# Based on research: bowhead calls typically 50-500 Hz, duration 0.5-3 seconds
FREQ_MIN = 30  # Hz - lower bound for bowhead calls
FREQ_MAX = 800  # Hz - upper bound  
CALL_MIN_DURATION = 0.5  # seconds
CALL_MAX_DURATION = 4.0  # seconds
SNR_THRESHOLD = 10  # dB - signal-to-noise ratio threshold
ENERGY_THRESHOLD_PERCENTILE = 85  # Percentile for energy detection

@dataclass
class WhaleCall:
    """Represents a detected whale call"""
    start_time: float  # seconds
    end_time: float
    duration: float
    call_type: str  # 'upsweep', 'downsweep', 'fm', 'tonal'
    freq_start: float  # Hz
    freq_end: float
    freq_range: float
    snr: float  # dB
    quality_score: float  # 0-100
    
    def __repr__(self):
        return f"{self.call_type.upper()} @ {self.start_time:.1f}s ({self.duration:.1f}s, {self.freq_start:.0f}-{self.freq_end:.0f}Hz, SNR:{self.snr:.1f}dB, Q:{self.quality_score:.1f})"


def extract_segment_to_mono(input_file: Path, start_time: float, duration: float, sample_rate: int = 2000) -> np.ndarray:
    """Extract audio segment using ffmpeg, convert to mono, downsample"""
    temp_file = Path('/tmp/whale_temp.raw')
    
    cmd = [
        'ffmpeg', '-i', str(input_file),
        '-ss', str(start_time),
        '-t', str(duration),
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-ar', str(sample_rate),
        '-ac', '1',
        str(temp_file),
        '-y'
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return None
    
    # Read raw audio
    audio = np.fromfile(temp_file, dtype=np.int16)
    temp_file.unlink()
    
    # Normalize
    if len(audio) > 0:
        audio = audio.astype(np.float32) / 32768.0
    
    return audio


def compute_spectrogram(audio: np.ndarray, sample_rate: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Compute spectrogram with focus on whale vocalization frequencies"""
    # Use parameters optimized for detecting whale calls
    nperseg = min(512, len(audio))
    noverlap = nperseg // 2
    
    f, t, Sxx = signal.spectrogram(
        audio,
        fs=sample_rate,
        window='hann',
        nperseg=nperseg,
        noverlap=noverlap,
        scaling='density'
    )
    
    # Convert to dB
    Sxx_db = 10 * np.log10(Sxx + 1e-10)
    
    return f, t, Sxx_db


def detect_frequency_modulation(Sxx_db: np.ndarray, freqs: np.ndarray, times: np.ndarray, 
                                 freq_min: float, freq_max: float) -> List[WhaleCall]:
    """Detect FM patterns (upsweeps, downsweeps) in spectrogram"""
    
    # Focus on whale frequency band
    freq_mask = (freqs >= freq_min) & (freqs <= freq_max)
    Sxx_band = Sxx_db[freq_mask, :]
    freqs_band = freqs[freq_mask]
    
    if len(freqs_band) == 0 or len(times) == 0:
        return []
    
    # Compute noise floor (median energy across frequency band)
    noise_floor = np.median(Sxx_band, axis=0)
    
    # Find time bins with significant energy above noise
    max_energy = np.max(Sxx_band, axis=0)
    snr = max_energy - noise_floor
    
    # Threshold: significant signal
    energy_threshold = np.percentile(snr, ENERGY_THRESHOLD_PERCENTILE)
    significant_times = snr > max(energy_threshold, SNR_THRESHOLD)
    
    # Find contiguous regions of high energy
    calls = []
    in_call = False
    call_start_idx = 0
    
    for i, has_energy in enumerate(significant_times):
        if has_energy and not in_call:
            # Start of potential call
            in_call = True
            call_start_idx = i
        elif (not has_energy or i == len(significant_times) - 1) and in_call:
            # End of potential call
            in_call = False
            call_end_idx = i
            
            # Analyze this segment
            call_start_time = times[call_start_idx]
            call_end_time = times[min(call_end_idx, len(times) - 1)]
            call_duration = call_end_time - call_start_time
            
            # Check duration
            if CALL_MIN_DURATION <= call_duration <= CALL_MAX_DURATION:
                # Extract frequency contour for this call
                call_segment = Sxx_band[:, call_start_idx:call_end_idx+1]
                
                if call_segment.shape[1] > 2:  # Need at least 3 time bins
                    # Track dominant frequency over time
                    freq_contour = []
                    for t_idx in range(call_segment.shape[1]):
                        max_freq_idx = np.argmax(call_segment[:, t_idx])
                        freq_contour.append(freqs_band[max_freq_idx])
                    
                    freq_start = freq_contour[0]
                    freq_end = freq_contour[-1]
                    freq_range = abs(freq_end - freq_start)
                    
                    # Classify call type based on frequency modulation
                    freq_change = freq_end - freq_start
                    freq_modulation = freq_range / (call_duration + 0.001)  # Hz/sec
                    
                    # Determine call type
                    if freq_modulation > 20:  # Significant FM
                        if freq_change > 30:
                            call_type = 'upsweep'
                        elif freq_change < -30:
                            call_type = 'downsweep'
                        else:
                            call_type = 'fm'
                    elif freq_range > 50:
                        call_type = 'fm'
                    else:
                        call_type = 'tonal'
                    
                    # Calculate quality metrics
                    avg_snr = np.mean(snr[call_start_idx:call_end_idx+1])
                    max_snr = np.max(snr[call_start_idx:call_end_idx+1])
                    
                    # Quality score based on SNR, duration, and frequency range
                    quality = (
                        min(avg_snr / 20, 1.0) * 40 +  # SNR component (40%)
                        min(call_duration / 2.0, 1.0) * 30 +  # Duration component (30%)
                        min(freq_range / 100, 1.0) * 30  # FM component (30%)
                    )
                    
                    call = WhaleCall(
                        start_time=call_start_time,
                        end_time=call_end_time,
                        duration=call_duration,
                        call_type=call_type,
                        freq_start=freq_start,
                        freq_end=freq_end,
                        freq_range=freq_range,
                        snr=avg_snr,
                        quality_score=quality
                    )
                    calls.append(call)
    
    return calls


def scan_file_for_calls(wav_file: Path, segment_duration: float = 120.0, 
                        sample_rate: int = 2000, max_segments: int = 20) -> List[WhaleCall]:
    """Scan WAV file for whale calls (limited segments for speed)"""
    
    # Get file duration
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', str(wav_file)],
        capture_output=True, text=True
    )
    
    try:
        total_duration = float(result.stdout.strip())
    except:
        print(f"    ⚠ Could not determine file duration")
        return []
    
    print(f"    Duration: {total_duration/3600:.1f}h | Scanning {max_segments} segments...", flush=True)
    
    # Sample segments throughout the file
    all_calls = []
    num_segments = min(max_segments, int(np.ceil(total_duration / segment_duration)))
    
    for seg_idx in range(num_segments):
        # Distribute segments across the file
        start_time = (total_duration / num_segments) * seg_idx
        
        print(f"      Segment {seg_idx+1}/{num_segments}... ", end='', flush=True)
        
        # Extract and analyze segment
        audio = extract_segment_to_mono(wav_file, start_time, segment_duration, sample_rate)
        
        if audio is None or len(audio) < sample_rate:
            print("skip", flush=True)
            continue
        
        # Compute spectrogram
        freqs, times, Sxx_db = compute_spectrogram(audio, sample_rate)
        
        # Detect calls
        calls = detect_frequency_modulation(Sxx_db, freqs, times + start_time, FREQ_MIN, FREQ_MAX)
        all_calls.extend(calls)
        print(f"{len(calls)} calls", flush=True)
    
    print(f"    ✓ Total: {len(all_calls)} calls (upsweeps/downsweeps/FM)", flush=True)
    
    return all_calls


def select_best_call(calls: List[WhaleCall], target_freq: float) -> Optional[WhaleCall]:
    """Select the best call for a given target frequency"""
    
    if not calls:
        return None
    
    # Filter for high-quality calls
    quality_threshold = 40
    good_calls = [c for c in calls if c.quality_score >= quality_threshold]
    
    if not good_calls:
        # Relax threshold
        good_calls = calls
    
    # Score each call based on frequency match and quality
    scored_calls = []
    for call in good_calls:
        # Check if target frequency is in the call's frequency range
        freq_match_score = 0
        avg_call_freq = (call.freq_start + call.freq_end) / 2
        
        freq_diff = abs(avg_call_freq - target_freq)
        semitone_diff = 12 * np.log2((avg_call_freq + 1) / (target_freq + 1))
        
        # Prefer calls with target freq in their range
        if call.freq_start <= target_freq <= call.freq_end or call.freq_end <= target_freq <= call.freq_start:
            freq_match_score = 100
        else:
            # Closer is better
            freq_match_score = max(0, 100 - abs(semitone_diff) * 5)
        
        # Combined score
        total_score = (
            freq_match_score * 0.4 +  # Frequency match (40%)
            call.quality_score * 0.6   # Quality (60%)
        )
        
        scored_calls.append((total_score, call))
    
    # Return best match
    scored_calls.sort(reverse=True, key=lambda x: x[0])
    return scored_calls[0][1] if scored_calls else None


def extract_call_clip(wav_file: Path, call: WhaleCall, output_file: Path, 
                      clip_duration: float = 3.0):
    """Extract the actual call as a 3-second clip"""
    
    # Center the call in the 3-second window if possible
    call_center = (call.start_time + call.end_time) / 2
    clip_start = max(0, call_center - clip_duration / 2)
    
    # Use ffmpeg to extract
    cmd = [
        'ffmpeg', '-i', str(wav_file),
        '-ss', str(clip_start),
        '-t', str(clip_duration),
        '-acodec', 'pcm_s16le',
        '-ar', '44100',
        '-ac', '1',
        str(output_file),
        '-y'
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True, stderr=subprocess.DEVNULL)
    return result.returncode == 0


def main():
    print("🐋 Bowhead Whale Call Detector")
    print("=" * 70)
    print("Detecting: Upsweeps, Downsweeps, FM Calls")
    print(f"Frequency range: {FREQ_MIN}-{FREQ_MAX} Hz")
    print(f"Call duration: {CALL_MIN_DURATION}-{CALL_MAX_DURATION} seconds")
    print("=" * 70)
    print()
    
    # Load manifest
    manifest_path = Path('wav-files/manifest.json')
    if not manifest_path.exists():
        print("❌ manifest.json not found in wav-files/")
        sys.exit(1)
    
    with open(manifest_path) as f:
        manifest = json.load(f)
    
    files = manifest['files']
    
    # Piano frequencies  
    piano_freqs = [
        27.50, 29.14, 30.87, 32.70, 34.65, 36.71, 38.89, 41.20, 43.65, 46.25, 49.00, 51.91,
        55.00, 58.27, 61.74, 65.41, 69.30, 73.42, 77.78, 82.41, 87.31, 92.50, 98.00, 103.83,
        110.00, 116.54, 123.47, 130.81, 138.59, 146.83, 155.56, 164.81, 174.61, 185.00, 196.00, 207.65,
        220.00, 233.08, 246.94, 261.63, 277.18, 293.66, 311.13, 329.63, 349.23, 369.99, 392.00, 415.30,
        440.00, 466.16, 493.88, 523.25, 554.37, 587.33, 622.25, 659.25, 698.46, 739.99, 783.99, 830.61,
        880.00, 932.33, 987.77, 1046.50, 1108.73, 1174.66, 1244.51, 1318.51, 1396.91, 1479.98, 1567.98, 1661.22,
        1760.00, 1864.66, 1975.53, 2093.00, 2217.46, 2349.32, 2489.02, 2637.02, 2793.83, 2959.96, 3135.96, 3322.44,
        3520.00, 3729.31, 3951.07, 4186.01
    ]
    
    note_names = [
        'A0', 'A#0', 'B0', 'C1', 'C#1', 'D1', 'D#1', 'E1', 'F1', 'F#1', 'G1', 'G#1',
        'A1', 'A#1', 'B1', 'C2', 'C#2', 'D2', 'D#2', 'E2', 'F2', 'F#2', 'G2', 'G#2',
        'A2', 'A#2', 'B2', 'C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3', 'G#3',
        'A3', 'A#3', 'B3', 'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4',
        'A4', 'A#4', 'B4', 'C5', 'C#5', 'D5', 'D#5', 'E5', 'F5', 'F#5', 'G5', 'G#5',
        'A5', 'A#5', 'B5', 'C6', 'C#6', 'D6', 'D#6', 'E6', 'F6', 'F#6', 'G6', 'G#6',
        'A6', 'A#6', 'B6', 'C7', 'C#7', 'D7', 'D#7', 'E7', 'F7', 'F#7', 'G7', 'G#7',
        'A7', 'A#7', 'B7', 'C8'
    ]
    
    output_dir = Path('wav-clips')
    output_dir.mkdir(exist_ok=True)
    
    print(f"Processing {len(files)} files...\n")
    
    for idx, file_info in enumerate(files):
        file_idx = idx
        note = note_names[file_idx]
        target_freq = piano_freqs[file_idx]
        wav_file = Path('wav-files') / file_info['newName']
        output_file = output_dir / file_info['newName']
        
        print(f"⏳ {idx+1}/88 {note} ({target_freq:.2f} Hz) - {file_info['newName']}")
        
        if not wav_file.exists():
            print(f"    ❌ Source file not found")
            continue
        
        # Scan for calls
        calls = scan_file_for_calls(wav_file, segment_duration=120.0, max_segments=15)
        
        if not calls:
            print(f"    ⚠ No whale calls detected, using middle of file")
            # Fallback: extract from middle
            result = subprocess.run(
                ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                 '-of', 'default=noprint_wrappers=1:nokey=1', str(wav_file)],
                capture_output=True, text=True
            )
            try:
                duration = float(result.stdout.strip())
                subprocess.run([
                    'ffmpeg', '-i', str(wav_file), '-ss', str(duration/2),
                    '-t', '3', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '1',
                    str(output_file), '-y'
                ], capture_output=True)
                print(f"    ✓ Extracted fallback clip")
            except:
                print(f"    ❌ Failed to extract fallback")
            continue
        
        # Display detected calls
        upsweeps = [c for c in calls if c.call_type == 'upsweep']
        downsweeps = [c for c in calls if c.call_type == 'downsweep']
        fm_calls = [c for c in calls if c.call_type == 'fm']
        tonal = [c for c in calls if c.call_type == 'tonal']
        
        print(f"    Detected: {len(upsweeps)} upsweeps, {len(downsweeps)} downsweeps, {len(fm_calls)} FM, {len(tonal)} tonal")
        
        # Select best call
        best_call = select_best_call(calls, target_freq)
        
        if best_call:
            print(f"    Best: {best_call}")
            
            # Extract clip
            success = extract_call_clip(wav_file, best_call, output_file)
            if success:
                file_size = output_file.stat().st_size / 1024 / 1024
                print(f"    ✓ Extracted {file_size:.1f} MB - {best_call.call_type.upper()} call")
            else:
                print(f"    ❌ Failed to extract clip")
        else:
            print(f"    ⚠ No suitable call found")
        
        print()


if __name__ == '__main__':
    main()
