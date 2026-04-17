# 🐋 Bowhead Whale Piano

A browser-based web application that transforms bowhead whale vocalizations into a playable piano keyboard. The app analyzes the frequency content of whale sound files and intelligently maps them to piano keys based on their dominant frequencies.

## Features

- **Seeded Random Selection**: Uses seed 42 to ensure consistent, reproducible file selection across runs
- **Equal Folder Distribution**: Automatically selects equal proportions from all folders (S213gsif, S313gsif, S413gsif, S513gsif)
- **Automated Preparation**: `prepare-whale-sounds.js` script scans 1875+ whale sound files and selects the best 88
- **Frequency Analysis**: Automatically analyzes each .wav file's dominant frequency using autocorrelation and FFT algorithms
- **Intelligent Mapping**: Maps whale sounds to the 88 piano keys (A0 to C8) based on frequency matching
- **Interactive Piano**: Visual piano keyboard with both mouse/touch and keyboard control
- **Real-time Playback**: Play whale sounds through Web Audio API with low latency
- **Frequency Visualization**: View the mapping of whale sounds to piano frequencies in a detailed table
- **Local Server**: Simple HTTP server for loading pre-selected files

## How It Works

1. **Load Whale Sounds**: Select your .wav files containing bowhead whale vocalizations
2. **Frequency Analysis**: The app analyzes each file's dominant frequency over a 3-second interval using:
   - Autocorrelation for fundamental frequency detection
   - FFT (Fast Fourier Transform) as a fallback method
3. **Intelligent Mapping**:
   - Sounds are sorted by frequency (low to high)
   - Each sound is mapped to the nearest piano key frequency
   - If you have fewer than 88 files, they map to their closest matches
   - If you have more than 88 files, the best-matching 88 are selected
4. **Play**: Click piano keys or use your keyboard to play the whale sounds!

## Usage

### Quick Start (Recommended)

1. **Prepare the whale sounds** with seed 42 for reproducible selection:
   ```bash
   node prepare-whale-sounds.js
   ```
   This scans `/Volumes/Bowhead/Shell2013_GSI_Data` and selects 88 .WAV files randomly (seed: 42) with equal proportion from all 4 folders.

2. **Start the local server**:
   ```bash
   node server.js
   ```

3. **Open your browser** and go to:
   ```
   http://localhost:8080/
   ```

4. **Click "Auto-Load Prepared Whale Sounds"** - the app will automatically load and analyze the 88 pre-selected files

5. **Play the piano!**

### Alternative: Manual File Selection

If you prefer to select files manually:

1. Open `index.html` in a modern web browser (Chrome, Firefox, Safari, Edge)
2. Click "Load Whale Sound Files (.wav)"
3. Select your .wav files from your VPN server or local directory
4. Click "Analyze Frequencies & Map to Piano"
5. Wait for the analysis to complete (you'll see progress updates)
6. Play the piano!

### Controls

**Mouse/Touch:**
- Click or tap any piano key to play the corresponding whale sound

**Keyboard Shortcuts (Middle Octave):**
- White keys: `A S D F G H J K L ;`
- Black keys: `W E T Y U O P`

## Piano Key Mapping

The piano includes all 88 standard piano keys:
- **Range**: A0 (27.50 Hz) to C8 (4186.01 Hz)
- **Notes**: Standard chromatic scale with sharps/flats
- Each key is mapped to the whale sound with the closest matching frequency

## Technical Details

### Frequency Analysis Algorithm

The app uses two methods for determining dominant frequency:

1. **Autocorrelation** (Primary method):
   - Robust pitch detection algorithm
   - Works well for tonal sounds with clear fundamental frequencies
   - Analyzes signal periodicity

2. **FFT Peak Detection** (Fallback):
   - Used when autocorrelation doesn't find a clear peak
   - Identifies the strongest frequency component

### Audio Processing

- **Sample Rate**: Preserves original .wav file sample rate
- **Analysis Window**: First 3 seconds of each file
- **Playback**: Uses Web Audio API for low-latency, high-quality playback
- **Format Support**: .wav files (uncompressed PCM audio)

## Browser Compatibility

- ✅ Chrome/Edge (Recommended)
- ✅ Firefox
- ✅ Safari
- Requires a modern browser with Web Audio API support

## File Structure

```
BowheadRingtones/
├── index.html                 # Main HTML interface
├── styles.css                 # Piano and UI styling
├── app.js                     # Core application logic and audio processing
├── server.js                  # Local HTTP server for auto-loading files
├── prepare-whale-sounds.js    # Script to select 88 files with seed 42
├── wav-files/                 # Directory with prepared whale sounds (created by script)
│   ├── whale_sound_001.WAV
│   ├── whale_sound_002.WAV
│   ├── ...                    # (88 files total)
│   └── manifest.json          # File mapping and metadata
└── README.md                  # This file
```

## Whale Sound Selection Process

The `prepare-whale-sounds.js` script:
1. Scans `/Volumes/Bowhead/Shell2013_GSI_Data` (1875+ files across 4 folders)
2. Groups files by top-level folder (S213gsif, S313gsif, S413gsif, S513gsif)
3. Uses **Mulberry32 seeded random** (seed: 42) for reproducible selection
4. Selects **exactly 22 files from each folder** for equal representation
5. Copies selected files to `wav-files/` with sequential naming
6. Generates `manifest.json` with original file mappings

This ensures:
- ✅ Consistent selection across runs (same seed = same files)
- ✅ Equal representation from all data collection periods
- ✅ Exactly 88 files to match piano keys

## Troubleshooting

### Files won't load
- Ensure files are .wav format
- Check browser console for errors
- Try with a smaller number of files first

### No sound playback
- Check browser audio permissions
- Ensure volume is turned up
- Try clicking the page first (some browsers require user interaction)

### Frequency analysis seems incorrect
- Whale vocalizations vary in complexity
- Very noisy recordings may affect frequency detection
- The app analyzes the first 3 seconds; ensure this contains representative sound

## Future Enhancements

- Volume control per key
- Pitch shifting to match exact piano frequencies
- Visual waveform display
- Export mapping as JSON
- Record and playback compositions
- MIDI support

## Audio Science Notes

Bowhead whales produce complex vocalizations ranging from low-frequency moans to higher-pitched calls. Their frequency range can overlap with musical notes, making them suitable for this creative application. The dominant frequency extracted represents the fundamental pitch that humans perceive most strongly in each vocalization.

## License

This project is open source and available for educational and research purposes.

---

**Created for marine biology enthusiasts and creative audio explorers!** 🎹🐋
