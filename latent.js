/* Bowhead Latent Space — interactive PaCMAP scatter linked to playback.
 *
 * Loads latent_embedding.json (8000 subsampled points: x,y in 0..1, t=type index)
 * and renders a pan/zoom Canvas scatter colored by bowhead call type. Hovering a
 * point shows its type; clicking plays a whale clip — the point's PaCMAP-1 (x)
 * position is mapped to a piano key, and the clip is pitch-locked to that note
 * (same idea as the piano: playbackRate = noteFreq / clipFreq).
 */
"use strict";

const TYPE_COLORS = [
    '#36c2ff', '#4ade80', '#f59e0b', '#e94560',
    '#a78bfa', '#22d3ee', '#fb7185', '#facc15', '#94a3b8',
];
const pianoFreq = (k) => 27.5 * Math.pow(2, k / 12); // 88-key, A0 = key 0
const NOTE_NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const noteName = (k) => NOTE_NAMES[k % 12] + Math.floor((k + 9) / 12);

// Sonify the embedding: each call type maps to a scale degree of a C-major scale
// (so points in the same cluster sound related), and the point's vertical
// position picks the octave (higher in the map = higher pitch).
const TYPE_DEGREE = [0, 2, 4, 5, 7, 9, 11, 12]; // semitone offset per call type
function keyForPoint(i) {
    const deg = TYPE_DEGREE[DATA.t[i] % TYPE_DEGREE.length];
    const octave = Math.floor(DATA.y[i] * 5);    // 0..4  → ~C2..C6
    const key = 3 + (octave + 1) * 12 + deg;       // 3 = C1 on an A0-based board
    return Math.max(0, Math.min(87, key));
}

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const tip = document.getElementById('tip');
const statusEl = document.getElementById('status');

let DATA = null;                 // {n, types, x, y, t}
let view = { scale: 1, ox: 0, oy: 0 };
let dpr = 1, hoverIdx = -1;
const typeOn = [];               // legend toggles
let pulses = [];                 // click feedback

// ── audio (standalone mini-player, pitch-locked like the piano) ──────────────
let actx = null, manifest = null, clipFreqs = {}, audioReady = null;
const buffers = new Map();

function initAudioData() {
    audioReady = (async () => {
        try {
            const [m, f] = await Promise.all([
                fetch('manifest.json').then(r => r.ok ? r.json() : null).catch(() => null),
                fetch('clip_frequencies.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
            ]);
            manifest = m && m.files ? m.files : null;
            clipFreqs = f || {};
        } catch (_) { /* playback just won't work; scatter still does */ }
    })();
    return audioReady;
}

async function playForPoint(i) {
    if (audioReady) { setStatus('Loading clips…'); try { await audioReady; } catch (_) {} }
    if (!manifest) { setStatus('No clips loaded — playback unavailable.'); return; }
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') await actx.resume();

    const key = keyForPoint(i);
    const info = manifest[key];
    if (!info) return;
    const name = info.newName;
    setStatus(`▶ ${DATA.types[DATA.t[i]]} → ${noteName(key)} · ${name}`);

    let buf = buffers.get(name);
    if (!buf) {
        try {
            const r = await fetch('wav-clips/' + name);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            buf = await actx.decodeAudioData(await r.arrayBuffer());
            buffers.set(name, buf);
        } catch (e) { setStatus('✗ ' + e.message); return; }
    }
    const src = actx.createBufferSource();
    src.buffer = buf;
    const cf = Number(clipFreqs[name]) || 0;
    src.playbackRate.value = cf > 0 ? Math.max(0.125, Math.min(8, pianoFreq(key) / cf)) : 1;
    const g = actx.createGain(); g.gain.value = 4.0;
    src.connect(g); g.connect(actx.destination);
    src.start();
    pulses.push({ x: DATA.x[i], y: DATA.y[i], t: performance.now() / 1000, hue: DATA.t[i] });
}

function setStatus(s) { statusEl.textContent = s; }

// ── view / projection ────────────────────────────────────────────────────────
function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
}
function fitView() {
    const s = Math.min(canvas.width, canvas.height) * 0.92;
    view.scale = s;
    view.ox = (canvas.width - s) / 2;
    view.oy = (canvas.height - s) / 2;
}
const sx = (x) => view.ox + x * view.scale;
const sy = (y) => view.oy + (1 - y) * view.scale; // flip Y so up = +

// ── render ───────────────────────────────────────────────────────────────────
function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#02060f';
    ctx.fillRect(0, 0, W, H);

    const r = Math.max(1.2, 1.7 * dpr) * Math.max(0.6, Math.min(2.2, view.scale / 900));
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < DATA.n; i++) {
        const ti = DATA.t[i];
        if (!typeOn[ti]) continue;
        const X = sx(DATA.x[i]), Y = sy(DATA.y[i]);
        if (X < -5 || X > W + 5 || Y < -5 || Y > H + 5) continue;
        ctx.fillStyle = TYPE_COLORS[ti % TYPE_COLORS.length];
        ctx.globalAlpha = i === hoverIdx ? 1 : 0.55;
        ctx.beginPath(); ctx.arc(X, Y, i === hoverIdx ? r * 3 : r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // click pulses
    const now = performance.now() / 1000;
    pulses = pulses.filter(p => now - p.t < 1.2);
    for (const p of pulses) {
        const age = (now - p.t) / 1.2;
        ctx.strokeStyle = TYPE_COLORS[p.hue % TYPE_COLORS.length];
        ctx.globalAlpha = (1 - age) * 0.9;
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), age * 40 * dpr + 4, 0, 6.283); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
}

// ── hit testing ───────────────────────────────────────────────────────────────
function nearest(mx, my) {
    let best = -1, bestD = 12 * dpr * 12 * dpr;
    for (let i = 0; i < DATA.n; i++) {
        if (!typeOn[DATA.t[i]]) continue;
        const dxp = sx(DATA.x[i]) - mx, dyp = sy(DATA.y[i]) - my;
        const d = dxp * dxp + dyp * dyp;
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

// ── legend ─────────────────────────────────────────────────────────────────────
function buildLegend() {
    const el = document.getElementById('legend');
    DATA.types.forEach((name, i) => {
        typeOn[i] = true;
        const row = document.createElement('div');
        row.className = 'lg';
        row.innerHTML = `<span class="sw" style="background:${TYPE_COLORS[i % TYPE_COLORS.length]}"></span>${name}`;
        row.onclick = () => { typeOn[i] = !typeOn[i]; row.classList.toggle('off', !typeOn[i]); };
        el.appendChild(row);
    });
}

// ── interaction ──────────────────────────────────────────────────────────────
let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
canvas.addEventListener('mousedown', (e) => { dragging = true; dragMoved = false; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', (e) => {
    if (dragging && !dragMoved) {
        const i = nearest(e.clientX * dpr, e.clientY * dpr);
        if (i >= 0) playForPoint(i);
    }
    dragging = false;
});
canvas.addEventListener('mousemove', (e) => {
    const mx = e.clientX * dpr, my = e.clientY * dpr;
    if (dragging) {
        const ddx = (e.clientX - lastX) * dpr, ddy = (e.clientY - lastY) * dpr;
        if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 3) dragMoved = true;
        view.ox += ddx; view.oy += ddy; lastX = e.clientX; lastY = e.clientY;
        tip.style.display = 'none';
        return;
    }
    const i = nearest(mx, my);
    hoverIdx = i;
    if (i >= 0) {
        tip.style.display = 'block';
        tip.style.left = (e.clientX + 12) + 'px';
        tip.style.top = (e.clientY + 12) + 'px';
        tip.textContent = DATA.types[DATA.t[i]];
    } else { tip.style.display = 'none'; }
});
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const mx = e.clientX * dpr, my = e.clientY * dpr;
    const f = Math.exp(-e.deltaY * 0.0015);
    // zoom around the cursor
    view.ox = mx - (mx - view.ox) * f;
    view.oy = my - (my - view.oy) * f;
    view.scale *= f;
}, { passive: false });
window.addEventListener('resize', () => { resize(); });

// ── boot ─────────────────────────────────────────────────────────────────────
(async function () {
    resize();
    setStatus('Loading embedding…');
    try {
        DATA = await fetch('latent_embedding.json', { cache: 'no-store' }).then(r => r.json());
    } catch (e) {
        setStatus('✗ latent_embedding.json missing — run export_latent_for_web.py');
        return;
    }
    fitView();
    buildLegend();
    setStatus(`${DATA.n.toLocaleString()} points · ${DATA.types.length} call types`);
    initAudioData();
    requestAnimationFrame(draw);
    // small hook for deep-linking / automation
    window.LATENT = { data: () => DATA, project: (i) => ({ x: sx(DATA.x[i]), y: sy(DATA.y[i]) }), play: (i) => playForPoint(i) };
})();
