// Bowhead Whale Piano App
// Maps whale sounds to piano keys based on frequency analysis

// Piano key frequencies (A0 to C8 - 88 keys)
const PIANO_FREQUENCIES = [
    27.50, 29.14, 30.87, 32.70, 34.65, 36.71, 38.89, 41.20, 43.65, 46.25, 49.00, 51.91, // A0-G#0
    55.00, 58.27, 61.74, 65.41, 69.30, 73.42, 77.78, 82.41, 87.31, 92.50, 98.00, 103.83, // A1-G#1
    110.00, 116.54, 123.47, 130.81, 138.59, 146.83, 155.56, 164.81, 174.61, 185.00, 196.00, 207.65, // A2-G#2
    220.00, 233.08, 246.94, 261.63, 277.18, 293.66, 311.13, 329.63, 349.23, 369.99, 392.00, 415.30, // A3-G#3
    440.00, 466.16, 493.88, 523.25, 554.37, 587.33, 622.25, 659.25, 698.46, 739.99, 783.99, 830.61, // A4-G#4
    880.00, 932.33, 987.77, 1046.50, 1108.73, 1174.66, 1244.51, 1318.51, 1396.91, 1479.98, 1567.98, 1661.22, // A5-G#5
    1760.00, 1864.66, 1975.53, 2093.00, 2217.46, 2349.32, 2489.02, 2637.02, 2793.83, 2959.96, 3135.96, 3322.44, // A6-G#6
    3520.00, 3729.31, 3951.07, 4186.01 // A7-C8
];

const NOTE_NAMES = [
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
];

class BowheadPiano {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.whaleFiles = [];
        this.audioBuffers = new Map();
        this.fileManifest = null; // Store manifest for lazy loading
        this.loadingKeys = new Set(); // Track which keys are currently loading
        this.frequencyMap = new Map(); // Maps keyIndex to whale file
        this.activeSources = new Map(); // Maps keyIndex to active audio sources
        this.keyboardToPianoMap = new Map(); // Maps keyboard keys to piano key indices
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.renderPiano();
    }

    setupEventListeners() {
        const fileInput = document.getElementById('wav-files');
        const analyzeBtn = document.getElementById('analyze-btn');
        const autoLoadBtn = document.getElementById('auto-load-btn');
        const testSoundBtn = document.getElementById('test-sound-btn');

        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        analyzeBtn.addEventListener('click', () => this.analyzeAndMap());
        autoLoadBtn.addEventListener('click', () => this.autoLoadPreparedFiles());
        testSoundBtn.addEventListener('click', () => this.testSound());
        
        // Keyboard support
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
    }

    handleFileSelect(event) {
        const files = Array.from(event.target.files);
        this.whaleFiles = files.filter(f => f.name.toLowerCase().endsWith('.wav'));
        
        const fileCount = document.getElementById('file-count');
        const analyzeBtn = document.getElementById('analyze-btn');
        
        if (this.whaleFiles.length > 0) {
            fileCount.textContent = `${this.whaleFiles.length} whale sound file(s) loaded`;
            analyzeBtn.disabled = false;
            this.updateStatus(`Loaded ${this.whaleFiles.length} files. Click "Analyze" to map to piano keys.`, 'info');
        } else {
            fileCount.textContent = 'No .wav files selected';
            analyzeBtn.disabled = true;
        }
    }

    async autoLoadPreparedFiles() {
        this.updateStatus('Loading whale sound manifest...', 'info');
        
        try {
            // Load the manifest to get file list
            const response = await fetch('manifest.json');
            if (!response.ok) {
                throw new Error('Manifest file not found. Please run prepare-whale-sounds.js first.');
            }
            
            const manifest = await response.json();
            this.fileManifest = manifest.files;
            
            // Use wav-clips directory for fast loading (3-second clips, 0.3MB each)
            this.frequencyMap.clear();
            
            this.fileManifest.forEach((fileInfo, index) => {
                const pianoKeyIndex = index; // Direct 1:1 mapping
                this.frequencyMap.set(pianoKeyIndex, {
                    fileName: fileInfo.newName,
                    filePath: `wav-clips/${fileInfo.newName}`, // ⚡ Using clips!
                    originalName: fileInfo.originalName,
                    whaleFreq: 'Load on demand',
                    pianoFreq: PIANO_FREQUENCIES[pianoKeyIndex],
                    note: NOTE_NAMES[pianoKeyIndex],
                    loaded: false
                });
            });
            
            this.updateStatus(`Ready! ${this.fileManifest.length} whale sounds mapped. Sounds load when pressed (0.3MB each - fast!)`, 'success');
            this.displayLazyLoadMapping();
            this.setupKeyboardMapping();
            this.displayKeyboardHints();
            this.enableTestButton();
            
        } catch (error) {
            console.error('Error loading manifest:', error);
            this.updateStatus(`Error: ${error.message}. Make sure you're running the local server (node server.js)`, 'error');
        }
    }

    async analyzeAndMap() {
        this.updateStatus('Analyzing frequencies...', 'info');
        
        try {
            // Load and analyze all files
            const analyses = [];
            for (let i = 0; i < this.whaleFiles.length; i++) {
                const file = this.whaleFiles[i];
                this.updateStatus(`Analyzing ${i + 1}/${this.whaleFiles.length}: ${file.name}`, 'info');
                
                const arrayBuffer = await file.arrayBuffer();
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                
                const frequency = await this.analyzeFrequency(audioBuffer);
                
                analyses.push({
                    file: file,
                    buffer: audioBuffer,
                    frequency: frequency,
                    fileName: file.name
                });
            }

            // Sort by frequency
            analyses.sort((a, b) => a.frequency - b.frequency);

            // Map to piano keys
            this.mapToPianoKeys(analyses);
            
            this.updateStatus(`Successfully mapped ${analyses.length} whale sounds to piano keys!`, 'success');
            this.displayFrequencyMapping(analyses);
            this.setupKeyboardMapping();
            this.displayKeyboardHints();
            this.enableTestButton();
            
        } catch (error) {
            console.error('Error analyzing files:', error);
            this.updateStatus(`Error: ${error.message}`, 'error');
        }
    }

    async analyzeFrequency(audioBuffer) {
        // Use FFT to find dominant frequency
        const sampleRate = audioBuffer.sampleRate;
        const channelData = audioBuffer.getChannelData(0);
        
        // Analyze first 3 seconds or entire file if shorter
        const analyzeLength = Math.min(sampleRate * 3, channelData.length);
        const samples = channelData.slice(0, analyzeLength);
        
        // Simple autocorrelation method for fundamental frequency detection
        const frequency = this.autoCorrelate(samples, sampleRate);
        
        return frequency;
    }

    autoCorrelate(buffer, sampleRate) {
        // Autocorrelation algorithm for pitch detection
        const SIZE = buffer.length;
        const MAX_SAMPLES = Math.floor(SIZE / 2);
        let best_offset = -1;
        let best_correlation = 0;
        let rms = 0;
        
        // Calculate RMS
        for (let i = 0; i < SIZE; i++) {
            const val = buffer[i];
            rms += val * val;
        }
        rms = Math.sqrt(rms / SIZE);
        
        // Not enough signal
        if (rms < 0.01) return -1;
        
        // Find the peak correlation
        let lastCorrelation = 1;
        for (let offset = 100; offset < MAX_SAMPLES; offset++) {
            let correlation = 0;
            
            for (let i = 0; i < MAX_SAMPLES; i++) {
                correlation += Math.abs(buffer[i] - buffer[i + offset]);
            }
            
            correlation = 1 - (correlation / MAX_SAMPLES);
            
            if (correlation > 0.9 && correlation > lastCorrelation) {
                const foundGoodCorrelation = correlation > best_correlation;
                if (foundGoodCorrelation) {
                    best_correlation = correlation;
                    best_offset = offset;
                }
            }
            lastCorrelation = correlation;
        }
        
        if (best_offset === -1) {
            // Fallback: use FFT-based method
            return this.getFFTPeak(buffer, sampleRate);
        }
        
        const fundamental_frequency = sampleRate / best_offset;
        return fundamental_frequency;
    }

    getFFTPeak(buffer, sampleRate) {
        // Simple FFT peak detection as fallback
        const fftSize = 2048;
        const frequencies = new Array(fftSize / 2).fill(0);
        
        for (let offset = 0; offset < buffer.length - fftSize; offset += fftSize / 2) {
            for (let i = 0; i < fftSize / 2; i++) {
                frequencies[i] += Math.abs(buffer[offset + i]);
            }
        }
        
        // Find peak
        let maxIndex = 0;
        let maxValue = 0;
        for (let i = 10; i < frequencies.length; i++) { // Skip very low frequencies
            if (frequencies[i] > maxValue) {
                maxValue = frequencies[i];
                maxIndex = i;
            }
        }
        
        return (maxIndex * sampleRate) / fftSize;
    }

    mapToPianoKeys(analyses) {
        // Clear existing mappings
        this.audioBuffers.clear();
        this.frequencyMap.clear();

        // Strategy: Map whale sounds to closest piano key frequencies
        // If we have fewer sounds than 88 keys, distribute them
        // If we have more, use the 88 that best match the range
        
        const numKeys = Math.min(PIANO_FREQUENCIES.length, analyses.length);
        
        if (analyses.length <= PIANO_FREQUENCIES.length) {
            // Fewer or equal whale sounds than keys
            // Map each whale sound to its nearest piano key
            analyses.forEach(analysis => {
                const keyIndex = this.findClosestKeyIndex(analysis.frequency);
                this.audioBuffers.set(keyIndex, analysis.buffer);
                this.frequencyMap.set(keyIndex, {
                    fileName: analysis.fileName,
                    whaleFreq: analysis.frequency,
                    pianoFreq: PIANO_FREQUENCIES[keyIndex],
                    note: NOTE_NAMES[keyIndex]
                });
            });
        } else {
            // More whale sounds than keys - use best 88
            // Distribute evenly across the range
            const step = analyses.length / PIANO_FREQUENCIES.length;
            for (let i = 0; i < PIANO_FREQUENCIES.length; i++) {
                const analysisIndex = Math.floor(i * step);
                const analysis = analyses[analysisIndex];
                
                this.audioBuffers.set(i, analysis.buffer);
                this.frequencyMap.set(i, {
                    fileName: analysis.fileName,
                    whaleFreq: analysis.frequency,
                    pianoFreq: PIANO_FREQUENCIES[i],
                    note: NOTE_NAMES[i]
                });
            }
        }
    }

    findClosestKeyIndex(frequency) {
        let closestIndex = 0;
        let minDiff = Math.abs(PIANO_FREQUENCIES[0] - frequency);
        
        for (let i = 1; i < PIANO_FREQUENCIES.length; i++) {
            const diff = Math.abs(PIANO_FREQUENCIES[i] - frequency);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
            }
        }
        
        return closestIndex;
    }

    displayFrequencyMapping(analyses) {
        const container = document.getElementById('frequency-mapping');
        container.classList.add('show');
        
        let html = '<h3>Frequency Mapping</h3>';
        html += '<div class="mapping-table">';
        html += '<table style="width: 100%; border-collapse: collapse;">';
        html += '<tr style="background: #e0e0e0; font-weight: bold;">';
        html += '<th style="padding: 5px; border: 1px solid #ccc;">Piano Key</th>';
        html += '<th style="padding: 5px; border: 1px solid #ccc;">Target Freq (Hz)</th>';
        html += '<th style="padding: 5px; border: 1px solid #ccc;">Whale File</th>';
        html += '<th style="padding: 5px; border: 1px solid #ccc;">Whale Freq (Hz)</th>';
        html += '</tr>';
        
        const sortedKeys = Array.from(this.frequencyMap.entries()).sort((a, b) => a[0] - b[0]);
        
        for (const [keyIndex, mapping] of sortedKeys) {
            html += '<tr>';
            html += `<td style="padding: 5px; border: 1px solid #ccc;">${mapping.note}</td>`;
            html += `<td style="padding: 5px; border: 1px solid #ccc;">${mapping.pianoFreq.toFixed(2)}</td>`;
            html += `<td style="padding: 5px; border: 1px solid #ccc; font-size: 0.8em;">${mapping.fileName}</td>`;
            html += `<td style="padding: 5px; border: 1px solid #ccc;">${mapping.whaleFreq.toFixed(2)}</td>`;
            html += '</tr>';
        }
        
        html += '</table></div>';
        container.innerHTML = html;
    }

    displaySimpleMapping(analyses) {
        const container = document.getElementById('frequency-mapping');
        container.classList.add('show');
        
        let html = '<h3>Whale Sound Mapping (Fast Load - No Frequency Analysis)</h3>';
        html += '<div class="mapping-table">';
        html += '<p style="margin-bottom: 10px; color: #666;">Files mapped sequentially to piano keys for instant playback.</p>';
        html += '<table style="width: 100%; border-collapse: collapse;">';
        html += '<tr style="background: #e0e0e0; font-weight: bold;">';
        html += '<th style="padding: 5px; border: 1px solid #ccc;">Piano Key</th>';
        html += '<th style="padding: 5px; border: 1px solid #ccc;">Note</th>';
        html += '<th style="padding: 5px; border: 1px solid #ccc;">Whale File</th>';
        html += '<th style="padding: 5px; border: 1px solid #ccc;">Original Source</th>';
        html += '</tr>';
        
        // Show first 20 and last 10 entries
        const displayEntries = [
            ...analyses.slice(0, 20),
            null, // separator
            ...analyses.slice(-10)
        ];
        
        displayEntries.forEach((analysis, idx) => {
            if (analysis === null) {
                html += '<tr><td colspan="4" style="text-align: center; padding: 5px; color: #999;">... (middle entries hidden) ...</td></tr>';
            } else {
                const pianoKeyIndex = analysis.index - 1;
                html += '<tr>';
                html += `<td style="padding: 5px; border: 1px solid #ccc;">${pianoKeyIndex + 1}</td>`;
                html += `<td style="padding: 5px; border: 1px solid #ccc;">${NOTE_NAMES[pianoKeyIndex]}</td>`;
                html += `<td style="padding: 5px; border: 1px solid #ccc; font-size: 0.8em;">${analysis.fileName}</td>`;
                html += `<td style="padding: 5px; border: 1px solid #ccc; font-size: 0.75em;">${analysis.originalName}</td>`;
                html += '</tr>';
            }
        });
        
        html += '</table></div>';
        container.innerHTML = html;
    }

    displayLazyLoadMapping() {
        const container = document.getElementById('frequency-mapping');
        container.classList.add('show');
        
        const totalFiles = this.frequencyMap.size;
        
        let html = '<h3>🚀 Ready to Play - Fast Loading!</h3>';
        html += '<div class="mapping-table">';
        html += `<p style="margin-bottom: 10px; color: #4CAF50; font-weight: bold;">✓ ${totalFiles} whale sounds (3-second clips) mapped to piano keys</p>`;
        html += '<p style="margin-bottom: 15px; color: #666; font-size: 0.95em;">💡 Clips are 0.3MB each and load instantly when you press keys!</p>';
        html += '<p style="font-size: 0.9em; color: #999;">Note: First press of each key loads the sound, subsequent presses are instant.</p>';
        html += '</div>';
        container.innerHTML = html;
    }

    renderPiano() {
        const piano = document.getElementById('piano');
        piano.innerHTML = '';

        // Render 7 octaves + partial (88 keys total)
        // Pattern: C C# D D# E F F# G G# A A# B
        
        const whiteKeyPattern = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        const blackKeyPositions = {
            'C#': 1, 'D#': 2, 'F#': 4, 'G#': 5, 'A#': 6
        };

        let keyIndex = 0;
        
        // A0, A#0, B0
        const octave0 = this.createOctaveElement(-1);
        this.createKey(octave0, 'A', 0, keyIndex++, 0);
        this.createKey(octave0, 'A#', 1, keyIndex++, 0, 1);
        this.createKey(octave0, 'B', 0, keyIndex++, 0);
        piano.appendChild(octave0);

        // C1 to C8 (7 complete octaves + C8)
        for (let octave = 1; octave <= 7; octave++) {
            const octaveElement = this.createOctaveElement(octave);
            
            for (let note of whiteKeyPattern) {
                this.createKey(octaveElement, note, 0, keyIndex++, octave);
                
                // Add black key if exists
                const blackNote = note + '#';
                if (blackKeyPositions[blackNote]) {
                    if (keyIndex < PIANO_FREQUENCIES.length) {
                        this.createKey(octaveElement, blackNote, blackKeyPositions[blackNote], keyIndex++, octave);
                    }
                }
            }
            
            piano.appendChild(octaveElement);
            
            // Stop at 88 keys
            if (keyIndex >= PIANO_FREQUENCIES.length) break;
        }

        // Add final C8 if not already added
        if (keyIndex === PIANO_FREQUENCIES.length - 1) {
            const finalOctave = document.createElement('div');
            finalOctave.className = 'octave';
            this.createKey(finalOctave, 'C', 0, keyIndex, 8);
            piano.appendChild(finalOctave);
        }
    }

    createOctaveElement(octaveNumber) {
        const octave = document.createElement('div');
        octave.className = 'octave';
        octave.dataset.octave = octaveNumber;
        return octave;
    }

    createKey(container, note, position, keyIndex, octave) {
        const isBlack = note.includes('#');
        const key = document.createElement('div');
        key.className = isBlack ? 'black-key' : 'white-key';
        
        if (isBlack) {
            key.classList.add(`pos-${position}`);
        }
        
        key.dataset.keyIndex = keyIndex;
        key.dataset.note = `${note}${octave}`;
        
        const label = document.createElement('div');
        label.className = 'key-label';
        label.textContent = note;
        key.appendChild(label);
        
        // Mouse events
        key.addEventListener('mousedown', () => this.playKey(keyIndex));
        key.addEventListener('mouseup', () => this.stopKey(keyIndex));
        key.addEventListener('mouseleave', () => this.stopKey(keyIndex));
        
        // Touch events
        key.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.playKey(keyIndex);
        });
        key.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopKey(keyIndex);
        });
        
        container.appendChild(key);
    }

    async playKey(keyIndex) {
        // Check if we have mapping info for this key
        if (!this.frequencyMap.has(keyIndex)) {
            console.log(`No mapping for key ${keyIndex}`);
            return;
        }
        
        // Resume audio context if suspended (required for browsers)
        if (this.audioContext.state === 'suspended') {
            console.log('Resuming audio context...');
            await this.audioContext.resume();
        }
        
        // Visual feedback
        const keyElement = document.querySelector(`[data-key-index="${keyIndex}"]`);
        if (keyElement) {
            keyElement.classList.add('active');
        }
        
        // Load file on-demand if not already loaded
        if (!this.audioBuffers.has(keyIndex)) {
            // Check if already loading
            if (this.loadingKeys.has(keyIndex)) {
                console.log(`Key ${keyIndex} is already loading...`);
                return;
            }
            
            this.loadingKeys.add(keyIndex);
            const mapping = this.frequencyMap.get(keyIndex);
            
            console.log(`Loading sound for key ${keyIndex} (${mapping.note}): ${mapping.fileName}`);
            this.updateStatus(`Loading ${mapping.note} - ${mapping.fileName} (0.3MB clip, please wait...)`, 'info');
            
            try {
                const response = await fetch(mapping.filePath);
                if (!response.ok) {
                    throw new Error(`Failed to fetch: ${response.statusText}`);
                }
                
                const arrayBuffer = await response.arrayBuffer();
                console.log(`Downloaded ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)}MB, decoding...`);
                
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                this.audioBuffers.set(keyIndex, audioBuffer);
                
                // Mark as loaded
                mapping.loaded = true;
                
                console.log(`Key ${keyIndex} loaded successfully!`);
                this.updateStatus(`${mapping.note} loaded! You can now play this key.`, 'success');
                
            } catch (error) {
                console.error(`Error loading key ${keyIndex}:`, error);
                this.updateStatus(`Error loading ${mapping.note}: ${error.message}`, 'error');
                this.loadingKeys.delete(keyIndex);
                if (keyElement) {
                    keyElement.classList.remove('active');
                }
                return;
            } finally {
                this.loadingKeys.delete(keyIndex);
            }
        }
        
        // Stop any currently playing sound on this key
        if (this.activeSources.has(keyIndex)) {
            try {
                this.activeSources.get(keyIndex).stop();
            } catch (e) {
                // Already stopped
            }
            this.activeSources.delete(keyIndex);
        }
        
        try {
            // Play sound
            const buffer = this.audioBuffers.get(keyIndex);
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            
            // Add a gain node for volume control
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = 0.8; // 80% volume
            
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            // Auto-cleanup when finished
            source.onended = () => {
                this.activeSources.delete(keyIndex);
                if (keyElement) {
                    keyElement.classList.remove('active');
                }
            };
            
            source.start(0);
            
            // Store for cleanup
            this.activeSources.set(keyIndex, source);
            
            console.log(`Playing key ${keyIndex} (${NOTE_NAMES[keyIndex]})`);
        } catch (error) {
            console.error(`Error playing key ${keyIndex}:`, error);
            if (keyElement) {
                keyElement.classList.remove('active');
            }
        }
    }

    stopKey(keyIndex) {
        // Stop the sound
        if (this.activeSources.has(keyIndex)) {
            try {
                this.activeSources.get(keyIndex).stop();
            } catch (e) {
                // Already stopped
            }
            this.activeSources.delete(keyIndex);
        }
        
        // Remove visual feedback
        const keyElement = document.querySelector(`[data-key-index="${keyIndex}"]`);
        if (keyElement) {
            keyElement.classList.remove('active');
        }
    }

    setupKeyboardMapping() {
        // Get all available piano keys from frequency map, sorted by index
        const availableKeys = Array.from(this.frequencyMap.keys()).sort((a, b) => a - b);
        
        if (availableKeys.length === 0) return;
        
        // Define keyboard layout (home row and number row)
        const keyboardKeys = [
            'a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';',
            'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/',
            'q', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='
        ];
        
        // Map keyboard keys to available piano keys
        this.keyboardToPianoMap.clear();
        
        // If we have fewer keys than keyboard buttons, spread them out
        // If we have more keys, use the first keys that fit the keyboard
        const numToMap = Math.min(keyboardKeys.length, availableKeys.length);
        
        for (let i = 0; i < numToMap; i++) {
            const keyboardKey = keyboardKeys[i];
            const pianoKeyIndex = availableKeys[i];
            this.keyboardToPianoMap.set(keyboardKey, pianoKeyIndex);
        }
        
        console.log(`Keyboard mapping created: ${this.keyboardToPianoMap.size} keys mapped`);
    }

    displayKeyboardHints() {
        const container = document.querySelector('.keyboard-hints');
        if (!container || this.keyboardToPianoMap.size === 0) return;
        
        const sortedMappings = Array.from(this.keyboardToPianoMap.entries());
        const firstFew = sortedMappings.slice(0, 17).map(([k, v]) => k.toUpperCase()).join(' ');
        
        container.innerHTML = `
            <h3>Keyboard Shortcuts</h3>
            <p><strong>${this.keyboardToPianoMap.size} keys available:</strong> ${firstFew}${this.keyboardToPianoMap.size > 17 ? ' ...' : ''}</p>
            <p style="font-size: 0.9em; color: #666;">Press any mapped key to play the corresponding whale sound!</p>
        `;
    }

    handleKeyDown(event) {
        if (event.repeat) return;
        
        const key = event.key.toLowerCase();
        const pianoKeyIndex = this.keyboardToPianoMap.get(key);
        
        if (pianoKeyIndex !== undefined) {
            event.preventDefault();
            this.playKey(pianoKeyIndex);
        }
    }

    handleKeyUp(event) {
        const key = event.key.toLowerCase();
        const pianoKeyIndex = this.keyboardToPianoMap.get(key);
        
        if (pianoKeyIndex !== undefined) {
            event.preventDefault();
            this.stopKey(pianoKeyIndex);
        }
    }

    enableTestButton() {
        const testBtn = document.getElementById('test-sound-btn');
        if (testBtn) {
            testBtn.style.display = 'inline-block';
        }
    }

    async testSound() {
        console.log('Testing sound...');
        console.log('Audio context state:', this.audioContext.state);
        console.log('Available mappings:', this.frequencyMap.size);
        console.log('Loaded buffers:', this.audioBuffers.size);
        
        // Find first available key
        const availableKeys = Array.from(this.frequencyMap.keys());
        if (availableKeys.length === 0) {
            this.updateStatus('No sounds mapped yet!', 'error');
            return;
        }
        
        const firstKey = availableKeys[0];
        const mapping = this.frequencyMap.get(firstKey);
        this.updateStatus(`Testing: Loading and playing ${mapping.note}... (this may take a moment for the first play)`, 'info');
        
        // Play the first available sound (will load on-demand)
        await this.playKey(firstKey);
        
        // Stop after 3 seconds if it loaded successfully
        if (this.audioBuffers.has(firstKey)) {
            setTimeout(() => {
                this.stopKey(firstKey);
                this.updateStatus('Test complete! If you heard a whale sound, audio is working. Click any key or use keyboard shortcuts. Clips load instantly!', 'success');
            }, 3000);
        }
    }

    updateStatus(message, type) {
        const status = document.getElementById('status');
        status.textContent = message;
        status.className = `status ${type}`;
    }
}

// Initialize the app
const app = new BowheadPiano();
