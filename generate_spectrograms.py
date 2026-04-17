#!/usr/bin/env python3

"""
Whale Piano Spectrogram Generator

Generates spectrograms for all 88 whale sound clips mapped to piano keys.
Creates both individual spectrograms and a combined visualization.
"""

import os
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from scipy.io import wavfile
from scipy import signal
import json

# Configuration
WAV_CLIPS_DIR = 'wav-clips'
OUTPUT_DIR = 'spectrograms'
MANIFEST_FILE = 'wav-files/manifest.json'

# Piano frequencies (A0 to C8 - 88 keys)
PIANO_FREQUENCIES = [
    27.50, 29.14, 30.87, 32.70, 34.65, 36.71, 38.89, 41.20, 43.65, 46.25, 49.00, 51.91,
    55.00, 58.27, 61.74, 65.41, 69.30, 73.42, 77.78, 82.41, 87.31, 92.50, 98.00, 103.83,
    110.00, 116.54, 123.47, 130.81, 138.59, 146.83, 155.56, 164.81, 174.61, 185.00, 196.00, 207.65,
    220.00, 233.08, 246.94, 261.63, 277.18, 293.66, 311.13, 329.63, 349.23, 369.99, 392.00, 415.30,
    440.00, 466.16, 493.88, 523.25, 554.37, 587.33, 622.25, 659.25, 698.46, 739.99, 783.99, 830.61,
    880.00, 932.33, 987.77, 1046.50, 1108.73, 1174.66, 1244.51, 1318.51, 1396.91, 1479.98, 1567.98, 1661.22,
    1760.00, 1864.66, 1975.53, 2093.00, 2217.46, 2349.32, 2489.02, 2637.02, 2793.83, 2959.96, 3135.96, 3322.44,
    3520.00, 3729.31, 3951.07, 4186.01
]

NOTE_NAMES = [
    'A0', 'A#0', 'B0',
    'C1', 'C#1', 'D1', 'D#1', 'E1', 'F1', 'F#1', 'G1', 'G#1',
    'A1', 'A#1', 'B1',
    'C2', 'C#2', 'D2', 'D#2', 'E2', 'F2', 'F#2', 'G2', 'G#2',
    'A2', 'A#2', 'B2',
    'C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3', 'G#3',
    'A3', 'A#3', 'B3',
    'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4',
    'A4', 'A#4', 'B4',
    'C5', 'C#5', 'D5', 'D#5', 'E5', 'F5', 'F#5', 'G5', 'G#5',
    'A5', 'A#5', 'B5',
    'C6', 'C#6', 'D6', 'D#6', 'E6', 'F6', 'F#6', 'G6', 'G#6',
    'A6', 'A#6', 'B6',
    'C7', 'C#7', 'D7', 'D#7', 'E7', 'F7', 'F#7', 'G7', 'G#7',
    'A7', 'A#7', 'B7',
    'C8'
]

def generate_spectrogram(audio_data, sample_rate, target_freq, note_name):
    """Generate spectrogram data for audio clip."""
    # Compute spectrogram
    frequencies, times, Sxx = signal.spectrogram(
        audio_data,
        fs=sample_rate,
        window='hann',
        nperseg=2048,
        noverlap=1536,
        scaling='spectrum'
    )
    
    # Convert to dB scale
    Sxx_db = 10 * np.log10(Sxx + 1e-10)
    
    return frequencies, times, Sxx_db

def plot_individual_spectrogram(filename, audio_data, sample_rate, target_freq, note_name, output_path):
    """Create individual spectrogram plot."""
    frequencies, times, Sxx_db = generate_spectrogram(audio_data, sample_rate, target_freq, note_name)
    
    fig, ax = plt.subplots(figsize=(12, 6))
    
    # Plot spectrogram
    im = ax.pcolormesh(times, frequencies, Sxx_db, shading='gouraud', cmap='viridis')
    
    # Calculate optimal frequency range (±1 semitone = ±100 cents)
    # Formula: f = target × 2^(semitones/12)
    semitone_range = 1.0  # ±1 semitone
    freq_lower = target_freq * (2 ** (-semitone_range / 12))
    freq_upper = target_freq * (2 ** (semitone_range / 12))
    
    # Add shaded optimal frequency range
    ax.axhspan(freq_lower, freq_upper, color='yellow', alpha=0.2, 
               label=f'Optimal Range: {freq_lower:.2f}-{freq_upper:.2f} Hz (±1 semitone)')
    
    # Add target frequency line
    ax.axhline(y=target_freq, color='red', linestyle='--', linewidth=2, 
               label=f'Target: {target_freq:.2f} Hz')
    
    # Formatting
    ax.set_ylabel('Frequency (Hz)')
    ax.set_xlabel('Time (seconds)')
    ax.set_title(f'{note_name} - {filename}\nTarget Frequency: {target_freq:.2f} Hz', fontsize=14, fontweight='bold')
    ax.set_ylim([0, min(2000, sample_rate / 2)])  # Show up to 2000 Hz or Nyquist
    ax.legend(loc='upper right')
    ax.grid(True, alpha=0.3)
    
    # Add colorbar
    cbar = plt.colorbar(im, ax=ax)
    cbar.set_label('Power (dB)', rotation=270, labelpad=20)
    
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()
    
    return frequencies, times, Sxx_db

def create_combined_plot(all_spectrograms, output_path):
    """Create a combined visualization of all 88 spectrograms."""
    # Create a grid: 11 rows x 8 columns
    fig = plt.figure(figsize=(24, 32))
    gs = gridspec.GridSpec(11, 8, figure=fig, hspace=0.4, wspace=0.3)
    
    fig.suptitle('🐋 Bowhead Whale Piano - All 88 Keys Spectrograms', 
                 fontsize=20, fontweight='bold', y=0.995)
    
    for idx, spec_data in enumerate(all_spectrograms):
        row = idx // 8
        col = idx % 8
        
        ax = fig.add_subplot(gs[row, col])
        
        frequencies = spec_data['frequencies']
        times = spec_data['times']
        Sxx_db = spec_data['spectrogram']
        target_freq = spec_data['target_freq']
        note_name = spec_data['note_name']
        
        # Plot spectrogram
        im = ax.pcolormesh(times, frequencies, Sxx_db, 
                          shading='gouraud', cmap='viridis', vmin=-80, vmax=-20)
        
        # Calculate optimal frequency range (±1 semitone)
        semitone_range = 1.0
        freq_lower = target_freq * (2 ** (-semitone_range / 12))
        freq_upper = target_freq * (2 ** (semitone_range / 12))
        
        # Add shaded optimal frequency range
        ax.axhspan(freq_lower, freq_upper, color='yellow', alpha=0.15, zorder=2)
        
        # Add target frequency line
        ax.axhline(y=target_freq, color='red', linestyle='-', linewidth=1, alpha=0.8, zorder=3)
        
        # Formatting
        ax.set_title(f'{note_name}\n{target_freq:.1f}Hz', fontsize=8, fontweight='bold')
        ax.set_ylim([0, min(1000, frequencies[-1])])
        
        # Only show labels on edges to avoid clutter
        if col == 0:
            ax.set_ylabel('Frequency (Hz)', fontsize=8)
        else:
            ax.set_yticklabels([])
        
        if row == 10:
            ax.set_xlabel('Time (seconds)', fontsize=8)
        else:
            ax.set_xticklabels([])
        
        ax.tick_params(labelsize=6)
    
    plt.savefig(output_path, dpi=200, bbox_inches='tight')
    print(f'\n✓ Combined plot saved: {output_path}')
    plt.close()

def create_frequency_distribution_plot(all_spectrograms, output_path):
    """Create a plot showing frequency distribution across all keys."""
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(16, 10))
    
    # Top plot: Average power at target frequency for each key
    keys = []
    target_freqs = []
    power_at_target = []
    
    for spec_data in all_spectrograms:
        keys.append(spec_data['note_name'])
        target_freqs.append(spec_data['target_freq'])
        
        # Find power near target frequency
        frequencies = spec_data['frequencies']
        Sxx_db = spec_data['spectrogram']
        
        # Find closest frequency bin
        target_idx = np.argmin(np.abs(frequencies - spec_data['target_freq']))
        
        # Average power across time at target frequency
        avg_power = np.mean(Sxx_db[target_idx, :])
        power_at_target.append(avg_power)
    
    # Plot 1: Power at target frequency
    colors = plt.cm.rainbow(np.linspace(0, 1, len(keys)))
    ax1.bar(range(len(keys)), power_at_target, color=colors, edgecolor='black', linewidth=0.5)
    ax1.set_xlabel('Piano Key', fontsize=12, fontweight='bold')
    ax1.set_ylabel('Average Power at Target Frequency (dB)', fontsize=12, fontweight='bold')
    ax1.set_title('Power Distribution Across Piano Keys', fontsize=14, fontweight='bold')
    ax1.grid(True, alpha=0.3, axis='y')
    
    # Add note labels for every 12th note (each octave)
    tick_positions = list(range(0, len(keys), 12))
    tick_labels = [keys[i] for i in tick_positions]
    ax1.set_xticks(tick_positions)
    ax1.set_xticklabels(tick_labels, rotation=0)
    
    # Plot 2: Target frequency curve
    ax2.plot(range(len(keys)), target_freqs, 'b-', linewidth=2, label='Target Frequencies')
    ax2.set_xlabel('Piano Key', fontsize=12, fontweight='bold')
    ax2.set_ylabel('Frequency (Hz)', fontsize=12, fontweight='bold')
    ax2.set_title('Piano Key Frequency Distribution (Logarithmic Scale)', fontsize=14, fontweight='bold')
    ax2.set_yscale('log')
    ax2.grid(True, alpha=0.3, which='both')
    ax2.legend()
    
    # Add note labels
    ax2.set_xticks(tick_positions)
    ax2.set_xticklabels(tick_labels, rotation=0)
    
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f'✓ Frequency distribution plot saved: {output_path}')
    plt.close()

def main():
    print('🐋 Whale Piano Spectrogram Generator')
    print('=' * 70)
    print('')
    
    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(os.path.join(OUTPUT_DIR, 'individual'), exist_ok=True)
    
    # Load manifest
    if not os.path.exists(MANIFEST_FILE):
        print(f'❌ Manifest file not found: {MANIFEST_FILE}')
        return
    
    with open(MANIFEST_FILE, 'r') as f:
        manifest = json.load(f)
    
    files = manifest['files']
    print(f'Found {len(files)} files in manifest\n')
    
    all_spectrograms = []
    
    # Process each file
    for idx, file_info in enumerate(files):
        if idx >= len(PIANO_FREQUENCIES):
            break
        
        filename = file_info['newName']
        filepath = os.path.join(WAV_CLIPS_DIR, filename)
        target_freq = PIANO_FREQUENCIES[idx]
        note_name = NOTE_NAMES[idx]
        
        if not os.path.exists(filepath):
            print(f'⏭  {idx + 1}/88 {note_name} - {filename} (file not found)')
            continue
        
        print(f'⏳ {idx + 1}/88 {note_name} ({target_freq:.2f} Hz) - Processing {filename}...')
        
        try:
            # Read WAV file
            sample_rate, audio_data = wavfile.read(filepath)
            
            # Convert to mono if stereo
            if len(audio_data.shape) > 1:
                audio_data = audio_data.mean(axis=1)
            
            # Normalize
            audio_data = audio_data.astype(float)
            
            # Generate and save individual spectrogram
            individual_output = os.path.join(OUTPUT_DIR, 'individual', f'{idx + 1:02d}_{note_name}_{filename.replace(".WAV", ".png")}')
            frequencies, times, Sxx_db = plot_individual_spectrogram(
                filename, audio_data, sample_rate, target_freq, note_name, individual_output
            )
            
            # Store for combined plot
            all_spectrograms.append({
                'note_name': note_name,
                'target_freq': target_freq,
                'filename': filename,
                'frequencies': frequencies,
                'times': times,
                'spectrogram': Sxx_db
            })
            
            print(f'   ✓ Spectrogram saved\n')
            
        except Exception as e:
            print(f'   ✗ Error: {e}\n')
    
    # Create combined visualization
    if all_spectrograms:
        print(f'\nGenerating combined visualization of {len(all_spectrograms)} spectrograms...')
        combined_output = os.path.join(OUTPUT_DIR, 'all_keys_combined.png')
        create_combined_plot(all_spectrograms, combined_output)
        
        print(f'\nGenerating frequency distribution analysis...')
        freq_dist_output = os.path.join(OUTPUT_DIR, 'frequency_distribution.png')
        create_frequency_distribution_plot(all_spectrograms, freq_dist_output)
    
    print('\n' + '=' * 70)
    print('✅ Complete!')
    print(f'\nSpectrograms saved to: {OUTPUT_DIR}/')
    print(f'  - Individual spectrograms: {OUTPUT_DIR}/individual/')
    print(f'  - Combined view: {OUTPUT_DIR}/all_keys_combined.png')
    print(f'  - Frequency analysis: {OUTPUT_DIR}/frequency_distribution.png')
    print('')

if __name__ == '__main__':
    main()
