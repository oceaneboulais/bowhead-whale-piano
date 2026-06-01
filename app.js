// Bowhead Whale Piano App
// Maps whale sounds to piano keys based on frequency analysis

// Makey Makey default key outputs mapped to a C pentatonic scale (C3–C5)
// Front panel: Space ← ↓ ↑ →   |   Back panel: W A S D F G
const MAKEY_MAKEY_MAP = {
    ' ':          27,  // Space   → C3  (130 Hz)
    'arrowleft':  29,  // ←       → D3  (147 Hz)
    'arrowdown':  31,  // ↓       → E3  (165 Hz)
    'arrowup':    34,  // ↑       → G3  (196 Hz)
    'arrowright': 36,  // →       → A3  (220 Hz)
    'a':          39,  // A       → C4  (262 Hz)
    's':          41,  // S       → D4  (294 Hz)
    'd':          43,  // D       → E4  (330 Hz)
    'f':          46,  // F       → G4  (392 Hz)
    'g':          48,  // G       → A4  (440 Hz)
    'w':          51,  // W       → C5  (523 Hz)
};

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

// WebSocket endpoint of the TouchDesigner WebSocket DAT (server mode).
// Override before this script loads with `window.TD_WS_URL = 'ws://host:port'`.
const TD_WS_URL = (typeof window !== 'undefined' && window.TD_WS_URL) || 'ws://localhost:9980';

/**
 * WhaleVizBridge — streams note/pitch events to TouchDesigner for the
 * bioluminescent-tendril visualizer. Entirely optional: if TD isn't running it
 * just retries quietly and never affects the piano. (Chrome allows ws://localhost
 * from the https GitHub Pages site — localhost is exempt from mixed-content.)
 */
class WhaleVizBridge {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.connected = false;
        this.enabled = true;
        this._retry = null;
        this.connect();
    }
    connect() {
        if (!this.enabled) return;
        try {
            this.ws = new WebSocket(this.url);
        } catch (_) { this._scheduleRetry(); return; }
        this.ws.onopen = () => { this.connected = true; this._status(); };
        this.ws.onclose = () => { this.connected = false; this._status(); this._scheduleRetry(); };
        this.ws.onerror = () => { /* a close event follows; retry handled there */ };
    }
    _scheduleRetry() {
        if (this._retry || !this.enabled) return;
        this._retry = setTimeout(() => { this._retry = null; this.connect(); }, 2500);
    }
    send(obj) {
        if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            try { this.ws.send(JSON.stringify(obj)); } catch (_) { /* drop frame */ }
        }
    }
    noteOn(d)  { this.send({ type: 'noteon',  t: performance.now() / 1000, ...d }); }
    noteOff(d) { this.send({ type: 'noteoff', t: performance.now() / 1000, ...d }); }
    setEnabled(on) {
        this.enabled = on;
        if (on) this.connect();
        else if (this.ws) { try { this.ws.close(); } catch (_) {} }
        this._status();
    }
    _status() {
        const el = document.getElementById('viz-status');
        if (!el) return;
        el.textContent = !this.enabled
            ? '🌊 Visualizer link: off'
            : this.connected
                ? '🌊 Visualizer: connected to TouchDesigner'
                : '🌊 Visualizer: waiting for TouchDesigner…';
    }
}

// Small deterministic PRNG so the latent embedding layout is stable across loads.
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * WhaleVisualizer — the in-browser popup art box. Blends three references:
 *  - bioluminescent jellyfish tendrils that bob slowly up/down and sway,
 *  - a minimal UMAP / latent-embedding map: the 88 sounds as a faint clustered
 *    point cloud; playing a key lights up its node,
 *  - audio-reactivity: the master analyser drives glow, tendril sway and bell size.
 * As you play, a faint trajectory line threads the recently-lit nodes — a path
 * through latent space.
 */
class WhaleVisualizer {
    constructor(canvas, analyser, freqTable) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.analyser = analyser;
        this.freqTable = freqTable; // PIANO_FREQUENCIES
        this.bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
        this.tendrils = [];
        this.trail = [];           // recent lit nodes → latent trajectory
        this.running = false;
        this.dpr = 1;
        this.embed = this._buildEmbedding(freqTable.length);
        this.plankton = this._buildPlankton(60); // bowhead prey: copepods + krill
        this._frame = this._frame.bind(this);
        this._resize = this._resize.bind(this);
    }

    // Bowhead whales filter-feed on zooplankton — mainly copepods (Calanus) and
    // krill (euphausiids). A drifting field of both floats up the water column.
    _buildPlankton(n) {
        const rnd = mulberry32(7);
        const arr = [];
        for (let i = 0; i < n; i++) {
            const krill = rnd() < 0.4;
            arr.push({
                krill,
                x: rnd(), y: rnd(),
                vx: (rnd() - 0.5) * 0.004,
                vy: -0.0018 - rnd() * 0.004,          // slow upward drift
                phase: rnd() * Math.PI * 2,
                size: (krill ? 2.4 : 1.6) * (0.7 + rnd() * 0.8),
                hop: rnd() * 3, hopT: 1 + rnd() * 3, kick: 0,
                hue: krill ? (28 + rnd() * 16) : (165 + rnd() * 35), // krill amber, copepods cyan-green
            });
        }
        return arr;
    }

    _drawPlankton(t, lvl) {
        const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, dpr = this.dpr;
        for (const p of this.plankton) {
            let dx = p.vx, dy = p.vy;
            if (p.krill) {
                dx += Math.sin(t * 1.3 + p.phase) * 0.0010;       // gentle swimming sway
            } else {
                p.hop -= 1 / 60;                                   // copepods hop
                if (p.hop <= 0) { p.hop = p.hopT; p.kick = 0.02; }
                if (p.kick > 0) { dy -= p.kick; p.kick *= 0.8; }
                dx += Math.sin(t * 0.6 + p.phase) * 0.0006;
            }
            dx *= (1 + lvl * 1.5); dy *= (1 + lvl * 1.5);          // calls agitate the water
            p.x += dx; p.y += dy;
            if (p.y < -0.03) { p.y = 1.03; p.x = Math.random(); }  // respawn from below
            if (p.x < -0.03) p.x = 1.03; if (p.x > 1.03) p.x = -0.03;

            const x = p.x * W, y = p.y * H, s = p.size * dpr * (1 + lvl * 0.6);
            const a = 0.22 + 0.18 * Math.sin(t * 1.5 + p.phase);
            ctx.strokeStyle = `hsla(${p.hue},80%,72%,${a})`;
            ctx.fillStyle = `hsla(${p.hue},85%,80%,${a * 0.9})`;
            ctx.lineWidth = Math.max(0.6, 0.7 * dpr);

            if (p.krill) {                                         // curved segmented body + eye
                const ang = Math.sin(t * 2 + p.phase) * 0.5;
                ctx.beginPath();
                for (let k = 0; k <= 5; k++) {
                    const f = k / 5;
                    const bx = x + Math.cos(ang) * (f - 0.5) * s * 4;
                    const by = y + Math.sin(ang) * (f - 0.5) * s * 4 + Math.sin(f * 3 + t * 3 + p.phase) * s * 0.6;
                    k === 0 ? ctx.moveTo(bx, by) : ctx.lineTo(bx, by);
                }
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x + Math.cos(ang) * -0.5 * s * 4, y + Math.sin(ang) * -0.5 * s * 4, s * 0.5, 0, 6.283);
                ctx.fill();
            } else {                                               // copepod: teardrop + antennae + tail fork
                ctx.beginPath(); ctx.ellipse(x, y, s * 0.9, s * 1.4, 0, 0, 6.283); ctx.fill();
                const aw = s * 3;
                ctx.beginPath();
                ctx.moveTo(x, y - s); ctx.lineTo(x - aw, y - s * 0.4);
                ctx.moveTo(x, y - s); ctx.lineTo(x + aw, y - s * 0.4);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x, y + s * 1.2); ctx.lineTo(x - s * 0.8, y + s * 2.4);
                ctx.moveTo(x, y + s * 1.2); ctx.lineTo(x + s * 0.8, y + s * 2.4);
                ctx.stroke();
            }
        }
    }

    // Deterministic clustered 2D layout of the 88 sounds — looks like a UMAP map.
    _buildEmbedding(n) {
        const rnd = mulberry32(1337);
        const C = 6, centers = [];
        for (let i = 0; i < C; i++) centers.push({ x: 0.14 + 0.72 * rnd(), y: 0.16 + 0.68 * rnd() });
        const pts = [];
        for (let k = 0; k < n; k++) {
            const c = centers[k % C];
            const ang = rnd() * Math.PI * 2;
            const rad = 0.11 * Math.sqrt(-2 * Math.log(1e-6 + rnd())); // gaussian-ish
            pts.push({
                x: Math.max(0.04, Math.min(0.96, c.x + Math.cos(ang) * rad * 0.6)),
                y: Math.max(0.06, Math.min(0.94, c.y + Math.sin(ang) * rad * 0.6)),
                tw: rnd() * Math.PI * 2,
            });
        }
        return pts;
    }

    hueFor(pitch) {
        const x = Math.max(0, Math.min(1, Math.log2((pitch || 220) / 27.5) / 7));
        return 150 + x * 150; // cyan → blue → violet, bioluminescent
    }

    start() {
        if (this.running) return;
        this.running = true;
        window.addEventListener('resize', this._resize);
        this._resize();
        this.ctx.fillStyle = '#02060f';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this._raf = requestAnimationFrame(this._frame);
    }

    stop() {
        this.running = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        window.removeEventListener('resize', this._resize);
    }

    _resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const r = this.canvas.getBoundingClientRect();
        this.canvas.width = Math.max(2, Math.floor(r.width * dpr));
        this.canvas.height = Math.max(2, Math.floor(r.height * dpr));
        this.dpr = dpr;
    }

    noteOn(ev) {
        const k = ev.key;
        const e = this.embed[k] || { x: 0.5, y: 0.5 };
        const pitch = ev.pitchHz || this.freqTable[k] || 220;
        this.tendrils.push({
            key: k, x: e.x, y: e.y, hue: this.hueFor(pitch),
            phase: Math.random() * Math.PI * 2, alive: true, decay: 0,
        });
        this.trail.push({ x: e.x, y: e.y, hue: this.hueFor(pitch) });
        if (this.trail.length > 14) this.trail.shift();
        if (this.tendrils.length > 40) this.tendrils.shift();
    }

    noteOff(ev) {
        for (const t of this.tendrils) if (t.key === ev.key && t.alive) t.alive = false;
    }

    _level() {
        if (!this.analyser) return 0.25;
        this.analyser.getByteFrequencyData(this.bins);
        let s = 0; for (let i = 0; i < this.bins.length; i++) s += this.bins[i];
        return (s / this.bins.length) / 255;
    }

    _frame() {
        if (!this.running) return;
        const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
        const t = performance.now() / 1000, lvl = this._level(), dpr = this.dpr;

        // Persistent fade leaves a luminous wake (jellyfish trails).
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(2,6,15,0.12)';
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';

        // 1) Latent cloud — the minimal UMAP-like map of all 88 sounds.
        for (const p of this.embed) {
            const tw = 0.35 + 0.25 * Math.sin(t * 0.8 + p.tw);
            ctx.fillStyle = `hsla(200,45%,72%,${0.06 * tw})`;
            ctx.beginPath(); ctx.arc(p.x * W, p.y * H, 1.4 * dpr, 0, 6.283); ctx.fill();
        }

        // 1b) Bowhead prey drifting up the water column (copepods + krill).
        this._drawPlankton(t, lvl);

        // 2) Latent trajectory — faint path threading recently played nodes.
        for (let i = 1; i < this.trail.length; i++) {
            const a = this.trail[i - 1], b = this.trail[i];
            ctx.strokeStyle = `hsla(${b.hue},80%,72%,${0.10 * (i / this.trail.length)})`;
            ctx.lineWidth = 1 * dpr;
            ctx.beginPath(); ctx.moveTo(a.x * W, a.y * H); ctx.lineTo(b.x * W, b.y * H); ctx.stroke();
        }

        // 3) Jellyfish tendrils at each lit node.
        for (let i = this.tendrils.length - 1; i >= 0; i--) {
            const td = this.tendrils[i];
            if (!td.alive) { td.decay += 0.01; if (td.decay >= 1) { this.tendrils.splice(i, 1); continue; } }
            const fade = td.alive ? 1 : (1 - td.decay);
            const nodeX = td.x * W;
            const bob = Math.sin(t * 0.5 + td.phase) * 0.05 * H;   // slow up/down drift
            const headY = td.y * H + bob - lvl * 0.04 * H;
            const amp = (6 + lvl * 46) * dpr;
            const segs = 24, len = H * 0.34;

            for (let s = 0; s < 3; s++) {                            // a few tentacle strands
                ctx.beginPath();
                for (let j = 0; j <= segs; j++) {
                    const f = j / segs, y = headY + f * len;
                    const sway = Math.sin(t * (0.9 + s * 0.2) + td.phase + f * 5 + s) * amp * (0.25 + f);
                    const x = nodeX + sway + (s - 1) * 6 * dpr * f;
                    j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                }
                ctx.strokeStyle = `hsla(${td.hue},95%,70%,${0.18 * fade})`;
                ctx.lineWidth = 2.2 * dpr;
                ctx.shadowBlur = 14 * dpr; ctx.shadowColor = `hsl(${td.hue},90%,60%)`;
                ctx.stroke();
            }
            ctx.shadowBlur = 0;

            const r = (10 + lvl * 26) * dpr * (0.6 + 0.4 * fade);    // glowing bell / node
            const g = ctx.createRadialGradient(nodeX, headY, 0, nodeX, headY, r);
            g.addColorStop(0, `hsla(${td.hue},100%,85%,${0.85 * fade})`);
            g.addColorStop(0.5, `hsla(${td.hue},95%,60%,${0.32 * fade})`);
            g.addColorStop(1, `hsla(${td.hue},90%,45%,0)`);
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(nodeX, headY, r, 0, 6.283); ctx.fill();
        }

        this._raf = requestAnimationFrame(this._frame);
    }
}

class BowheadPiano {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        // Master analyser: every voice routes through here so the in-browser
        // visualizer can read the combined whale-sound spectrum/level.
        this.master = this.audioContext.createAnalyser();
        this.master.fftSize = 1024;
        this.master.smoothingTimeConstant = 0.82;
        this.master.connect(this.audioContext.destination);
        this.visualizer = null; // created lazily when the popup is opened
        this.whaleFiles = [];
        this.audioBuffers = new Map();
        this.fileManifest = null; // Store manifest for lazy loading
        this.loadingKeys = new Set(); // Track which keys are currently loading
        this.frequencyMap = new Map(); // Maps keyIndex to whale file
        this.activeSources = new Map(); // Maps keyIndex to active audio sources
        this.keyboardToPianoMap = new Map(); // Maps keyboard keys to piano key indices
        this.makeyMakeyMode = false;
        this.midiOutput = null;
        this.midiAccess = null;
        this.pitchLockEnabled = true;       // resample each clip onto its key's pitch
        this.clipFrequencies = new Map();   // newName -> precomputed dominant freq (Hz)
        this.viz = new WhaleVizBridge(TD_WS_URL); // streams notes to TouchDesigner

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.renderPiano();
        this.populateFrequencyReference();
        this.initMidi();
    }

    setupEventListeners() {
        const fileInput = document.getElementById('wav-files');
        const analyzeBtn = document.getElementById('analyze-btn');
        const autoLoadBtn = document.getElementById('auto-load-btn');
        const testSoundBtn = document.getElementById('test-sound-btn');
        const makeyMakeyBtn = document.getElementById('makey-makey-btn');

        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        analyzeBtn.addEventListener('click', () => this.analyzeAndMap());
        autoLoadBtn.addEventListener('click', () => this.autoLoadPreparedFiles());
        testSoundBtn.addEventListener('click', () => this.testSound());
        if (makeyMakeyBtn) {
            makeyMakeyBtn.addEventListener('click', () => this.toggleMakeyMakeyMode());
        }
        const pitchLockBtn = document.getElementById('pitch-lock-btn');
        if (pitchLockBtn) {
            pitchLockBtn.addEventListener('click', () => this.togglePitchLock());
        }
        const vizBtn = document.getElementById('viz-btn');
        if (vizBtn) vizBtn.addEventListener('click', () => this.toggleVisualizer());
        const vizClose = document.getElementById('viz-close');
        if (vizClose) vizClose.addEventListener('click', () => this.closeVisualizer());
        const vizFs = document.getElementById('viz-fullscreen');
        if (vizFs) vizFs.addEventListener('click', () => this.toggleVizFullscreen());
        const tdToggle = document.getElementById('td-link-toggle');
        if (tdToggle) tdToggle.addEventListener('change', (e) => this.viz.setEnabled(e.target.checked));

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

            // Load precomputed clip frequencies (from analyze_clips.py) so pitch-lock
            // is consistent and we avoid re-analyzing every clip in the browser.
            await this.loadClipFrequencies();

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

            // Pitch-lock: resample the whale clip so its dominant frequency lands
            // exactly on the key it represents (e.g. D3 → 146.83 Hz). Without this
            // the clip plays at its own arbitrary pitch and "doesn't match" the note.
            const mapping = this.frequencyMap.get(keyIndex);
            const targetFreq = (mapping && mapping.pianoFreq) || PIANO_FREQUENCIES[keyIndex];
            const clipFreq = await this.getClipFrequency(keyIndex, buffer);
            let playbackRate = 1;
            if (this.pitchLockEnabled && clipFreq && isFinite(clipFreq) && clipFreq > 0) {
                // Clamp to ±3 octaves so a wildly off clip can't become a silent
                // rumble or an inaudible chirp.
                playbackRate = Math.max(0.125, Math.min(8, targetFreq / clipFreq));
            }
            source.playbackRate.value = playbackRate;

            // Add a gain node for volume boost
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = 5.0; // 500% volume boost for whale sounds
            
            // Add a compressor to prevent clipping at high volumes
            const compressor = this.audioContext.createDynamicsCompressor();
            compressor.threshold.value = -20;
            compressor.knee.value = 30;
            compressor.ratio.value = 12;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;
            
            source.connect(gainNode);
            gainNode.connect(compressor);
            compressor.connect(this.master); // → analyser → destination (feeds the visualizer)
            
            // Auto-cleanup when finished
            source.onended = () => {
                this.activeSources.delete(keyIndex);
                if (keyElement) {
                    keyElement.classList.remove('active');
                }
            };
            
            source.start(0);
            this.sendMidiNoteOn(keyIndex);

            // Notify the visualizers (TouchDesigner bridge + in-browser popup).
            const ev = { key: keyIndex, note: NOTE_NAMES[keyIndex], pitchHz: targetFreq,
                         clipHz: clipFreq, rate: playbackRate };
            this.viz.noteOn(ev);
            if (this.visualizer) this.visualizer.noteOn(ev);

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
        this.sendMidiNoteOff(keyIndex);
        const offEv = { key: keyIndex, note: NOTE_NAMES[keyIndex] };
        this.viz.noteOff(offEv);
        if (this.visualizer) this.visualizer.noteOff(offEv);

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

        if (this.makeyMakeyMode) {
            container.innerHTML = `
                <h3>🎛️ Makey Makey Mode Active</h3>
                <p>Front: <kbd>Space</kbd>=C3 &nbsp;<kbd>←</kbd>=D3 &nbsp;<kbd>↓</kbd>=E3 &nbsp;<kbd>↑</kbd>=G3 &nbsp;<kbd>→</kbd>=A3</p>
                <p>Back:&nbsp; <kbd>A</kbd>=C4 &nbsp;<kbd>S</kbd>=D4 &nbsp;<kbd>D</kbd>=E4 &nbsp;<kbd>F</kbd>=G4 &nbsp;<kbd>G</kbd>=A4 &nbsp;<kbd>W</kbd>=C5</p>
                <p style="font-size:0.85em;color:#666">MIDI output active — notes also sent to connected MIDI devices.</p>
            `;
        } else {
            const sortedMappings = Array.from(this.keyboardToPianoMap.entries());
            const firstFew = sortedMappings.slice(0, 17).map(([k]) => k.toUpperCase()).join(' ');
            container.innerHTML = `
                <h3>Keyboard Shortcuts</h3>
                <p><strong>${this.keyboardToPianoMap.size} keys available:</strong> ${firstFew}${this.keyboardToPianoMap.size > 17 ? ' ...' : ''}</p>
                <p style="font-size: 0.9em; color: #666;">Press any mapped key to play the corresponding whale sound!</p>
            `;
        }
    }

    handleKeyDown(event) {
        if (event.repeat) return;
        
        // Use event.key but normalise arrows/space to lowercase for map lookup
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
        const pianoKeyIndex = this.keyboardToPianoMap.get(key);
        
        if (pianoKeyIndex !== undefined) {
            event.preventDefault();
            this.playKey(pianoKeyIndex);
        }
    }

    handleKeyUp(event) {
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
        const pianoKeyIndex = this.keyboardToPianoMap.get(key);
        
        if (pianoKeyIndex !== undefined) {
            event.preventDefault();
            this.stopKey(pianoKeyIndex);
        }
    }

    enableTestButton() {
        const testBtn = document.getElementById('test-sound-btn');
        if (testBtn) testBtn.style.display = 'inline-block';
        const makeyBtn = document.getElementById('makey-makey-btn');
        if (makeyBtn) makeyBtn.style.display = 'inline-block';
    }

    // ── Pitch-lock ─────────────────────────────────────────────────────────────
    togglePitchLock() {
        this.pitchLockEnabled = !this.pitchLockEnabled;
        const btn = document.getElementById('pitch-lock-btn');
        if (btn) {
            btn.textContent = `🎵 Pitch-Lock: ${this.pitchLockEnabled ? 'ON' : 'OFF'}`;
            btn.classList.toggle('active', this.pitchLockEnabled);
        }
        this.updateStatus(
            this.pitchLockEnabled
                ? 'Pitch-lock ON — each key now plays its whale clip resampled to that note\'s pitch.'
                : 'Pitch-lock OFF — clips play at their original (un-matched) pitch.',
            'info'
        );
    }

    /** Resolve a clip's dominant frequency: precomputed JSON → cached → analyze now. */
    async getClipFrequency(keyIndex, buffer) {
        const mapping = this.frequencyMap.get(keyIndex);
        if (mapping && mapping.fileName && this.clipFrequencies.has(mapping.fileName)) {
            return this.clipFrequencies.get(mapping.fileName);
        }
        if (mapping && typeof mapping.whaleFreq === 'number' && mapping.whaleFreq > 0) {
            return mapping.whaleFreq;
        }
        const freq = await this.analyzeFrequency(buffer);
        if (mapping && freq > 0) mapping.whaleFreq = freq; // cache for subsequent presses
        return freq;
    }

    /** Optional: load frequencies precomputed by analyze_clips.py. Non-fatal if absent. */
    async loadClipFrequencies() {
        try {
            const r = await fetch('clip_frequencies.json', { cache: 'no-store' });
            if (!r.ok) return;
            const data = await r.json();
            this.clipFrequencies = new Map(
                Object.entries(data).map(([name, f]) => [name, Number(f)])
            );
            console.log(`Loaded precomputed frequencies for ${this.clipFrequencies.size} clips`);
        } catch (_) {
            /* file is optional — playKey falls back to in-browser analysis */
        }
    }

    // ── In-browser visualizer popup ───────────────────────────────────────────
    toggleVisualizer() {
        const overlay = document.getElementById('viz-overlay');
        if (!overlay) return;
        overlay.classList.contains('open') ? this.closeVisualizer() : this.openVisualizer();
    }

    openVisualizer() {
        const overlay = document.getElementById('viz-overlay');
        const canvas = document.getElementById('viz-canvas');
        if (!overlay || !canvas) return;
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
        if (this.audioContext.state === 'suspended') this.audioContext.resume();
        if (!this.visualizer) this.visualizer = new WhaleVisualizer(canvas, this.master, PIANO_FREQUENCIES);
        requestAnimationFrame(() => this.visualizer.start()); // let layout settle so canvas has size
        const btn = document.getElementById('viz-btn');
        if (btn) btn.classList.add('active');
    }

    closeVisualizer() {
        const overlay = document.getElementById('viz-overlay');
        if (overlay) { overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true'); }
        if (this.visualizer) this.visualizer.stop();
        const btn = document.getElementById('viz-btn');
        if (btn) btn.classList.remove('active');
    }

    toggleVizFullscreen() {
        const overlay = document.getElementById('viz-overlay');
        if (!overlay) return;
        if (!document.fullscreenElement) overlay.requestFullscreen && overlay.requestFullscreen();
        else document.exitFullscreen && document.exitFullscreen();
        setTimeout(() => this.visualizer && this.visualizer._resize(), 150);
    }

    // ── MIDI ─────────────────────────────────────────────────────────────────
    async initMidi() {
        if (!navigator.requestMIDIAccess) {
            this.updateMidiStatus('Web MIDI not supported in this browser');
            return;
        }
        try {
            this.midiAccess = await navigator.requestMIDIAccess();
            this.pickMidiOutput();
            this.midiAccess.onstatechange = () => this.pickMidiOutput();
        } catch (e) {
            this.updateMidiStatus('MIDI access denied');
        }
    }

    pickMidiOutput() {
        const outputs = Array.from(this.midiAccess.outputs.values());
        this.midiOutput = outputs.length > 0 ? outputs[0] : null;
        this.updateMidiStatus(
            this.midiOutput ? `🎹 MIDI out: ${this.midiOutput.name}` : 'MIDI: no output devices'
        );
    }

    updateMidiStatus(msg) {
        const el = document.getElementById('midi-status');
        if (el) el.textContent = msg;
    }

    sendMidiNoteOn(keyIndex) {
        if (!this.midiOutput) return;
        this.midiOutput.send([0x90, keyIndex + 21, 100]); // ch1 Note On, velocity 100
    }

    sendMidiNoteOff(keyIndex) {
        if (!this.midiOutput) return;
        this.midiOutput.send([0x80, keyIndex + 21, 0]);  // ch1 Note Off
    }

    // ── Makey Makey ──────────────────────────────────────────────────────────
    toggleMakeyMakeyMode() {
        // If sounds haven't been loaded yet, auto-load them first
        if (this.frequencyMap.size === 0) {
            this.autoLoadPreparedFiles().then(() => {
                if (this.frequencyMap.size > 0) this._activateMakeyMakey();
            });
            return;
        }
        this._activateMakeyMakey();
    }

    _activateMakeyMakey() {
        this.makeyMakeyMode = !this.makeyMakeyMode;
        const btn = document.getElementById('makey-makey-btn');
        const diagram = document.getElementById('makey-makey-diagram');

        if (this.makeyMakeyMode) {
            this.keyboardToPianoMap.clear();
            for (const [k, v] of Object.entries(MAKEY_MAKEY_MAP)) {
                this.keyboardToPianoMap.set(k, v);
            }
            if (btn) { btn.textContent = '🟢 Makey Makey ON'; btn.classList.add('active'); }
            if (diagram) diagram.style.display = 'block';
        } else {
            this.setupKeyboardMapping();
            if (btn) { btn.textContent = '🎛️ Makey Makey Mode'; btn.classList.remove('active'); }
            if (diagram) diagram.style.display = 'none';
        }
        this.displayKeyboardHints();
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

    populateFrequencyReference() {
        const tableBody = document.getElementById('frequency-reference-table');
        if (!tableBody) {
            console.error('Frequency reference table body not found');
            return;
        }
        
        tableBody.innerHTML = '';
        
        // Create rows with 2 entries per row for compact display
        for (let i = 0; i < PIANO_FREQUENCIES.length; i += 2) {
            const row = document.createElement('tr');
            
            // First entry
            const key1 = i + 1;
            const note1 = NOTE_NAMES[i];
            const freq1 = PIANO_FREQUENCIES[i];
            
            // Add first key's cells
            row.innerHTML = `
                <td>${key1}</td>
                <td>${note1}${note1 === 'C4' ? ' <small>(Middle C)</small>' : note1 === 'A4' ? ' <small>(440 Hz)</small>' : ''}</td>
                <td>${freq1.toFixed(2)}</td>
            `;
            
            // Second entry (if exists)
            if (i + 1 < PIANO_FREQUENCIES.length) {
                const key2 = i + 2;
                const note2 = NOTE_NAMES[i + 1];
                const freq2 = PIANO_FREQUENCIES[i + 1];
                
                row.innerHTML += `
                    <td>${key2}</td>
                    <td>${note2}</td>
                    <td>${freq2.toFixed(2)}</td>
                `;
            } else {
                // Add empty cells if odd number of keys
                row.innerHTML += '<td></td><td></td><td></td>';
            }
            
            // Highlight special notes
            if (note1 === 'A4' || (i + 1 < PIANO_FREQUENCIES.length && NOTE_NAMES[i + 1] === 'A4')) {
                row.classList.add('note-a4');
            }
            if (note1 === 'C4' || (i + 1 < PIANO_FREQUENCIES.length && NOTE_NAMES[i + 1] === 'C4')) {
                row.classList.add('note-c4');
            }
            
            tableBody.appendChild(row);
        }
        
        console.log(`Populated frequency reference table with ${PIANO_FREQUENCIES.length} keys`);
    }
}

// Initialize the app
const app = new BowheadPiano();
