/* Bowhead Latent Space — rotatable 3D/2D PaCMAP scatter linked to playback.
 *
 * Loads latent_embedding.json (subsampled points: x,y,z + x2,y2, t=type, c=cluster)
 * and renders an orbitable scatter colored by call type OR cluster. Drag to rotate
 * (with momentum/inertia), scroll to zoom, gentle auto-spin when idle. Hover shows
 * the group; clicking sonifies the point — call type → C-major scale degree,
 * vertical position → octave — and plays that key's whale clip, pitch-locked.
 */
"use strict";

const TYPE_COLORS = [
    '#36c2ff', '#4ade80', '#f59e0b', '#e94560',
    '#a78bfa', '#22d3ee', '#fb7185', '#facc15', '#94a3b8',
];
const CLUSTER_COLORS = ['#36c2ff', '#f59e0b', '#4ade80', '#e94560', '#a78bfa'];
const pianoFreq = (k) => 27.5 * Math.pow(2, k / 12);
const NOTE_NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const noteName = (k) => NOTE_NAMES[k % 12] + Math.floor((k + 9) / 12);

const TYPE_DEGREE = [0, 2, 4, 5, 7, 9, 11, 12]; // call type → scale degree
function keyForPoint(i) {
    const deg = TYPE_DEGREE[DATA.t[i] % TYPE_DEGREE.length];
    const octave = Math.floor(DATA.y[i] * 5);
    return Math.max(0, Math.min(87, 3 + (octave + 1) * 12 + deg));
}

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const tip = document.getElementById('tip');
const statusEl = document.getElementById('status');

let DATA = null;
let mode = '3d';            // '3d' | '2d'
let colorMode = 'type';     // 'type' | 'cluster'
let dpr = 1, hoverIdx = -1;
let pulses = [];
const cam = { yaw: 0.6, pitch: 0.35, zoom: 1, px: 0, py: 0 }; // px/py = 2D pan
const vel = { yaw: 0, pitch: 0 };     // inertia
let lastInteract = 0;
const typeOn = [], clusterOn = [];

// group accessors honor the active color mode
const groupIdx = (i) => colorMode === 'type' ? DATA.t[i] : DATA.c[i];
const groupColors = () => colorMode === 'type' ? TYPE_COLORS : CLUSTER_COLORS;
const groupOn = () => colorMode === 'type' ? typeOn : clusterOn;
const groupName = (g) => colorMode === 'type' ? DATA.types[g] : ('Cluster ' + g);
const colorFor = (i) => groupColors()[groupIdx(i) % groupColors().length];

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
    const g = actx.createGain(); g.gain.value = 5.0;
    src.connect(g); g.connect(actx.destination);
    src.start();
    pulses.push({ i, t: performance.now() / 1000 });
}

function setStatus(s) { statusEl.textContent = s; }

// ── projection (3D orbit or 2D ortho) ─────────────────────────────────────────
let cx = 0, cy = 0, baseSize = 1;
const FOCAL = 2.4;
function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    cx = canvas.width / 2; cy = canvas.height / 2;
    baseSize = Math.min(canvas.width, canvas.height) * 0.42;
}
function project(i) {
    if (mode === '2d') {
        const x = (DATA.x2 ? DATA.x2[i] : DATA.x[i]) - 0.5;
        const y = (DATA.y2 ? DATA.y2[i] : DATA.y[i]) - 0.5;
        return { px: cx + x * baseSize * 2 * cam.zoom + cam.px,
                 py: cy - y * baseSize * 2 * cam.zoom + cam.py, persp: 1, depth: 0 };
    }
    const x = DATA.x[i] - 0.5, y = DATA.y[i] - 0.5, z = (DATA.z ? DATA.z[i] : 0.5) - 0.5;
    const cyaw = Math.cos(cam.yaw), syaw = Math.sin(cam.yaw);
    const cpit = Math.cos(cam.pitch), spit = Math.sin(cam.pitch);
    const x1 = x * cyaw + z * syaw;
    const z1 = -x * syaw + z * cyaw;
    const y2 = y * cpit - z1 * spit;
    const z2 = y * spit + z1 * cpit;
    const persp = FOCAL / (FOCAL - z2);
    return { px: cx + x1 * persp * baseSize * cam.zoom, py: cy - y2 * persp * baseSize * cam.zoom, persp, depth: z2 };
}

// ── render ───────────────────────────────────────────────────────────────────
function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#02060f';
    ctx.fillRect(0, 0, W, H);

    // inertia + idle auto-spin (3D only)
    if (mode === '3d') {
        const dragging = pointer.dragging;
        if (!dragging) {
            cam.yaw += vel.yaw;
            cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch + vel.pitch));
            vel.yaw *= 0.94; vel.pitch *= 0.94;
            if (Math.abs(vel.yaw) < 0.0004 && Math.abs(vel.pitch) < 0.0004
                && performance.now() - lastInteract > 2500) {
                cam.yaw += 0.0022;
            }
        }
    }

    ctx.globalCompositeOperation = 'lighter';
    const on = groupOn(), r0 = Math.max(1.1, 1.5 * dpr);
    for (let i = 0; i < DATA.n; i++) {
        if (!on[groupIdx(i)]) continue;
        const p = project(i);
        if (p.px < -5 || p.px > W + 5 || p.py < -5 || p.py > H + 5) continue;
        const near = (p.depth + 0.9) / 1.8;
        ctx.fillStyle = colorFor(i);
        ctx.globalAlpha = i === hoverIdx ? 1 : (mode === '2d' ? 0.6 : 0.28 + 0.55 * near);
        const r = (i === hoverIdx ? r0 * 3.2 : r0 * (mode === '2d' ? 1 : 0.6 + 0.9 * near)) * p.persp;
        ctx.beginPath(); ctx.arc(p.px, p.py, r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;

    const now = performance.now() / 1000;
    pulses = pulses.filter(pl => now - pl.t < 1.2);
    for (const pl of pulses) {
        const age = (now - pl.t) / 1.2, p = project(pl.i);
        ctx.strokeStyle = colorFor(pl.i); ctx.globalAlpha = (1 - age) * 0.9; ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.arc(p.px, p.py, age * 42 * dpr + 4, 0, 6.283); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
}

function nearest(mx, my) {
    let best = -1, bestScore = 18 * dpr * 18 * dpr, on = groupOn();
    for (let i = 0; i < DATA.n; i++) {
        if (!on[groupIdx(i)]) continue;
        const p = project(i), dxp = p.px - mx, dyp = p.py - my, d = dxp * dxp + dyp * dyp;
        if (d < bestScore) { bestScore = d; best = i; }
    }
    return best;
}

// ── legend (rebuilds for type or cluster) ─────────────────────────────────────
function buildLegend() {
    const el = document.getElementById('legend');
    el.innerHTML = '<h3>' + (colorMode === 'type' ? 'Call type' : 'Cluster') + '</h3>';
    const names = colorMode === 'type' ? DATA.types : Array.from({ length: DATA.nclusters || 0 }, (_, i) => 'Cluster ' + i);
    const on = groupOn();
    names.forEach((name, i) => {
        if (on[i] === undefined) on[i] = true;
        const row = document.createElement('div');
        row.className = 'lg' + (on[i] ? '' : ' off');
        row.innerHTML = `<span class="sw" style="background:${groupColors()[i % groupColors().length]}"></span>${name}`;
        row.onclick = () => { on[i] = !on[i]; row.classList.toggle('off', !on[i]); };
        el.appendChild(row);
    });
}

// ── interaction ────────────────────────────────────────────────────────────────
const pointer = { dragging: false, moved: false, lx: 0, ly: 0 };
function down(x, y) { pointer.dragging = true; pointer.moved = false; pointer.lx = x; pointer.ly = y; vel.yaw = vel.pitch = 0; lastInteract = performance.now(); }
function move(x, y) {
    if (!pointer.dragging) return;
    const ddx = x - pointer.lx, ddy = y - pointer.ly;
    if (Math.abs(ddx) + Math.abs(ddy) > 6) pointer.moved = true;
    if (mode === '3d') {
        cam.yaw += ddx * 0.006; cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch + ddy * 0.006));
        vel.yaw = ddx * 0.006; vel.pitch = ddy * 0.006;       // carry momentum on release
    } else { cam.px += ddx * dpr; cam.py += ddy * dpr; }
    pointer.lx = x; pointer.ly = y; lastInteract = performance.now(); tip.style.display = 'none';
}
function up(x, y) {
    if (pointer.dragging && !pointer.moved) { const i = nearest(x * dpr, y * dpr); if (i >= 0) playForPoint(i); }
    pointer.dragging = false;
}
canvas.addEventListener('mousedown', (e) => down(e.clientX, e.clientY));
window.addEventListener('mouseup', (e) => up(e.clientX, e.clientY));
canvas.addEventListener('mousemove', (e) => {
    lastInteract = performance.now();                          // hovering pauses auto-spin so targets hold still
    if (pointer.dragging) { move(e.clientX, e.clientY); return; }
    const i = nearest(e.clientX * dpr, e.clientY * dpr);
    hoverIdx = i;
    if (i >= 0) {
        tip.style.display = 'block'; tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 12) + 'px';
        tip.textContent = colorMode === 'type' ? DATA.types[DATA.t[i]] : ('Cluster ' + DATA.c[i]);
    } else tip.style.display = 'none';
});
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.zoom = Math.max(0.4, Math.min(8, cam.zoom * Math.exp(-e.deltaY * 0.0012)));
    lastInteract = performance.now();
}, { passive: false });
canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; down(t.clientX, t.clientY); }, { passive: true });
canvas.addEventListener('touchmove', (e) => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
canvas.addEventListener('touchend', (e) => { const t = e.changedTouches[0]; if (t) up(t.clientX, t.clientY); });
window.addEventListener('resize', resize);

// ── mode / color toggles ──────────────────────────────────────────────────────
function setMode(m) {
    mode = m;
    document.getElementById('dim-toggle').textContent = mode === '3d' ? '3D' : '2D';
    document.getElementById('hint').innerHTML = (mode === '3d' ? 'drag to rotate' : 'drag to pan')
        + ' · scroll to zoom · click a point to play<br>call type → note · height → octave';
}
function setColorMode(cm) {
    colorMode = cm;
    document.getElementById('color-toggle').textContent = 'Color: ' + (cm === 'type' ? 'Type' : 'Cluster');
    buildLegend();
}

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
    setStatus(`${DATA.n.toLocaleString()} points · ${DATA.types.length} call types · ${DATA.nclusters} clusters`);
    initAudioData();

    document.getElementById('dim-toggle').onclick = () => setMode(mode === '3d' ? '2d' : '3d');
    document.getElementById('color-toggle').onclick = () => setColorMode(colorMode === 'type' ? 'cluster' : 'type');

    requestAnimationFrame(draw);
    window.LATENT = {
        data: () => DATA, project: (i) => { const p = project(i); return { x: p.px, y: p.py }; },
        play: (i) => playForPoint(i), cam, setMode, setColorMode, getState: () => ({ mode, colorMode }),
    };
})();
