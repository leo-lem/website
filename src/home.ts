(function () {
  var NAMES = ['Hey!', "I'm Leo", 'My Writing', 'Off the clock', "Let's talk"], H3 = 0.8660254, LAST = NAMES.length - 1;
  var stage = document.getElementById('stage')!, cv = document.getElementById('gl') as HTMLCanvasElement;
  var secs = [0, 1, 2, 3, 4].map(function (i) { return document.querySelector<HTMLElement>('.s' + i)!; });
  var cue = document.getElementById('cue')!, rail = document.getElementById('rail')!, embeds = document.getElementById('embeds')!, cells = document.getElementById('cells')!;
  var gl = cv.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' })!;
  if (!gl) {
    document.documentElement.classList.remove('gl');
    ['wheel', 'touchmove', 'keydown'].forEach(function (t) { stage.addEventListener(t, function (e) { e.stopImmediatePropagation(); }, { capture: true }); });
  }
  var reduce = (window.matchMedia as typeof matchMedia | undefined) && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var buttons = NAMES.map(function (n, i) {
    var b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', n);
    b.innerHTML = '<span></span><i></i>'; b.firstChild!.textContent = n;
    b.addEventListener('click', function () { jump(i); });
    rail.appendChild(b); return b;
  });
  document.getElementById('toTalk')!.addEventListener('click', function (e) { e.preventDefault(); jump(LAST); });
  document.getElementById('home')!.addEventListener('click', function (e) { e.preventDefault(); jump(0); });
  var hover = -1, titles: HTMLElement[] = [].slice.call(document.querySelectorAll('.s2 .list a')), hits: HTMLElement[] = [].slice.call(cells.children);
  function setHover(i: number) { hover = i; titles.forEach(function (a, k) { a.className = k === i ? 'hi' : ''; }); }
  titles.concat(hits).forEach(function (a) {
    var i = +a.getAttribute('data-i')!;
    a.addEventListener('mouseenter', function () { setHover(i); }); a.addEventListener('focus', function () { setHover(i); });
    a.addEventListener('mouseleave', function () { setHover(-1); }); a.addEventListener('blur', function () { setHover(-1); });
  });
  [].forEach.call(embeds.children, function (a: Element) { if (a.getAttribute('href') === '#') a.addEventListener('click', function (e) { e.preventDefault(); }); });
  function calOpen() { return !!(window.__calOpen && window.__calOpen()); }

  var TUNE = { leoX: 0.26, writeX: 0.62, zoom4: 0.38, final: 0.5, fine: 1.8, glow: 0.46 };

  function layout(): Layout {
    var W = stage.clientWidth, H = stage.clientHeight, small = W <= 720, key = W + 'x' + H + JSON.stringify(TUNE);
    if ((layout as Memo<Layout>).key === key) return (layout as Memo<Layout>).v!;
    var rEw = 1 / 4, rA = 1 / 16, rPw = 1 / 64, O = { x: 0, y: 0 }, T = { x: 0, y: 1 };
    var E = { x: 0.25 * H3, y: 0.625 }, A = { x: 0, y: 0.9375 }, P = { x: 0.078125 * H3, y: 0.9296875 };
    var rE = small ? Math.min((W - 24) / (2 * H3), H * 0.3) : Math.min(H * TUNE.zoom4, W * 0.25);
    var rS = small ? Math.min((W - 78) / (2 * H3), H * 0.24) : Math.min(H * 0.34, W * 0.2);
    var rP = small ? Math.min(H * 0.36, W * 0.8) : Math.min(H * 0.46, W * 0.27);
    var R = small ? Math.min((W - 48) / (2 * H3), H * 0.2) : Math.min(H * TUNE.final, W * 0.27);
    var s4 = 1 / R, s3 = rEw / rE, s2 = rA / rS, s1 = rPw / rP, s0 = s1 / 6;
    var hp = 0.98 * rPw, face = { x: P.x - 0.02 * hp, y: P.y + 0.2 * hp };
    function cam(f: Pt, sx: number, sy: number, s: number): Cam { return { x: f.x - (sx - W / 2) * s, y: f.y + (sy - H / 2) * s, s: s }; }
    var views = [
      cam(face, small ? W * 0.5 : W * 0.6, small ? H * 0.62 : H * 0.5, s0),
      cam(P, small ? W * 0.5 : W * TUNE.leoX, small ? H * 0.33 : H * 0.5, s1),
      cam(A, small ? 14 + H3 * rS : W * TUNE.writeX, small ? 64 + rS : 28 + rS, s2),
      small ? cam(E, W / 2, 92 + rE, s3) : cam(T, W - 40 - H3 / s3, 34, s3),
      cam(O, small ? W / 2 : W * 0.66, small ? 84 + R : H * 0.5, s4)];
    var fixed = [];
    for (var i = 0; i < 4; i++) {
      var a = views[i], b = views[i + 1], r = b.s / a.s, f = { x: (b.x - a.x * r) / (1 - r), y: (b.y - a.y * r) / (1 - r) };
      fixed.push({ x: W / 2 + (f.x - a.x) / a.s, y: H / 2 - (f.y - a.y) / a.s });
    }
    (layout as Memo<Layout>).key = key;
    return (layout as Memo<Layout>).v = { W: W, H: H, small: small, views: views, fixed: fixed, A: A, E: E, P: P, hp: hp, face: face, rE: rE, rS: rS };
  }
  function toScreen(Lo: Layout, cam: Cam, p: Pt): Pt { return { x: Lo.W / 2 + (p.x - cam.x) / cam.s, y: Lo.H / 2 - (p.y - cam.y) / cam.s }; }
  function camAt(a: Cam, b: Cam, t: number): Cam {
    var s = a.s * Math.pow(b.s / a.s, t), r = b.s / a.s;
    if (Math.abs(1 - r) < 1e-9) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: s };
    var fx = (b.x - a.x * r) / (1 - r), fy = (b.y - a.y * r) / (1 - r), k = s / a.s;
    return { x: fx + (a.x - fx) * k, y: fy + (a.y - fy) * k, s: s };
  }
  function smooth(a: number, b: number, x: number) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function shown(p: number, i: number, from: number, to: number) { return p <= i ? smooth(i - 1 + from, i - 1 + to, p) : 1; }

  var HASH = ['', 'leo', 'writing', 'off-the-clock', 'talk'], start0 = Math.max(0, HASH.indexOf(location.hash.slice(1))), inAddress = start0;
  function remember(i: number) { if (i === inAddress) return; inAddress = i; history.replaceState(null, '', i ? '#' + HASH[i] : location.pathname + location.search); }
  window.addEventListener('hashchange', function () { var i = HASH.indexOf(location.hash.slice(1)); if (i >= 0) { inAddress = i; jump(i); } });
  var pos = start0, vel = 0, target = start0, preview = 0, accum = 0, locked = false, lastIn = 0, endT: ReturnType<typeof setTimeout> | number = 0, touchY: number | null = null, lastMag = 0, lockAt = 0, lockDir = 0;
  function input(d: number) {
    if (calOpen()) return;
    var now = performance.now(), H = stage.clientHeight;
    if (now - lastIn > 200 && touchY == null) { accum = 0; locked = false; }
    lastIn = now;
    clearTimeout(endT); endT = setTimeout(function () { if (touchY == null) endGesture(); }, 200);
    var mag = Math.abs(d), fresh = locked && touchY == null && now - lockAt > 220 && ((d > 0) !== (lockDir > 0) ? mag > 4 : mag > lastMag * 1.6 + 6);
    lastMag = mag;
    if (fresh) { accum = 0; locked = false; }
    if (locked) return;
    accum += d;
    var th = Math.min(36, H * 0.05);
    if (Math.abs(accum) >= th) { locked = true; lockAt = now; lockDir = accum; preview = 0; target = Math.max(0, Math.min(LAST, target + (accum > 0 ? 1 : -1))); }
    else { preview = accum / th * 0.16; if ((target === 0 && preview < 0) || (target === LAST && preview > 0)) preview *= 0.25; }
  }
  function endGesture() { accum = 0; locked = false; preview = 0; }
  function jump(i: number) { target = Math.max(0, Math.min(LAST, i)); preview = 0; accum = 0; }
  stage.addEventListener('wheel', function (e) {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault(); input(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1));
  }, { passive: false });
  var touchX: number | null = null, touchWay: 'side' | 'up' | null = null;
  stage.addEventListener('touchstart', function (e) { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; touchWay = null; accum = 0; locked = false; }, { passive: true });
  stage.addEventListener('touchmove', function (e) {
    if (touchY == null) return;
    var x = e.touches[0].clientX, y = e.touches[0].clientY;
    if (!touchWay) {
      var dx = Math.abs(x - touchX!), dy = Math.abs(y - touchY);
      if (Math.max(dx, dy) < 6) return;
      touchWay = dx > dy ? 'side' : 'up';
    }
    if (touchWay === 'side') return;
    e.preventDefault(); input((touchY - y) * 1.5); touchY = y;
  }, { passive: false });
  stage.addEventListener('touchend', function () { touchY = null; touchWay = null; endGesture(); }, { passive: true });
  stage.addEventListener('keydown', function (e) {
    if (calOpen()) return;
    if (/INPUT|TEXTAREA/.test((e.target as Element).tagName)) return;
    var k = e.key, d = k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey) ? 1 : k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey) ? -1 : 0;
    if (k === 'Home') { e.preventDefault(); jump(0); } else if (k === 'End') { e.preventDefault(); jump(LAST); } else if (d) { e.preventDefault(); jump(target + d); }
  });
  stage.addEventListener('focusin', function (e) {
    var k = embeds.contains(e.target as Node) ? 3 : secs.findIndex(function (s) { return s.contains(e.target as Node); });
    if (k >= 0 && k !== target) jump(k);
  });
  stage.focus({ preventScroll: true });

  function boxOf(el: HTMLElement, pad: number) {
    var x = 0, y = 0, e: HTMLElement | null = el;
    while (e && e !== stage) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent as HTMLElement | null; }
    return [x - pad, y - pad, x + el.offsetWidth + pad, y + el.offsetHeight + pad];
  }
  function layoutText(p: number, Lo: Layout, cam: Cam, i: number) {
    var cur = Math.round(p);
    for (var k = 0; k < secs.length; k++) {
      var off = k - p, vis = Math.abs(off) < 0.6, op = vis ? Math.max(0, 1 - Math.abs(off) * 2.2) : 0;
      secs[k].style.opacity = op as unknown as string; secs[k].style.visibility = 'visible';
      if (vis && Lo && (k === i || k === i + 1)) {
        var z = Math.pow(Lo.views[k].s / cam.s, 0.4), X = Lo.fixed[i], b = boxOf(secs[k], 0);
        secs[k].style.transformOrigin = '0 0';
        secs[k].style.transform = 'translate(' + ((X.x - b[0]) * (1 - z)).toFixed(2) + 'px,' + ((X.y - b[1]) * (1 - z)).toFixed(2) + 'px) scale(' + z.toFixed(4) + ')';
      } else secs[k].style.transform = '';
      secs[k].style.pointerEvents = op > 0.9 ? 'auto' : 'none';
      buttons[k].className = k === cur ? 'on' : ''; if (k === cur) buttons[k].setAttribute('aria-current', 'step'); else buttons[k].removeAttribute('aria-current');
    }
    stage.classList.toggle('at-end', cur === LAST);
    stage.classList.toggle('from-writing', cur >= 2);
    cue.style.opacity = (p < 0.05 ? 1 : 0) as unknown as string;
    var nm = document.getElementById('home')!, no = Math.max(0, Math.min(1, (p - 0.35) / 0.4));
    nm.style.opacity = no as unknown as string; nm.style.pointerEvents = no > 0.9 ? 'auto' : 'none';
  }

  var laid: string | undefined = '';
  function layoutLayers(Lo: Layout) {
    if (laid === (layout as Memo<Layout>).key) return;
    laid = (layout as Memo<Layout>).key;
    var E = toScreen(Lo, Lo.views[3], Lo.E), r = Lo.rE, v: number[][] = [], k: number;
    for (k = 0; k < 6; k++) { var an = Math.PI / 3 * k - Math.PI / 2; v.push([E.x + r * Math.cos(an), E.y + r * Math.sin(an)]); }
    var C = [E.x, E.y], faces = [[C, v[5], v[0], v[1]], [C, v[3], v[4], v[5]], [C, v[1], v[2], v[3]]];
    faces.forEach(function (f, e) {
      var xs = f.map(function (q) { return q[0]; }), ys = f.map(function (q) { return q[1]; });
      var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys), w = Math.max.apply(null, xs) - x0, h = Math.max.apply(null, ys) - y0;
      var mx = (xs[0] + xs[1] + xs[2] + xs[3]) / 4, my = (ys[0] + ys[1] + ys[2] + ys[3]) / 4, el = embeds.children[e] as HTMLElement, cd = el.querySelector<HTMLElement>('.card')!;
      el.style.left = x0 + 'px'; el.style.top = y0 + 'px'; el.style.width = w + 'px'; el.style.height = h + 'px';
      el.style.clipPath = 'polygon(' + f.map(function (q) { return (q[0] - x0).toFixed(1) + 'px ' + (q[1] - y0).toFixed(1) + 'px'; }).join(',') + ')';
      var sc = r / 300;
      cd.style.width = cd.style.height = (600 * sc) + 'px';
      cd.style.left = (E.x - 300 * sc - x0) + 'px'; cd.style.top = (E.y - 300 * sc - y0) + 'px';
    });
    var A = toScreen(Lo, Lo.views[2], Lo.A), rc = Lo.rS / 2, dirs = [[0, -1], [H3, 0.5], [-H3, 0.5]];
    dirs.forEach(function (d, i) {
      var el = cells.children[i] as HTMLElement | undefined, cx = A.x + rc * d[0], cy = A.y + rc * d[1], pts = [];
      if (!el) return;
      for (k = 0; k < 6; k++) { var an = Math.PI / 3 * k - Math.PI / 2; pts.push((H3 * rc + rc * Math.cos(an)).toFixed(1) + 'px ' + (rc + rc * Math.sin(an)).toFixed(1) + 'px'); }
      el.style.left = (cx - H3 * rc) + 'px'; el.style.top = (cy - rc) + 'px'; el.style.width = (2 * H3 * rc) + 'px'; el.style.height = (2 * rc) + 'px';
      el.style.clipPath = 'polygon(' + pts.join(',') + ')';
    });
  }
  function follow(layer: HTMLElement, Lo: Layout, cam: Cam, i: number, p: Pt) {
    var at = toScreen(Lo, Lo.views[i], p), now = toScreen(Lo, cam, p), k = Lo.views[i].s / cam.s;
    layer.style.transform = 'translate(' + (now.x - at.x * k).toFixed(2) + 'px,' + (now.y - at.y * k).toFixed(2) + 'px) scale(' + k.toFixed(5) + ')';
  }

  if (!gl) return;
  function shader(type: number, src: string) {
    var s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)!);
    return s;
  }
  var VS = '#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}', HEAD = '#version 300 es\nprecision highp float;out vec4 o;';
  function program(fs: string, names: string[]) {
    var pr = gl.createProgram();
    gl.attachShader(pr, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, shader(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr)!);
    var u: Prog = { pr: pr }; names.forEach(function (n) { u[n] = gl.getUniformLocation(pr, n); });
    return u;
  }
  var U = program(document.getElementById('fs')!.textContent!, ['uRes', 'uDpr', 'uCam', 'uScale', 'uTime', 'uLife', 'uCalm0', 'uCalm1', 'uCalmK', 'uCentre', 'uShow', 'uLod', 'uMove', 'uGrain', 'uFine', 'uVeil', 'uPort', 'uFace', 'uHover', 'uPhoto', 'uScenes']);
  var DOWN = program(HEAD + 'uniform sampler2D s;uniform vec2 px;vec3 t(vec2 uv){return texture(s,uv).rgb;}void main(){vec2 uv=gl_FragCoord.xy*4.*px;vec3 c=(t(uv+vec2(-1.,-1.)*px)+t(uv+vec2(1.,-1.)*px)+t(uv+vec2(-1.,1.)*px)+t(uv+vec2(1.,1.)*px))*.25;o=vec4(c*c*2.4,1.);}', ['s', 'px']);
  var BLUR = 'vec3 blur(sampler2D s,vec2 uv,vec2 d){vec3 c=texture(s,uv).rgb*.227;c+=(texture(s,uv+d*1.3).rgb+texture(s,uv-d*1.3).rgb)*.194;c+=(texture(s,uv+d*3.0).rgb+texture(s,uv-d*3.0).rgb)*.121;c+=(texture(s,uv+d*4.7).rgb+texture(s,uv-d*4.7).rgb)*.054;c+=(texture(s,uv+d*6.4).rgb+texture(s,uv-d*6.4).rgb)*.016;return c;}';
  var BLURH = program(HEAD + 'uniform sampler2D s;uniform vec2 px;' + BLUR + 'void main(){o=vec4(blur(s,gl_FragCoord.xy*px,vec2(px.x,0.)),1.);}', ['s', 'px']);
  var TRAIL = program(HEAD + 'uniform sampler2D s;uniform sampler2D prev;uniform vec2 px;uniform float keep;' + BLUR + 'void main(){vec2 uv=gl_FragCoord.xy*px;o=vec4(max(blur(s,uv,vec2(0.,px.y)),texture(prev,uv).rgb*keep),1.);}', ['s', 'prev', 'px', 'keep']);
  var COMP = program(HEAD + 'uniform sampler2D s;uniform sampler2D g;uniform vec2 px;uniform float k;void main(){vec2 uv=gl_FragCoord.xy*px;vec4 c=texture(s,uv);float n=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);o=vec4(c.rgb+k*texture(g,uv).rgb*mix(.35,1.,c.a)+(n-.5)/255.*c.a,c.a);}', ['s', 'g', 'px', 'k']);
  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  function texture(w: number, h: number, data?: Uint8Array) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function surface(w: number, h: number): Surface {
    var t = texture(w, h), f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { t: t, f: f, w: w, h: h };
  }
  var T: Surfaces = null!;
  function surfaces(bw: number, bh: number) {
    if (T && T.bw === bw && T.bh === bh) return;
    if (T) [T.scene, T.lo, T.a, T.b, T.g0, T.g1].forEach(function (x) { gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); });
    var qw = Math.max(1, bw >> 2), qh = Math.max(1, bh >> 2);
    T = { bw: bw, bh: bh, scene: surface(bw, bh), lo: surface(Math.round(bw * 0.55), Math.round(bh * 0.55)), a: surface(qw, qh), b: surface(qw, qh), g0: surface(qw, qh), g1: surface(qw, qh) };
  }
  function pass(u: Prog, to: Surface | null, tex0?: Surface, tex1?: Surface) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.f : null); gl.viewport(0, 0, to ? to.w : T.bw, to ? to.h : T.bh);
    gl.useProgram(u.pr);
    if (tex0) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex0.t); }
    if (tex1) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex1.t); }
  }

  function upload(tex: WebGLTexture, cvs: HTMLCanvasElement) {
    var w = cvs.width, h = cvs.height, d = cvs.getContext('2d')!.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h * 4);
    for (var y = 0; y < h; y++) out.set(d.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
  }
  var photoTex = texture(1, 1, new Uint8Array([0, 0, 0, 0])), sceneTex = texture(1, 1, new Uint8Array([0, 0, 0, 255]));
  (function () {
    var N = 1024, photo = new Image(), matte = new Image(), left = 2;
    function done() {
      if (--left) return;
      function read(img: HTMLImageElement) {
        var c = document.createElement('canvas'); c.width = c.height = N;
        var x = c.getContext('2d')!, iw = img.naturalWidth, ih = img.naturalHeight, sw = iw * 0.95;
        x.drawImage(img, iw * 0.025, ih * 0.05, sw, sw, 0, 0, N, N);
        return x.getImageData(0, 0, N, N);
      }
      function smooth(a: number, b: number, v: number) { var t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }
      var p = read(photo), m = read(matte), a = new Float32Array(N * N), x: number, y: number, i: number;
      for (i = 0; i < N * N; i++) a[i] = m.data[i * 4] / 255;
      function blur(src: Float32Array, r: number) {
        var tmp = new Float32Array(N * N), out = new Float32Array(N * N), n = 2 * r + 1, s: number, q: number;
        for (y = 0; y < N; y++) { s = 0; for (q = -r; q <= r; q++) s += src[y * N + Math.max(0, Math.min(N - 1, q))];
          for (x = 0; x < N; x++) { tmp[y * N + x] = s / n; s += src[y * N + Math.min(N - 1, x + r + 1)] - src[y * N + Math.max(0, x - r)]; } }
        for (x = 0; x < N; x++) { s = 0; for (q = -r; q <= r; q++) s += tmp[Math.max(0, Math.min(N - 1, q)) * N + x];
          for (y = 0; y < N; y++) { out[y * N + x] = s / n; s += tmp[Math.min(N - 1, y + r + 1) * N + x] - tmp[Math.max(0, y - r) * N + x]; } }
        return out;
      }
      a = blur(blur(a, 12), 12);
      var out = new Uint8Array(N * N * 4);
      for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
        i = y * N + x;
        var w = smooth(0.5, 0.98, a[i]);
        var l = 0.299 * p.data[i * 4] + 0.587 * p.data[i * 4 + 1] + 0.114 * p.data[i * 4 + 2], o = ((N - 1 - y) * N + x) * 4;
        l = Math.max(0, Math.min(255, (l - 128) * 1.2 + 128));
        out[o] = out[o + 1] = out[o + 2] = l * w; out[o + 3] = w * 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, photoTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
      gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
    photo.onload = matte.onload = done; photo.src = PHOTO_SRC; matte.src = MATTE_SRC;
  })();
  (function () {
    var N = 512, c = document.createElement('canvas'); c.width = N * 3; c.height = N;
    var x = c.getContext('2d')!; x.fillStyle = '#000'; x.fillRect(0, 0, N * 3, N);
    SCENES.forEach(function (scene, i) {
      if (!scene) return;
      function fill(p: Poly, col: string) { x.fillStyle = col; x.beginPath(); p.forEach(function (q, k) { if (k) x.lineTo(i * N + q[0] * N, q[1] * N); else x.moveTo(i * N + q[0] * N, q[1] * N); }); x.closePath(); x.fill(); }
      x.save(); x.beginPath(); x.rect(i * N, 0, N, N); x.clip();
      scene.trails.forEach(function (p) { fill(p, 'rgb(140,0,0)'); });
      scene.forms.forEach(function (f) {
        if (f.cut) fill(f.cut, '#000');
        (f.dashes || [f.poly]).forEach(function (p) { fill(p, f.focus ? 'rgb(255,255,0)' : 'rgb(255,0,0)'); });
      });
      x.restore();
    });
    upload(sceneTex, c);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  })();

  var STILL = !!navigator.webdriver;
  var lastInput = performance.now(), rested = false;
  ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointermove', 'pointerdown', 'scroll', 'resize', 'focus'].forEach(function (e) {
    window.addEventListener(e, function () { lastInput = performance.now(); }, { passive: true });
  });
  var frozen: { pos: number, t: number, lag: number, move: number } | null = null, t0 = performance.now(), last = 0, lastDraw = 0;
  function frame(now: number) {
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60; last = now;
    var goal = target + preview, w = 5.6, h = dt / 4;
    for (var k = 0; k < 4; k++) { vel += (w * w * (goal - pos) - 2 * w * vel) * h; pos += vel * h; }
    if (Math.abs(goal - pos) < 0.0004 && Math.abs(vel) < 0.003) { pos = goal; vel = 0; }
    var moving = !frozen && (pos !== goal || vel !== 0);
    if (!frozen) remember(target);
    requestAnimationFrame(frame);
    var quiet = !moving && !frozen && (STILL || now - lastInput > 20000);
    if (quiet && rested) return;
    if (!quiet) rested = false;
    if (!moving && !frozen && !quiet && now - lastDraw < 100) return;
    var dd = lastDraw ? Math.min(0.05, (now - lastDraw) / 1000) : 1 / 60; lastDraw = now;
    draw(frozen ? frozen.pos : pos, frozen ? frozen.t : (now - t0) / 1000, frozen || reduce ? 0 : Math.exp(-dd / 0.42), dt, moving, !frozen && !quiet);
    if (quiet) rested = true;
  }
  var lodS: number | null = null, GRAIN = [7, 7, 7, 7, 7];
  function draw(p: number, time: number, keep: number, dt: number, moving: boolean, low?: boolean) {
    var Lo = layout(), W = Lo.W, H = Lo.H, dpr = Math.min(Lo.small ? 2.5 : 2, window.devicePixelRatio || 1, Math.sqrt(2.5e6 / (W * H)));
    var bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    surfaces(bw, bh);
    p = Math.max(0, Math.min(LAST, p));
    var i = Math.min(LAST - 1, Math.floor(p)), u = p - i, cam = camAt(Lo.views[i], Lo.views[i + 1], u);
    var showP = shown(p, 1, 0.1, 0.6), showA = shown(p, 2, 0.25, 0.75), showE = shown(p, 3, 0.45, 0.95);
    var ls = Math.log2(cam.s), lag = 0, move = 0;
    if (frozen) { lag = frozen.lag; move = frozen.move; lodS = ls; }
    else if (!reduce) {
      if (lodS == null) lodS = ls;
      lodS += (ls - lodS) * (1 - Math.exp(-dt / 0.45));
      lag = Math.max(-1, Math.min(1, ls - lodS)); lodS = ls - lag;
      move = smooth(0.05, 0.7, Math.abs(vel));
    }
    layoutText(p, Lo, cam, i); layoutLayers(Lo);
    follow(embeds, Lo, cam, 3, Lo.E); follow(cells, Lo, cam, 2, Lo.A);
    embeds.style.visibility = 'visible'; embeds.style.opacity = showE > 0.001 ? '' : '0'; embeds.style.pointerEvents = Math.abs(p - 3) < 0.03 ? 'auto' : 'none';
    hits.forEach(function (a) { a.style.pointerEvents = Math.abs(p - 2) < 0.03 ? 'auto' : 'none'; });
    var foci = [{ x: Lo.small ? W * 0.5 : W * 0.62, y: Lo.small ? H * 0.62 : H * 0.5 }, toScreen(Lo, Lo.views[1], Lo.face), toScreen(Lo, Lo.views[2], Lo.A), toScreen(Lo, Lo.views[3], Lo.E), toScreen(Lo, Lo.views[4], { x: 0, y: 0 })];
    var b0 = boxOf(secs[i], 26), b1 = boxOf(secs[i + 1], 26);
    var sceneT = moving || (low && !Lo.small) ? T.lo : T.scene;
    pass(U, sceneT);
    gl.uniform2f(U.uRes, W, H); gl.uniform1f(U.uDpr, dpr * sceneT.w / bw);
    gl.uniform2f(U.uCam, cam.x, cam.y); gl.uniform1f(U.uScale, cam.s);
    gl.uniform1f(U.uTime, reduce ? 40 : time); gl.uniform1f(U.uLife, reduce ? 0 : 1);
    gl.uniform4f(U.uCalm0, b0[0], b0[1], b0[2], b0[3]); gl.uniform4f(U.uCalm1, b1[0], b1[1], b1[2], b1[3]);
    gl.uniform2f(U.uCalmK, Math.max(0, 1 - u * 2.2), Math.max(0, 1 - (1 - u) * 2.2));
    gl.uniform2f(U.uCentre, foci[i].x + (foci[i + 1].x - foci[i].x) * u, foci[i].y + (foci[i + 1].y - foci[i].y) * u);
    gl.uniform3f(U.uShow, showP, showA, showE);
    gl.uniform1f(U.uLod, lag); gl.uniform1f(U.uMove, move);
    gl.uniform1f(U.uFine, TUNE.fine); gl.uniform1f(U.uVeil, smooth(3.12, 3.7, p));
    gl.uniform1f(U.uGrain, GRAIN[i] * Math.pow(GRAIN[i + 1] / GRAIN[i], u));
    gl.uniform3f(U.uPort, Lo.P.x, Lo.P.y, Lo.hp); gl.uniform2f(U.uFace, Lo.face.x, Lo.face.y);
    gl.uniform1f(U.uHover, hover);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, photoTex); gl.uniform1i(U.uPhoto, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, sceneTex); gl.uniform1i(U.uScenes, 3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    var lo = T.a;
    pass(DOWN, T.a, sceneT); gl.uniform1i(DOWN.s, 0); gl.uniform2f(DOWN.px, 1 / bw, 1 / bh); gl.drawArrays(gl.TRIANGLES, 0, 3);
    pass(BLURH, T.b, T.a); gl.uniform1i(BLURH.s, 0); gl.uniform2f(BLURH.px, 1 / lo.w, 1 / lo.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    pass(TRAIL, T.g1, T.b, T.g0); gl.uniform1i(TRAIL.s, 0); gl.uniform1i(TRAIL.prev, 1); gl.uniform2f(TRAIL.px, 1 / lo.w, 1 / lo.h); gl.uniform1f(TRAIL.keep, keep); gl.drawArrays(gl.TRIANGLES, 0, 3);
    pass(COMP, null, sceneT, T.g1); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1i(COMP.s, 0); gl.uniform1i(COMP.g, 1); gl.uniform2f(COMP.px, 1 / bw, 1 / bh); gl.uniform1f(COMP.k, TUNE.glow); gl.drawArrays(gl.TRIANGLES, 0, 3);
    var sw = T.g0; T.g0 = T.g1; T.g1 = sw;
  }
  window.__hold = function (p: number | null, t?: number, lag?: number, move?: number) { frozen = p == null ? null : { pos: p, t: t || 0, lag: lag || 0, move: move || 0 }; target = Math.round(p || 0); pos = p || 0; vel = 0; };
  window.__layout = layout;
  window.__bench = function (p: number, n: number) {
    var px = new Uint8Array(4), t = performance.now();
    for (var i = 0; i < n; i++) { draw(p, 10 + i * 0.016, 0.9, 0.016, p !== Math.round(p)); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return (performance.now() - t) / n;
  };
  window.__state = function () { return { pos: pos, target: target }; };
  requestAnimationFrame(frame);
})();
type Pt = { x: number, y: number };
type Cam = Pt & { s: number };
type Poly = number[][];
type Scene = { trails: Poly[], forms: { focus?: boolean, poly: Poly, cut?: Poly, dashes?: Poly[] }[] };
type Layout = { W: number, H: number, small: boolean, views: Cam[], fixed: Pt[], A: Pt, E: Pt, P: Pt, hp: number, face: Pt, rE: number, rS: number };
type Prog = Record<string, WebGLUniformLocation | null> & { pr: WebGLProgram };
type Surface = { t: WebGLTexture, f: WebGLFramebuffer, w: number, h: number };
type Surfaces = { bw: number, bh: number, scene: Surface, lo: Surface, a: Surface, b: Surface, g0: Surface, g1: Surface };
type Memo<T> = { (): T, key?: string, v?: T };
type Hooks = { __calOpen?: () => boolean, __hold: (p: number | null, t?: number, lag?: number, move?: number) => void, __layout: () => Layout, __bench: (p: number, n: number) => number, __state: () => { pos: number, target: number } };
declare const window: Window & Hooks, PHOTO_SRC: string, MATTE_SRC: string, SCENES: (Scene | null)[];
