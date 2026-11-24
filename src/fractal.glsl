#version 300 es
precision highp float;
precision highp int;

// One fractal, one camera. Every pixel walks down from the whole hexagon into the piece it lies in,
// level by level. A piece stops being split once its parts would get too small on screen, so zooming
// in keeps revealing detail and zooming out merges it again, without end.
//
// The sections' content is part of it. The portrait is a place in the structure where the pieces take
// their light from a photo. The articles are three hexagons whose pieces draw each article's scene.
// The embeds are a hexagon of three faces. Their pieces clear away until each face is one clean opening
// onto what lies under the canvas, with straight edges: three large pieces, like any others.

uniform vec2 uRes;      // canvas size in CSS px
uniform float uDpr;
uniform vec2 uCam;      // world point at the centre of the screen
uniform float uScale;   // world units per CSS px
uniform float uTime;    // seconds
uniform float uLife;    // 1: alive, 0: still (reduced motion)
uniform vec4 uCalm0;    // text boxes (x0, y0, x1, y1 in CSS px); the structure goes quiet under them
uniform vec4 uCalm1;
uniform vec2 uCalmK;    // how strongly, per box
uniform vec2 uCentre;   // where the rings of light start, in CSS px
uniform vec3 uShow;     // how far each section's content has formed: portrait, articles, embeds
uniform float uLod;     // how many levels the detail runs behind the camera: above 0 while pulling back
uniform float uMove;    // 1 while the camera moves fast, 0 at rest
uniform float uGrain;   // the smallest pieces are about this many px
uniform float uFine;    // the smallest pieces of the face, in px
uniform float uVeil;    // how far the fractal has closed over the embeds again, seen from afar
uniform vec3 uPort;     // the portrait: centre (world) and half its side
uniform vec2 uFace;     // the face's centre (world): the pieces are finest there
uniform float uHover;   // the article under the pointer, or -1
uniform sampler2D uPhoto;   // a: how much of the person is there, r: the photo's light times a
uniform sampler2D uScenes;  // three scenes side by side. r: a form, g: the form in focus
out vec4 o;

const vec3 BG = vec3(21.0, 23.0, 26.0) / 255.0;
const vec3 BLUE = vec3(90.0, 111.0, 165.0) / 255.0;
const vec3 PINK = vec3(160.0, 80.0, 112.0) / 255.0;
const float H3 = 0.8660254;
// How small the pieces get is set per section (uGrain, in px): large close up, finest seen from afar.
const uint SEED = 7u;      // which fractal: another number, another structure
// The places that are set. They lie one above the other towards the top corner of the whole, so that
// pulling back always leaves what you were looking at above you:
//   the embeds' hexagon, a quarter of the whole's size, against the upper right side near the top corner;
//   the articles' hexagon, a sixteenth, in the top corner itself;
//   the portrait's hexagon, a sixty-fourth, beside the articles and a little in from the upper right side.
const float RE = 0.25, RA = 0.0625, RP = 0.015625;
const int KE = 2, KA = 4, KP = 6;
const ivec2 ER = ivec2(2, 1), AR = ivec2(15, 0), PR = ivec2(57, 5);
const vec2 EC = vec2(0.25 * H3, 0.625), AC = vec2(0.0, 0.9375), PC = vec2(0.078125 * H3, 0.9296875);

uint h32(uint x) { x ^= x >> 16; x *= 0x45d9f3bu; x ^= x >> 16; x *= 0x45d9f3bu; x ^= x >> 16; return x; }
float r01(uint h) { return float(h >> 8) * (1.0 / 16777216.0); }

float calmAt(vec2 p, vec4 b) {
  vec2 d = max(b.xy - p, vec2(0.0)) + max(p - b.zw, vec2(0.0));
  return 1.0 - smoothstep(0.0, 110.0, length(d));
}

uint hsh(ivec2 v, int k, int salt) {
  ivec2 w = v + ivec2(1048576);
  return h32(uint(w.x) * 0x9e3779b9u ^ h32(uint(w.y) * 0x85ebca6bu ^ h32(uint(k * 8 + salt) + SEED)));
}

// 1 on the outline of a hexagon of radius 1 that stands on a corner.
float hexN(vec2 d) { float ax = abs(d.x); return max(ax / H3, ax * 0.57735027 + abs(d.y)); }
// Content forms and dissolves piece by piece: each piece has its own moment within the whole.
float pieceShow(float show, uint h) { return clamp((show - 0.7 * r01(h32(h + 41u))) / 0.3, 0.0, 1.0); }
// The six grid directions around a point, numbered clockwise from straight up.
int dirIdx(ivec2 d) { return d.x == 1 ? (d.y == 0 ? 0 : 5) : d.x == 0 ? (d.y == 1 ? 1 : 4) : (d.y == 1 ? 2 : 3); }

// Within the embeds' hexagon: how far a point is from the lines between the faces (x) and from the
// hexagon's rim (y), in world units.
vec3 faceDist(vec2 q) {
  vec2 p = q - EC;
  float d0 = p.y, d1 = dot(p, vec2(H3, -0.5)), d2 = dot(p, vec2(-H3, -0.5));
  vec2 tip = d0 > d1 ? (d0 > d2 ? vec2(0.0, 1.0) : vec2(-H3, -0.5)) : (d1 > d2 ? vec2(H3, -0.5) : vec2(-H3, -0.5));
  vec2 sa = vec2(tip.x * 0.5 - tip.y * H3, tip.x * H3 + tip.y * 0.5), sb = vec2(tip.x * 0.5 + tip.y * H3, -tip.x * H3 + tip.y * 0.5);
  vec2 na = vec2(tip.x * H3 - tip.y * 0.5, tip.x * 0.5 + tip.y * H3), nb = vec2(tip.x * H3 + tip.y * 0.5, -tip.x * 0.5 + tip.y * H3);
  return vec3(min(abs(p.x * sa.y - p.y * sa.x), abs(p.x * sb.y - p.y * sb.x)), RE * H3 - max(dot(p, na), dot(p, nb)), 0.0);
}

// The kinds of piece. All lie on one triangular grid that halves at each level, so they always fit.
//   hexagon   -> a smaller hexagon in the middle and six trapezoids, or three hexagons and three rhombi
//   rhombus   -> a hexagon and a triangle at each end, or two triangles
//   trapezoid -> a rhombus and a triangle, or three triangles
//   triangle  -> four triangles, or a rhombus and two triangles, or a trapezoid and a triangle
const int TRI = 0, RHO = 1, TRAP = 2, HEX = 3;

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 c = frag - 0.5 * uRes;
  float t = uTime, life = uLife, sc = uScale;
  vec2 P = uCam + vec2(c.x, -c.y) * sc;
  // The whole structure is one hexagon of radius 1, standing on a corner.
  if (hexN(P) > 1.0) { o = vec4(BG, 1.0); return; }
  vec2 L = vec2(P.y - P.x * 0.57735027, P.x * 1.15470054);

  vec3 col = vec3(0.0), leaf = BG;
  float cAcc = 0.0, leafC = 0.0;
  float wgt = 1.0, tone = 0.0, goneP = 0.0, walls = 1.0, winD = -1.0;
  int acc = 0, mode = HEX, k = 0, pnc = 0, place = 0, cell = -1;
  ivec2 ref = ivec2(0);      // hexagon: its centre. rhombus: the corner of this triangle that is not on the shared edge.
  vec3 PB = vec3(0.0);       // trapezoid: where the pixel is in the triangle it was cut from
  ivec2 PV[3]; PV[0] = ivec2(0); PV[1] = ivec2(0); PV[2] = ivec2(0);
  uint ph = 0u;

  // Three hexagons are set, not left to chance: the articles' (place 1), the embeds' (place 2) and the
  // portrait's (place 3). The walk starts in them directly.
  if (hexN(P - AC) < RA) { place = 1; k = KA; ref = AR; }
  else if (hexN(P - EC) < RE) { place = 2; k = KE; ref = ER; }
  else if (hexN(P - PC) < RP) { place = 3; k = KP; ref = PR; }
  float showP = uShow.x, showA = uShow.y, showE = uShow.z, lodMul = exp2(uLod);

  for (int it = 0; it < 48; it++) {
    // The grid triangle the pixel is in at this level: its corners V and the pixel's place b between them.
    float e = exp2(float(k)), s = 1.0 / e, S = s / sc;
    vec2 q = L * e, cf = floor(q), f = q - cf;
    bool up = f.x + f.y < 1.0;
    ivec2 ci = ivec2(cf);
    ivec2 V[3]; vec3 b;
    if (up) { V[0] = ci; V[1] = ci + ivec2(1, 0); V[2] = ci + ivec2(0, 1); b = vec3(1.0 - f.x - f.y, f.x, f.y); }
    else { V[0] = ci + ivec2(1, 1); V[1] = ci + ivec2(0, 1); V[2] = ci + ivec2(1, 0); b = vec3(f.x + f.y - 1.0, 1.0 - f.x, 1.0 - f.y); }

    // The piece: its identity h, its size on screen, the distance dE to its outline, its centre cl.
    uint h; float size, dE, shade; vec2 cl; int n0 = 0;
    if (mode == HEX || mode == RHO) {
      if (V[0] == ref) n0 = 0; else if (V[1] == ref) n0 = 1; else if (V[2] == ref) n0 = 2; else { leaf = BG; leafC = winD >= 0.0 ? smoothstep(0.5, 0.9, showE) * (1.0 - 0.8 * uVeil) : 0.0; break; }
    }
    int n1 = n0 == 2 ? 0 : n0 + 1, n2 = n0 == 0 ? 2 : n0 - 1;
    bool setA = mode == HEX && place == 1 && k == KA, setE = mode == HEX && place == 2 && k == KE;
    if (mode == HEX) {
      h = hsh(ref, k, 3); size = 1.7 * S; dE = b[n0]; cl = vec2(ref) * s; shade = 0.05;
    } else if (mode == RHO) {
      ivec2 m2 = V[n1] + V[n2];
      h = hsh(m2, k, 1); size = 1.3 * S; dE = min(b[n1], b[n2]); cl = vec2(m2) * s * 0.5; shade = 0.0;
    } else if (mode == TRAP) {
      int a1 = pnc == 2 ? 0 : pnc + 1, a2 = pnc == 0 ? 2 : pnc - 1;
      h = ph; size = 1.6 * S;
      dE = 2.0 * min(min(PB[a1], PB[a2]), min(PB[pnc], 0.5 - PB[pnc]));
      cl = (vec2(PV[pnc]) / 6.0 + (vec2(PV[a1]) + vec2(PV[a2])) * (5.0 / 12.0)) * s * 2.0; shade = -0.03;
    } else {
      h = hsh(ci, k, up ? 4 : 5); size = S; dE = min(b.x, min(b.y, b.z));
      cl = (cf + (up ? vec2(1.0 / 3.0) : vec2(2.0 / 3.0))) * s; shade = up ? 0.06 : -0.10;
    }
    float r2 = r01(h32(h + 1u)), r3 = r01(h32(h + 2u)), r4 = r01(h32(h + 3u)), r6 = r01(h32(h + 5u));
    float ra = r01(h32(h + 11u)), rb = r01(h32(h + 12u));
    vec2 cw = vec2(cl.y * H3, cl.x + cl.y * 0.5);

    // The portrait has its own hexagon. In it the fractal goes on as everywhere, with its own colours and
    // gaps; the photo only decides how light each piece is, averaged over the piece. The pieces are as
    // large as outside at the hexagon's rim and get smaller towards the middle of the face.
    float person = 0.0, light = 0.0, inP = place == 3 ? showP : 0.0, dn = 1.0;
    if (inP > 0.001) {
      vec2 pu = (cw - uPort.xy) / (2.0 * uPort.z) + 0.5;
      float ext = 0.5 * size * sc / (2.0 * uPort.z);
      dn = length(cw - uFace) / RP;
      if (all(greaterThan(pu, vec2(-ext))) && all(lessThan(pu, vec2(1.0 + ext)))) {
        vec4 tx = textureLod(uPhoto, clamp(pu, 0.0, 1.0), max(log2(max(2.0 * ext * 1024.0, 1.0)) - 0.6, 0.0));
        light = pow(clamp(tx.r / max(tx.a, 0.004), 0.0, 1.0), 0.9);
        person = tx.a * pieceShow(showP, h);
      }
    }
    // An article's hexagon: its pieces draw the scene.
    float form = 0.0, focus = 0.0, inCell = cell >= 0 ? showA : 0.0, rimC = 0.0;
    if (inCell > 0.001) {
      vec2 dir = cell == 0 ? vec2(0.0, 1.0) : cell == 1 ? vec2(H3, -0.5) : vec2(-H3, -0.5);
      vec2 lc = (cw - AC - 0.5 * RA * dir) / (0.5 * RA);
      vec4 tx = textureLod(uScenes, vec2((lc.x * 0.5 + 0.5 + float(cell)) / 3.0, lc.y * 0.5 + 0.5), 0.0);
      form = tx.r * pieceShow(showA, h); focus = tx.g;
      // Each article's hexagon is outlined by a band of lighter pieces along its edge: it is a link.
      rimC = smoothstep(0.86, 0.93, hexN(lc)) * inCell;
    }

    // Some pieces are left out: the holes. Never at the rim, so the whole keeps its outline, and never
    // in the portrait or a scene.
    float rim = hexN(cw) + 1.25 * s;
    bool gone = k >= 2 && rim < 0.97 && !setA && !setE && (person < 0.15 || dn > 0.5) && r01(h32(h + 9u)) < goneP * (1.0 - inCell);
    tone = tone * 0.72 + (r2 - 0.5) * 0.26;
    // Every piece keeps a seam around it, wider the larger it is on screen, and its parts inherit that
    // seam: so a hexagon stays readable as one hexagon however finely it is divided.
    float seam = size < 12.0 ? size * 0.035 : size < 20.0 ? 0.5 : min(0.8 + size / 260.0, 3.2);
    float own = clamp((dE * S * H3 - seam) * uDpr + 0.5, 0.0, 1.0);
    walls = min(walls, own);
    if (r3 < 0.006) acc = 3; else acc--;

    vec2 cs = vec2(cw.x - uCam.x, -(cw.y - uCam.y)) / sc + 0.5 * uRes;

    // Life: rings of light travel outward through the pieces, hexagonal like the structure and spaced
    // evenly in scale, so they look the same at every depth. Each level runs a little behind the one above.
    vec2 dc = cs - uCentre;
    float wave = 5.6 * log2(max(hexN(dc), 6.0) / 64.0) - t * 0.6 + float(k) * 0.9;
    // A ring arrives quickly and fades slowly behind its front.
    float u = fract(-wave * 0.15915494), ring = smoothstep(0.0, 0.1, u) * exp(-3.6 * u) * life;

    // How far to go on into the piece's parts: fully while they are large on screen, not at all once they
    // would be too small. A piece may also choose to stay whole for longer. As a ring passes, pieces near
    // the limit open into their parts and close again behind it.
    float mult = r4 < 0.5 ? 1.0 : r4 < 0.76 ? 2.0 : r4 < 0.91 ? 4.0 : r4 < 0.98 ? 8.0 : 12.0;
    if (gone) mult = 6.0;
    float tau = uGrain * mix(mult, 1.0, inCell) * exp2(0.45 * life * (1.0 - inCell) * (1.0 - 0.85 * uMove) * sin(0.5 * wave - 0.7));
    tau = mix(tau, 4.6, inCell);  // a scene needs small pieces to draw its forms
    // In the portrait's hexagon the pieces are smallest over the whole face, from hairline to chin, and
    // grow from there outwards, so that the hair, the neck and the shoulders are made of large shapes.
    if (inP > 0.0) tau = mix(tau, uFine * pow(max(tau, 22.0) / uFine, smoothstep(0.42, 1.0, dn)), inP);
    // While the camera pulls back the detail runs behind it: the pieces keep their place and get smaller
    // on screen, and only merge once it has arrived. Diving in, they grow first and divide after.
    tau = max(tau / lodMul, 2.2);
    float go = smoothstep(tau, tau * 1.35, size * 0.5);
    if (k < 1 || setA || setE) go = 1.0;

    if (go < 0.999) {
      // What the piece looks like if it stays whole: one colour inside its seams.
      float calm = max(calmAt(cs, uCalm0) * uCalmK.x, calmAt(cs, uCalm1) * uCalmK.y);
      // Light falls across each piece, so it is not one flat colour: lighter and a touch pinker to one side.
      float lit = clamp(dot((frag - cs) / max(size, 4.0), vec2(0.5, -0.866)), -0.7, 0.7);
      float glow = (ring - 0.2 * life) * (1.0 - 0.6 * person) * (1.0 - 0.7 * inCell);
      float ff = -0.42 + tone * 0.5 + shade + 0.34 * glow + 0.12 * lit - 0.14 * calm;
      // While the scenes are there, what lies around them steps back a little.
      float a = min(1.0, (0.62 + 0.3 * r6) * (1.0 + 0.3 * ring)) * (1.0 - 0.6 * calm) * (1.0 - 0.4 * (showA - inCell));
      float n = 0.5 + 0.25 * sin(cs.x * 0.0031 + cs.y * 0.0017 + t * 0.2 * life)
                    + 0.25 * sin(cs.y * 0.0043 - cs.x * 0.0013 - t * 0.15 * life + 2.0);
      float hue = clamp(smoothstep(0.42, 0.95, n) * 0.6 + 0.32 * glow + 0.1 * lit, 0.0, 0.85);
      // At the face itself the fractal's own colour and tone step back, so the features read; further
      // out they come back in full.
      float core = person * (1.0 - smoothstep(0.42, 0.85, dn));
      hue *= 1.0 - 0.65 * core;
      if (person > 0.0) {
        // Only the lightness comes from the photo; hue, accents and the rings of light stay the fractal's.
        // Six flat tones, each piece falling to one side or the other of a step in its own way.
        float lq = clamp(floor(light * 6.0 + 0.5 + (r6 - 0.5) * 0.35) / 6.0, 0.0, 1.0);
        ff = mix(ff, -0.76 + lq * 0.8 + tone * 0.24 * (1.0 - core) + 0.04 * lit * (1.0 - core) + 0.1 * glow, person);
        a = mix(a, 0.7 + 0.28 * lq, person);
      }
      if (inCell > 0.0) {
        // The scene's forms are light, the rest of the hexagon steps back; the form in focus is pink.
        ff = mix(ff - 0.1 * inCell, 0.1 + tone * 0.5 + 0.08 * lit, form);
        a = mix(a * (1.0 - 0.42 * inCell), 0.95, form);
        hue = mix(hue * (1.0 - 0.7 * inCell), focus > 0.5 ? 0.92 : 0.0, form);
        // Under the pointer the hexagon lifts and its rim turns near white.
        float hov = abs(uHover - float(cell)) < 0.5 ? 1.0 : 0.0;
        if (hov > 0.0) { ff += 0.14; a = min(1.0, a * 1.35); }
        ff += (0.34 + 0.5 * hov) * rimC; a = mix(a, 0.92 + 0.08 * hov, rimC); hue *= 1.0 - 0.6 * rimC;
      }
      vec3 base = mix(BLUE, PINK, hue);
      if (acc > 0 && (person < 0.3 || dn > 0.6) && inCell < 0.3) { base = PINK; ff += 0.12; }
      vec3 pc = ff > 0.0 ? base + (vec3(1.0) - base) * ff : base * (1.0 + ff);
      // Over an embed the pieces clear away, each at its own moment: those in the middle of a face first,
      // those along its edges last, until the whole face is open.
      float clear = 0.0;
      if (winD >= 0.0 && showE > 0.001) {
        vec3 fd = faceDist(cw);
        float edge = 1.0 - smoothstep(6.0, 76.0, min(fd.x, fd.y) / sc);
        clear = clamp((showE * 1.3 - 0.25 - 0.2 * r01(h32(h + 31u)) - 0.75 * edge) / 0.07, 0.0, 1.0);
        // Seen from afar the pieces come back over the embeds, each at its own moment, most of the way:
        // the embeds stay as a faint shape in the structure.
        clear *= 1.0 - 0.8 * smoothstep(0.0, 0.3, uVeil - 0.7 * r01(h32(h + 33u)));
      }
      // The seams are a shadow of the piece's own colour, not a cut. In the portrait only a piece's own
      // seam shows, so no larger outline runs across the face.
      leaf = mix(BG, pc, gone ? 0.0 : a * mix(mix(0.3, 0.55, person), 1.0, walls));
      leafC = clear;
      col += wgt * (1.0 - go) * leaf;
      cAcc += wgt * (1.0 - go) * leafC;
      wgt *= go;
      if (wgt < 0.003) break;
    }

    // Which parts the piece has, and which of them the pixel is in.
    if (mode == HEX) {
      int i1 = dirIdx(V[n1] - ref);
      bool odd1 = i1 - 2 * (i1 / 2) == 1;
      if (setE) {
        // The embeds' hexagon: three faces like those of a cube, each a rhombus from the centre out to
        // every other corner. Over a face the pieces clear away towards its middle.
        int tip = odd1 ? n2 : n1, side = odd1 ? n1 : n2;
        winD = min(b[n0], b[tip]) * S * H3;
        mode = RHO; ref = V[side]; goneP = 0.0;
      } else if (!setA && ra < 0.45) {
        if (b[n0] > 0.5) { ref = ref * 2; goneP = 0.0; }
        else { mode = TRAP; PB = b; PV[0] = V[0]; PV[1] = V[1]; PV[2] = V[2]; pnc = n0; ph = h32(hsh(ci, k, up ? 4 : 5) + 77u + uint(n0)); goneP = 0.12; }
        k++;
      } else {
        // Three hexagons at every other corner; a rhombus at each corner between them. In the articles'
        // hexagon these three are the articles: top, lower right, lower left.
        int hv = setA ? (odd1 ? n2 : n1) : (odd1 == (rb < 0.5)) ? n1 : n2, rv = hv == n1 ? n2 : n1;
        if (b[rv] > 0.5) { mode = RHO; ref = V[rv] + V[hv]; goneP = setA ? 0.0 : 0.3; }
        else { if (setA) cell = dirIdx(V[hv] - ref) / 2; ref = ref + V[hv]; goneP = 0.05; }
        k++;
      }
    } else if (mode == RHO) {
      if (ra < 0.55) {
        if (b[n0] > 0.5) { mode = TRI; goneP = 0.4; }
        else { mode = HEX; ref = V[n1] + V[n2]; goneP = 0.0; }
        k++;
      } else { mode = TRI; goneP = 0.0; }
    } else if (mode == TRAP) {
      int a1 = pnc == 2 ? 0 : pnc + 1, a2 = pnc == 0 ? 2 : pnc - 1;
      int x = rb < 0.5 ? a1 : a2, y = rb < 0.5 ? a2 : a1;
      if (ra < 0.6) {
        if (PB[y] > 0.5) { mode = TRI; goneP = 0.1; }
        else { mode = RHO; ref = PB[x] > 0.5 ? PV[x] * 2 : PV[pnc] + PV[y]; goneP = 0.0; }
      } else { mode = TRI; goneP = all(lessThanEqual(PB, vec3(0.5))) ? 0.3 : 0.05; }
    } else {
      bool cen = all(lessThanEqual(b, vec3(0.5)));
      int i = int(h32(h + 13u) % 3u), i1 = i == 2 ? 0 : i + 1, i2 = i == 0 ? 2 : i - 1;
      if (ra < 0.5) { goneP = cen ? 0.55 : 0.07; }
      else if (ra < 0.8) {
        if (b[i] > 0.5) { mode = RHO; ref = V[i] * 2; goneP = 0.0; }
        else if (cen) { mode = RHO; ref = V[i1] + V[i2]; goneP = 0.0; }
        else goneP = 0.07;
      } else {
        if (b[i] > 0.5) goneP = 0.07;
        else { mode = TRAP; PB = b; PV[0] = V[0]; PV[1] = V[1]; PV[2] = V[2]; pnc = i; ph = h32(h + 77u + uint(i)); goneP = 0.1; }
      }
      k++;
    }
  }
  col += wgt * leaf; cAcc += wgt * leafC;
  // Where pieces have cleared away, the canvas is clear and what lies under it shows. A face opens up to
  // a seam along its edges, the same seam every large piece has.
  float open = 0.0;
  if (cAcc > 0.0) {
    vec3 fd = faceDist(P);
    open = cAcc * clamp((min(fd.x, fd.y) / sc - 1.7) * uDpr + 0.5, 0.0, 1.0);
  }
  vec3 seamCol = mix(BG, BLUE, 0.16);
  o = vec4(col * (1.0 - cAcc) + seamCol * (cAcc - open), 1.0 - open);
}
