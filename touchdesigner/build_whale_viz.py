"""
build_whale_viz.py — run INSIDE TouchDesigner to scaffold the bioluminescent
whale-song visualizer network.

How to run
----------
1. Open TouchDesigner (a fresh project is fine).
2. Create a Text DAT, paste this whole file in.
3. Right-click the Text DAT → "Run Script"  (or in the Textport:
   run("/path/to/build_whale_viz.py") ).
This creates /whale_viz containing the whole network and wires it up.

What it builds
--------------
- A WebSocket DAT **server** on port 9980. The piano (app.js) connects as a
  client and streams {type:'noteon'|'noteoff', key, note, pitchHz, clipHz}.
  The callbacks write active notes into a 'notes' table.
- The 'notes' table → CHOP → 'seeds' TOP (a tiny Nx1 RGBA texture: x, y, hue,
  intensity per active note).
- Audio Device In CHOP (set this to your BlackHole device) → Analyze (RMS) for
  the 'uLevel' uniform that drives glow/turbulence.
- A GLSL TOP + Feedback TOP loop: each frame advects the image gently UPWARD
  with a lateral sway (slow jellyfish drift), decays it (luminous wake), and
  injects a glowing seed at every active note. Bloom via Blur + add-composite
  over a dark abyssal background.

NOTE: This is a runnable scaffold. It is authored against the TD Python API but
was not test-run inside TD from the build environment, so a couple of operator
parameters (audio device name, CHOP→TOP channel order) may need a single click —
see touchdesigner/README.md. Op type names target TD 2022+/2023.
"""

# GLSL pixel shader for the 'sim' GLSL TOP.
SIM_FRAG = r"""
uniform float uTime;
uniform float uLevel;   // audio RMS, 0..1
uniform float uSeeds;   // number of active notes (rows)
out vec4 fragColor;

vec3 hue2rgb(float h){
    h = fract(h);
    vec3 k = clamp(abs(mod(h*6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return k;
}

void main(){
    vec2 uv = vUV.st;

    // Jellyfish flow: drift the image UPWARD (sample from below) with a slow
    // lateral sway; the louder the call, the stronger the rise/turbulence.
    float sway = sin(uv.y * 7.0 + uTime * 0.6) * 0.0016;
    vec2 flow  = vec2(sway, 0.0035 + uLevel * 0.004);
    vec3 prev  = texture(sTD2DInputs[0], uv + flow).rgb;
    prev *= 0.962;                 // decay -> luminous wake

    // Inject a soft glow at each active note (seeds texture: r=x,g=y,b=hue,a=intensity)
    vec3 inj = vec3(0.0);
    int n = int(uSeeds);
    for (int i = 0; i < 64; i++){
        if (i >= n) break;
        vec4 s = texelFetch(sTD2DInputs[1], ivec2(i, 0), 0);
        float d   = distance(uv, vec2(s.r, s.g));
        float core = smoothstep(0.05, 0.0, d) * s.a;
        // a faint vertical tendril below the node
        float tend = smoothstep(0.012, 0.0, abs(uv.x - s.r + sin(uv.y*30.0+uTime)*0.01))
                     * smoothstep(0.32, 0.0, s.g - uv.y) * s.a * 0.5;
        inj += hue2rgb(s.b) * (core + tend) * (0.6 + uLevel);
    }

    vec3 col = prev + inj;
    fragColor = TDOutputSwizzle(vec4(col, 1.0));
}
"""

# WebSocket DAT callbacks (written into a Text DAT and assigned as its callbacks).
WS_CALLBACKS = r"""
# Callbacks for the whale-piano WebSocket DAT (server mode).
import json, math, random

def _notes():
    return op('notes')

def _find_row(t, key):
    for r in range(1, t.numRows):
        if t[r, 0].val == str(key):
            return r
    return -1

def onReceiveText(dat, rowIndex, message):
    try:
        d = json.loads(message)
    except Exception:
        return
    t = _notes()
    typ = d.get('type'); key = d.get('key')
    if key is None:
        return
    if typ == 'noteon':
        pitch = float(d.get('pitchHz') or 110.0)
        x = max(0.04, min(0.96, math.log2(max(1.0, pitch) / 27.5) / 7.0))  # pitch -> 0..1
        y = 0.30 + 0.45 * random.random()
        hue = x                       # cyan->violet shares the app's mapping
        r = _find_row(t, key)
        if r < 0:
            t.appendRow([str(key), x, y, hue, 1.0])
        else:
            t[r, 1] = x; t[r, 2] = y; t[r, 3] = hue; t[r, 4] = 1.0
    elif typ == 'noteoff':
        r = _find_row(t, key)
        if r >= 0:
            t.deleteRow(r)
    return

def onConnect(dat): return
def onDisconnect(dat): return
def onReceiveBinary(dat, contents): return
"""


def build():
    root = op('/')

    # Fresh start.
    existing = root.op('whale_viz')
    if existing:
        existing.destroy()
    base = root.create(baseCOMP, 'whale_viz')

    def make(t, name, x, y):
        n = base.create(t, name)
        n.nodeX, n.nodeY = x, y
        return n

    # ── data in: WebSocket + notes table ─────────────────────────────────────
    notes = make(tableDAT, 'notes', -800, 400)
    notes.clear()
    notes.appendRow(['key', 'x', 'y', 'hue', 'intensity'])

    ws_cb = make(textDAT, 'ws_callbacks', -800, 250)
    ws_cb.text = WS_CALLBACKS

    ws = make(webSocketDAT, 'websocket1', -800, 550)
    try:
        ws.par.active = True
        ws.par.netaddress = ''         # server: bind all
        ws.par.port = 9980
        ws.par.callbacks = ws_cb.path
        # Some builds expose a server/client mode toggle:
        if hasattr(ws.par, 'rowcallback'):
            ws.par.rowcallback = False
    except Exception as e:
        print('websocket param note:', e)

    # ── notes -> seeds texture ───────────────────────────────────────────────
    n2c = make(datToCHOP, 'notes_chop', -560, 400)
    try:
        n2c.par.dat = notes.path
        n2c.par.firstrowisnames = True   # use header row as channel names
    except Exception as e:
        print('datToCHOP param note:', e)

    sel = make(selectCHOP, 'seed_select', -360, 400)
    try:
        sel.par.chop = n2c.path
        sel.par.channames = 'x y hue intensity'   # order = R G B A
    except Exception as e:
        print('selectCHOP param note:', e)

    seeds = make(chopToTOP, 'seeds', -160, 400)
    try:
        seeds.par.chop = sel.path
    except Exception as e:
        print('chopToTOP param note:', e)

    # ── audio in (BlackHole) -> level ────────────────────────────────────────
    audio = make(audiodeviceinCHOP, 'audioin', -800, 0)
    print("Set 'audioin' Device parameter to your BlackHole virtual device.")
    level = make(analyzeCHOP, 'audio_level', -560, 0)
    try:
        level.par.function = 6           # 6 = RMS Power in most builds
        level.inputConnectors[0].connect(audio)
    except Exception as e:
        print('analyze param note:', e)

    # ── GLSL feedback sim ────────────────────────────────────────────────────
    sim = make(glslTOP, 'sim', 120, 150)
    fb = make(feedbackTOP, 'fb', 120, 350)
    try:
        sim.par.pixeldat = ''            # we set text directly below
    except Exception:
        pass
    # GLSL TOP keeps its shader in a child Text DAT 'pixel1' (varies by build);
    # also set the .par.pixeldat to an inline DAT for reliability.
    pix = make(textDAT, 'sim_pixel', 120, 0)
    pix.text = SIM_FRAG
    try:
        sim.par.pixeldat = pix.path
    except Exception as e:
        print('glsl pixeldat note (paste SIM_FRAG into the GLSL TOP pixel shader if blank):', e)

    for n in (sim, fb):
        try:
            n.par.resolutionw = 1280; n.par.resolutionh = 720
            n.par.outputresolution = 9   # custom
        except Exception:
            pass

    # uniforms on the GLSL TOP
    try:
        sim.par.value0name = 'uTime';  sim.par.value0x = "absTime.seconds"; sim.par.value0x.expr = "absTime.seconds"
        sim.par.value1name = 'uLevel'; sim.par.value1x.expr = "op('audio_level')[0] if op('audio_level').numChans else 0"
        sim.par.value2name = 'uSeeds'; sim.par.value2x.expr = "max(0, op('notes').numRows - 1)"
    except Exception as e:
        print('uniform note (set uTime/uLevel/uSeeds on the GLSL Vectors page):', e)

    # wiring: sim input0 = feedback(prev), input1 = seeds ; feedback target = sim
    sim.inputConnectors[0].connect(fb)
    sim.inputConnectors[1].connect(seeds)
    fb.inputConnectors[0].connect(sim)
    try:
        fb.par.top = sim.path
    except Exception as e:
        print('feedback target note:', e)

    # ── bloom + background + output ──────────────────────────────────────────
    blur = make(blurTOP, 'glow', 380, 250)
    blur.inputConnectors[0].connect(sim)
    try:
        blur.par.size = 14
    except Exception:
        pass

    comp = make(compositeTOP, 'bloom', 600, 200)
    try:
        comp.par.operand = 31            # 31 = Add in most builds
    except Exception:
        pass
    comp.inputConnectors[0].connect(sim)
    comp.inputConnectors[1].connect(blur)

    out = make(nullTOP, 'OUT', 820, 200)
    out.inputConnectors[0].connect(comp)
    try:
        out.viewer = True
    except Exception:
        pass

    print('\n✅ Built /whale_viz. Next:')
    print("  1) Select 'audioin' and set its Device to BlackHole.")
    print("  2) Confirm 'websocket1' is Active and on port 9980.")
    print("  3) Open the piano (Chrome), Auto-Load sounds, play — 'OUT' lights up.")
    print("  4) Right-click OUT → View, or drag to a Perform window / second screen.")


try:
    build()
except Exception as e:
    import traceback; traceback.print_exc()
    print('Build error:', e)
