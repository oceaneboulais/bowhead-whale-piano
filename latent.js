/* Bowhead Latent Space — rotatable 3D PaCMAP scatter linked to playback.
 *
 * Loads latent_embedding.json (8000 subsampled points: x,y,z in 0..1, t=type)
 * and renders an orbitable 3D scatter colored by bowhead call type. Drag to
 * rotate, scroll to zoom; it gently auto-spins when idle. Hovering shows the
 * call type; clicking sonifies the point — call type → C-major scale degree,
 * vertical position → octave — and plays that key's whale clip, pitch-locked.
 */
"use strict";

const TYPE_COLORS = [
    '#36c2ff', '#4ade80', '#f59e0b', '#e94560',
    '#a78bfa', '#22d3ee', '#fb7185', '#facc15', '#94a3b8',
];
const pianoFreq = (k) => 27.5 * Math.pow(2, k / 12);   // 88-key, A0 = key 0
const NOTE_NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const noteName = (k) => NOTE_NAMES[k % 12] + Math.floor((k + 9) / 12);

// call type → scale degree (cluster-mates sound related); height → octave
const TYPE_DEGREE = [0, 2, 4, 5, 7, 9, 11, 12];
function keyForPoint(i) {
    const deg = TYPE_DEGREE[DATA.t[i] % TYPE_DEGREE.length];
    const octave = Math.floor(DATA.y[i] * 5);          // 0..4 → ~C2..C6
    return Math.max(0, Math.min(87, 3 + (octave + 1) * 12 + deg));
}

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const tip = document.getElementById('tip');
const statusEl = document.getElementById('status');

let DATA = null;
let dpr = 1, hoverIdx = -1;
let pulses = [];                                       // {i, t}
const cam = { yaw: 0.6, pitch: 0.35, zoom: 1 };
let lastInteract = 0;                                  // ms; idle → auto-spin
const typeOn = [];

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
        } catch (_) { /* scatter still works without audio */ }
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
    pulses.push({ i, t: performance.now() / 1000 });
}

function setStatus(s) { statusEl.textContent = s; }

// ── 3D projection ─────────────────────────────────────────────────────────────
let cx = 0, cy = 0, baseSize = 1;
const FOCAL = 2.4;
function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    cx = canvas.width / 2; cy = canvas.height / 2;
    baseSize = Math.min(canvas.width, canvas.height) * 0.42;
}
// returns {px, py, persp, depth}
function project(i) {
    const x = DATA.x[i] - 0.5, y = DATA.y[i] - 0.5, z = (DATA.z ? DATA.z[i] : 0.5) - 0.5;
    const cyaw = Math.cos(cam.yaw), syaw = Math.sin(cam.yaw);
    const cpit = Math.cos(cam.pitch), spit = Math.sin(cam.pitch);
    const x1 = x * cyaw + z * syaw;          // yaw about vertical axis
    const z1 = -x * syaw + z * cyaw;
    const y2 = y * cpit - z1 * spit;          // pitch about horizontal axis
    const z2 = y * spit + z1 * cpit;
    const persp = FOCAL / (FOCAL - z2);
    return {
        px: cx + x1 * persp * baseSize * cam.zoom,
        py: cy - y2 * persp * baseSize * cam.zoom,
        persp, depth: z2,
    };
}

// ── render ───────────────────────────────────────────────────────────────────
function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#02060f';
    ctx.fillRect(0, 0, W, H);

    // idle auto-spin
    if (performance.now() - lastInteract > 2500) cam.yaw += 0.0022;

    ctx.globalCompositeOperation = 'lighter';
    const r0 = Math.max(1.1, 1.5 * dpr);
    for (let i = 0; i < DATA.n; i++) {
        const ti = DATA.t[i];
        if (!typeOn[ti]) continue;
        const p = project(i);
        if (p.px < -5 || p.px > W + 5 || p.py < -5 || p.py > H + 5) continue;
        const near = (p.depth + 0.9) / 1.8;              // ~0..1, front = brighter/bigger
        ctx.fillStyle = TYPE_COLORS[ti % TYPE_COLORS.length];
        ctx.globalAlpha = i === hoverIdx ? 1 : (0.28 + 0.55 * near);
        const r = (i === hoverIdx ? r0 * 3.2 : r0 * (0.6 + 0.9 * near)) * p.persp;
        ctx.beginPath(); ctx.arc(p.px, p.py, r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // click pulses (ripples at the played node)
    const now = performance.now() / 1000;
    pulses = pulses.filter(pl => now - pl.t < 1.2);
    for (const pl of pulses) {
        const age = (now - pl.t) / 1.2;
        const p = project(pl.i);
        ctx.strokeStyle = TYPE_COLORS[DATA.t[pl.i] % TYPE_COLORS.length];
        ctx.globalAlpha = (1 - age) * 0.9;
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.arc(p.px, p.py, age * 42 * dpr + 4, 0, 6.283); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
}

// ── hit testing (screen-space nearest, prefer front) ──────────────────────────
function nearest(mx, my) {
    let best = -1, bestScore = 14 * dpr * 14 * dpr;
    for (let i = 0; i < DATA.n; i++) {
        if (!typeOn[DATA.t[i]]) continue;
        const p = project(i);
        const dxp = p.px - mx, dyp = p.py - my;
        const d = dxp * dxp + dyp * dyp;
        if (d < bestScore) { bestScore = d; best = i; }
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

// ── interaction: drag = orbit, wheel = zoom, click = play ─────────────────────
let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
canvas.addEventListener('mousedown', (e) => {
    dragging = true; dragMoved = false; lastX = e.clientX; lastY = e.clientY;
    lastInteract = performance.now();
});
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
        const ddx = e.clientX - lastX, ddy = e.clientY - lastY;
        if (Math.abs(ddx) + Math.abs(ddy) > 3) dragMoved = true;
        cam.yaw += ddx * 0.006;
        cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch + ddy * 0.006));
        lastX = e.clientX; lastY = e.clientY;
        lastInteract = performance.now();
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
    cam.zoom = Math.max(0.4, Math.min(6, cam.zoom * Math.exp(-e.deltaY * 0.0012)));
    lastInteract = performance.now();
}, { passive: false });
// touch: one finger orbit
canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0]; lastX = t.clientX; lastY = t.clientY; dragging = true; dragMoved = false;
    lastInteract = performance.now();
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    cam.yaw += (t.clientX - lastX) * 0.006;
    cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch + (t.clientY - lastY) * 0.006));
    lastX = t.clientX; lastY = t.clientY; dragMoved = true; lastInteract = performance.now();
}, { passive: true });
canvas.addEventListener('touchend', (e) => {
    if (dragging && !dragMoved && e.changedTouches[0]) {
        const ct = e.changedTouches[0];
        const i = nearest(ct.clientX * dpr, ct.clientY * dpr);
        if (i >= 0) playForPoint(i);
    }
    dragging = false;
});
window.addEventListener('resize', resize);

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
    buildLegend();
    const dimLabel = (DATA.dim || (DATA.z ? 3 : 2)) + 'D';
    setStatus(`${DATA.n.toLocaleString()} points · ${DATA.types.length} call types · ${dimLabel}`);
    initAudioData();
    requestAnimationFrame(draw);
    window.LATENT = { data: () => DATA, project: (i) => { const p = project(i); return { x: p.px, y: p.py }; }, play: (i) => playForPoint(i), cam };
})();
