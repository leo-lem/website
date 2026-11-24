
(function () {
  var H3 = 0.8660254, cv = document.getElementById('gl'), endEl = document.getElementById('end'), titleEl = document.getElementById('title');
  var gl = cv.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stage = document.documentElement;

  // From the page: this article's scene and its two neighbours' (came after, builds on), and its figures by id.
  // A neighbour that doesn't exist has no scene (null), and its hexagon stays hidden.
  var SCENES = PAGE.scenes, FIGURES = PAGE.figures;

  function outline(shape, cx, cy, r) {
    var p = [], k;
    if (shape === 'hexagon') for (k = 0; k < 6; k++) { var an = Math.PI / 3 * k - Math.PI / 2; p.push([cx + r * Math.cos(an), cy + r * Math.sin(an)]); }
    else if (shape === 'triangle') { var q = r * 1.25; p = [[cx, cy - q], [cx + q * H3, cy + q * 0.5], [cx - q * H3, cy + q * 0.5]]; }
    else if (shape === 'trapezoid') p = [[cx - r, cy + r * 0.43], [cx - r * 0.5, cy - r * 0.43], [cx + r * 0.5, cy - r * 0.43], [cx + r, cy + r * 0.43]];
    else p = [[cx - r * 1.1, cy + r * 0.48], [cx - r * 0.1, cy - r * 0.73], [cx + r * 1.1, cy - r * 0.48], [cx + r * 0.1, cy + r * 0.73]];
    return p;
  }
  function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function h32(x) { x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }

  // The Newsletter button leads to the ending from anywhere on the page.
  document.getElementById('toTalk').addEventListener('click', function (e) {
    e.preventDefault(); window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
    setTimeout(function () { document.getElementById('nl-email').focus({ preventScroll: true }); }, 900);
  });

  // "Schedule a call" opens Cal.com's popup (src/cal.html).


  // ---- figures: the fractal's triangles on a small canvas; the forms assemble as the figure scrolls in ----
  var figs = [].map.call(document.querySelectorAll('.fig'), function (el) {
    var forms = FIGURES[el.id], c = el.querySelector('canvas');
    forms.forEach(function (f) { if (!f.label) return; var s = document.createElement('span'); s.textContent = f.label; if (f.focus) s.className = 'f'; el.appendChild(s); f.el = s; });
    return { el: el, c: c, forms: forms, prog: -1 };
  });
  function inPoly(p, x, y) { var ins = false; for (var i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) ins = !ins; return ins; }
  function edgeDist(p, x, y) { var best = 1e9; for (var i = 0, j = p.length - 1; i < p.length; j = i++) { var ax = p[j][0], ay = p[j][1], bx = p[i][0] - ax, by = p[i][1] - ay, t = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / (bx * bx + by * by))); best = Math.min(best, Math.hypot(x - ax - bx * t, y - ay - by * t)); } return best; }
  function drawFigure(F, prog) {
    var W = F.el.clientWidth, H = F.el.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1), c = F.c;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    var x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    var unit = Math.min(H, W * 0.4);
    var polys = F.forms.map(function (f) { return outline(f.shape, f.at[0] * W, f.at[1] * H, f.size * unit); });
    F.forms.forEach(function (f, i) { if (f.el) { f.el.style.left = (f.at[0] * W) + 'px'; f.el.style.top = (f.at[1] * H + f.size * unit + 12) + 'px'; f.el.style.opacity = prog > 0.25 + 0.5 * i / F.forms.length ? 1 : 0; } });
    // Two sizes of triangle on the fractal's grid: a coarse, faint ground and the fine pieces of the forms.
    function grid(side, each) {
      var h = side * H3, na = Math.ceil(W / h) + 1, nb = Math.ceil(H / side) + na;
      for (var a = -1; a < na; a++) for (var b = -na; b < nb; b++) {
        var P = function (u, v) { return [u * h, (v + u / 2) * side]; };
        [[P(a, b), P(a + 1, b), P(a, b + 1)], [P(a + 1, b), P(a + 1, b + 1), P(a, b + 1)]].forEach(function (t, k) {
          var mx = (t[0][0] + t[1][0] + t[2][0]) / 3, my = (t[0][1] + t[1][1] + t[2][1]) / 3;
          if (mx < -side || my < -side || mx > W + side || my > H + side) return;
          each(t, mx, my, h32(a * 7919 + b * 104729 + k * 31 + side * 977), k);
        });
      }
    }
    function tri(t, mx, my, col, alpha, shrink) {
      x.globalAlpha = alpha; x.fillStyle = col; x.beginPath();
      for (var i = 0; i < 3; i++) { var px = mx + (t[i][0] - mx) * shrink, py = my + (t[i][1] - my) * shrink; if (i) x.lineTo(px, py); else x.moveTo(px, py); }
      x.closePath(); x.fill();
    }
    grid(30, function (t, mx, my, r) {
      if (r < 0.3) return;
      for (var i = 0; i < polys.length; i++) if (!F.forms[i].absent && inPoly(polys[i], mx, my)) return;
      tri(t, mx, my, 'rgb(' + Math.round(52 + r * 30) + ',' + Math.round(62 + r * 34) + ',' + Math.round(96 + r * 50) + ')', 0.3 * (0.4 + 0.6 * smooth(0, 0.22, Math.min(my, H - my) / H)), 0.92);
    });
    grid(8.5, function (t, mx, my, r, k) {
      for (var i = 0; i < polys.length; i++) {
        var f = F.forms[i], when = 0.08 + 0.62 * i / polys.length + 0.2 * r;
        if (prog < when) continue;
        if (f.absent) { if (inPoly(polys[i], mx, my) && edgeDist(polys[i], mx, my) < 6.5 && h32(Math.round(mx / 14) * 17 + Math.round(my / 14) * 131) < 0.5) tri(t, mx, my, f.focus ? '#d98aa8' : '#8f9bc4', 0.9, 0.84); continue; }
        if (!inPoly(polys[i], mx, my)) continue;
        var l = 0.72 + 0.28 * r + (k ? 0.04 : -0.04), base = f.focus ? [226, 120, 160] : [128, 150, 232];
        tri(t, mx, my, 'rgb(' + Math.round(base[0] * l) + ',' + Math.round(base[1] * l) + ',' + Math.round(base[2] * l) + ')', 0.96, 0.84);
        return;
      }
    });
    x.globalAlpha = 1;
  }

  // ---- the world ----
  // The article's hexagon is the upper one of three in a larger hexagon; the other two are its neighbours.
  var AC = { x: 0.1875 * H3, y: 0.21875 }, RA = 1 / 16, C0 = { x: AC.x, y: AC.y + RA / 2 };
  var CELLS = [C0, { x: AC.x + RA / 2 * H3, y: AC.y - RA / 4 }, { x: AC.x - RA / 2 * H3, y: AC.y - RA / 4 }];
  function geom() {
    var W = window.innerWidth, H = window.innerHeight, small = W <= 720, key = W + 'x' + H;
    if (geom.key === key) return geom.v;
    function cam(f, sx, sy, s) { return { x: f.x - (sx - W / 2) * s, y: f.y + (sy - H / 2) * s, s: s }; }
    // The opening: the same figure as the ending, the article's hexagon nearly as tall as the screen beside the
    // title and reaching behind it, its neighbours below only faintly there.
    var r0 = small ? Math.min(H * 0.21, W * 0.4) : Math.min(H * 0.48, W * 0.3), sh = RA / 2 / r0;
    var zx = small ? W / 2 : W * 0.6, zy = small ? H - 40 - r0 : H * 0.5, hero = cam(C0, zx, zy, sh);
    // Reading: the camera dives into the article's own hexagon, about its middle, deeper the further you read.
    var Z = C0;
    function deep(t) { return cam(Z, zx, zy, sh * Math.pow(2, -5 * t)); }
    // The ending: pulled back to the hexagon of this article and its related ones, which stands alone
    // beside the invitation to talk, where the home page has the whole fractal.
    var rE = small ? Math.min(H * 0.15, W * 0.34) : Math.min(H * 0.3, W * 0.25);
    // On a phone the figure, its labels and Let's talk are one stack, centred on the screen.
    var talkH = small ? (document.getElementById('talk').offsetHeight || 230) : 0, stackTop = Math.max(64, (H - (2 * rE + 104 + talkH)) / 2);
    var end = cam(AC, small ? W / 2 : W * 0.66, small ? stackTop + rE : H * 0.52, RA / rE);
    geom.key = key;
    return geom.v = { W: W, H: H, small: small, hero: hero, deep: deep, end: end, Z: Z, rE: rE };
  }
  function toScreen(G, cam, p) { return { x: G.W / 2 + (p.x - cam.x) / cam.s, y: G.H / 2 - (p.y - cam.y) / cam.s }; }
  function camAt(a, b, t) {
    var s = a.s * Math.pow(b.s / a.s, t), r = b.s / a.s;
    if (Math.abs(1 - r) < 1e-9) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: s };
    var fx = (b.x - a.x * r) / (1 - r), fy = (b.y - a.y * r) / (1 - r), k = s / a.s;
    return { x: fx + (a.x - fx) * k, y: fy + (a.y - fy) * k, s: s };
  }

  // ---- the ending's labels and links ----
  var hd = document.querySelector('.hd');
  var hover = -1, nbs = [].slice.call(document.querySelectorAll('.nb')), hits = [].slice.call(document.querySelectorAll('.hit')), laid = '';
  nbs.concat(hits).forEach(function (a) {
    var i = +a.getAttribute('data-i');
    function set(v) { hover = v; nbs.forEach(function (n) { n.classList.toggle('hi', +n.getAttribute('data-i') === v); }); }
    a.addEventListener('mouseenter', function () { set(i); }); a.addEventListener('mouseleave', function () { set(-1); });
    a.addEventListener('focus', function () { set(i); }); a.addEventListener('blur', function () { set(-1); });
    // This article's own hexagon and title lead back to its start.
    if (i === 0) a.addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });
  });
  function layoutEnd(G) {
    if (laid === geom.key) return; laid = geom.key;
    var rc = G.rE / 2;
    [0, 1, 2].forEach(function (i) {
      var c = toScreen(G, G.end, CELLS[i]), pts = [], k;
      for (k = 0; k < 6; k++) { var an = Math.PI / 3 * k - Math.PI / 2; pts.push((H3 * rc + rc * Math.cos(an)).toFixed(1) + 'px ' + (rc + rc * Math.sin(an)).toFixed(1) + 'px'); }
      hits.concat(nbs).forEach(function (el) {
        if (+el.getAttribute('data-i') !== i) return;
        if (el.className.indexOf('hit') >= 0) { el.style.left = (c.x - H3 * rc) + 'px'; el.style.top = (c.y - rc) + 'px'; el.style.width = (2 * H3 * rc) + 'px'; el.style.height = (2 * rc) + 'px'; el.style.clipPath = 'polygon(' + pts.join(',') + ')'; }
        else if (i === 0) { el.style.left = c.x + 'px'; el.style.top = (toScreen(G, G.end, AC).y - G.rE - 16) + 'px'; }
        else if (G.small) {
          el.style.left = G.W * (i === 2 ? 0.26 : 0.74) + 'px'; el.style.top = (toScreen(G, G.end, AC).y + G.rE + 18) + 'px';
          // Let's talk follows right under the lower of the two labels.
          var talk = document.getElementById('talk'), under = Math.max.apply(null, nbs.filter(function (n) { return !n.classList.contains('up'); }).map(function (n) { return n.offsetTop + n.offsetHeight; }));
          if (isFinite(under)) { talk.style.top = (under + 28) + 'px'; talk.style.bottom = 'auto'; }
        }
        // Each neighbour's label sits at its hexagon's outer corner, as this article's title sits at the top one:
        // what it builds on at the lower left, what came after at the lower right.
        else {
          var left = i === 2, cx = c.x + (left ? -1 : 1) * H3 * rc, cy = c.y + rc / 2;
          var w = Math.max(160, Math.min(240, left ? cx - 14 - 24 : G.W - cx - 14 - 24));
          el.style.width = w + 'px'; el.style.transform = 'none'; el.style.textAlign = left ? 'right' : 'left';
          el.style.left = (left ? cx - 14 - w : cx + 14) + 'px'; el.style.top = (cy + 6) + 'px';
        }
      });
    });
  }

  if (!gl) { document.documentElement.classList.remove('gl'); return; }
/*GL*/
  U.uCells = gl.getUniformLocation(U.pr, 'uCells'); U.uSolo = gl.getUniformLocation(U.pr, 'uSolo');
  var photoTex = texture(1, 1, new Uint8Array([0, 0, 0, 0])), sceneTex = texture(1, 1, new Uint8Array([0, 0, 0, 255]));
  (function () {
    var N = 512, c = document.createElement('canvas'); c.width = N * 3; c.height = N;
    var x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, N * 3, N);
    // Laid out on the grid by the build (site/scenes.mjs). Red is how much a piece belongs to a form (a trail
    // half as much), green marks the form in focus. Trails first, then each form over the ones before it: the
    // gap around a nested form, then its outline, or for an absent form its dashes.
    SCENES.forEach(function (scene, i) {
      if (!scene) return;
      function fill(p, col) { x.fillStyle = col; x.beginPath(); p.forEach(function (q, k) { if (k) x.lineTo(i * N + q[0] * N, q[1] * N); else x.moveTo(i * N + q[0] * N, q[1] * N); }); x.closePath(); x.fill(); }
      x.save(); x.beginPath(); x.rect(i * N, 0, N, N); x.clip();
      scene.trails.forEach(function (p) { fill(p, 'rgb(140,0,0)'); });
      scene.forms.forEach(function (f) {
        if (f.cut) fill(f.cut, '#000');
        (f.dashes || [f.poly]).forEach(function (p) { fill(p, f.focus ? 'rgb(255,255,0)' : 'rgb(255,0,0)'); });
      });
      x.restore();
    });
    var w = c.width, h = c.height, d = x.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h * 4);
    for (var y = 0; y < h; y++) out.set(d.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
    // Each piece reads its form at its middle: sharp, so a piece is wholly in a form or not.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  })();

  // ---- reading drives the camera ----
  // Resting costs little: with nothing moving the fractal is drawn ten times a second and with fewer pixels, and
  // after 20 seconds without any input it is drawn sharp once more and then stands still until the next input.
  // Under automated testing (navigator.webdriver) the fractal rests right away: tests need its pictures, not its
  // life, and a slow test machine would otherwise spend everything on drawing.
  var STILL = !!navigator.webdriver;
  var lastInput = performance.now(), rested = false;
  ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointermove', 'pointerdown', 'scroll', 'resize', 'focus'].forEach(function (e) {
    window.addEventListener(e, function () { lastInput = performance.now(); }, { passive: true });
  });
  var frozen = null, t0 = performance.now(), lastDraw = 0, lastY = -1, lastMove = 0;
  function where(G, y) {
    var S = Math.max(1, document.documentElement.scrollHeight - G.H), bodyStart = G.H * 0.25, bodyEnd = Math.max(bodyStart + 1, endEl.offsetTop - G.H * 0.95);
    var t = Math.max(0, Math.min(1, (y - bodyStart) / (bodyEnd - bodyStart))), e = Math.max(0, Math.min(1, (y - bodyEnd) / Math.max(1, S - bodyEnd)));
    return { t: t, e: e, hero: Math.max(0, 1 - y / (G.H * 0.6)) };
  }
  function frame(now) {
    requestAnimationFrame(frame);
    var y = frozen ? frozen.y : window.scrollY;
    if (y !== lastY) { lastY = y; lastMove = now; }
    var moving = !frozen && now - lastMove < 140;
    var quiet = !moving && !frozen && (STILL || now - lastInput > 20000);
    if (quiet && rested) return;
    if (!quiet) rested = false;
    if (!moving && !frozen && !quiet && now - lastDraw < 100) return;
    var dd = lastDraw ? Math.min(0.05, (now - lastDraw) / 1000) : 1 / 60; lastDraw = now;
    draw(y, frozen ? frozen.t : (now - t0) / 1000, frozen || reduce ? 0 : Math.exp(-dd / 0.42), moving, !frozen && !quiet);
    if (quiet) rested = true;
  }
  function draw(y, time, keep, moving, low) {
    var G = geom(), W = G.W, H = G.H, dpr = Math.min(G.small ? 2.5 : 2, window.devicePixelRatio || 1, Math.sqrt(2.5e6 / (W * H)));
    var bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    surfaces(bw, bh);
    var q = where(G, y), es = q.e * q.e * (3 - 2 * q.e), cam = q.e > 0 ? camAt(G.deep(1), G.end, es) : G.deep(q.t);
    layoutEnd(G);
    figs.forEach(function (F) {
      var r = F.el.getBoundingClientRect(), p = frozen && frozen.fig != null ? frozen.fig : Math.max(0, Math.min(1, (H * 0.92 - r.top) / (H * 0.45)));
      p = Math.round(p * 60) / 60; if (reduce) p = 1;
      if (p !== F.prog && r.bottom > -50 && r.top < H + 50) { F.prog = p; drawFigure(F, p); }
    });
    var zs = toScreen(G, cam, G.Z), as = toScreen(G, cam, AC), tb = titleEl.getBoundingClientRect();
    var sceneT = moving || (low && !G.small) ? T.lo : T.scene, n = 1, open = smooth(0.15, 0.85, q.hero), nb = Math.max(smooth(0.3, 0.85, q.e), 0.3 * open);
    pass(U, sceneT);
    gl.uniform2f(U.uRes, W, H); gl.uniform1f(U.uDpr, dpr * sceneT.w / bw);
    gl.uniform2f(U.uCam, cam.x, cam.y); gl.uniform1f(U.uScale, cam.s);
    gl.uniform1f(U.uTime, reduce ? 40 : time); gl.uniform1f(U.uLife, reduce ? 0 : 1);
    gl.uniform4f(U.uCalm0, tb.left - 26, tb.top - 26, tb.right + 26, tb.bottom + 26);
    gl.uniform4f(U.uCalm1, 0, 0, 0, 0);
    gl.uniform2f(U.uCalmK, q.hero, 0);
    // The figure always stands alone: reading dives into it, the ending pulls back out of it.
    gl.uniform1f(U.uSolo, 1);
    var top = q.hero > 0.4 || q.e > 0.9;
    document.getElementById('name').style.opacity = top ? 1 : 0;
    if (G.small) { hd.style.opacity = top ? 1 : 0; hd.style.visibility = top ? 'visible' : 'hidden'; } else { hd.style.opacity = 1; hd.style.visibility = 'visible'; }
    gl.uniform2f(U.uCentre, zs.x + (as.x - zs.x) * es, zs.y + (as.y - zs.y) * es);
    gl.uniform3f(U.uShow, 0, 1, 0); gl.uniform3f(U.uCells, n, PAGE.has[1] ? nb : 0, PAGE.has[2] ? nb : 0);
    gl.uniform1f(U.uLod, 0); gl.uniform1f(U.uMove, moving ? 0.6 : 0); gl.uniform1f(U.uGrain, 7); gl.uniform1f(U.uFine, 2); gl.uniform1f(U.uVeil, 0);
    gl.uniform3f(U.uPort, 0, 0, 1); gl.uniform2f(U.uFace, 0, 0);
    gl.uniform1f(U.uHover, q.e > 0.9 ? hover : -1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, photoTex); gl.uniform1i(U.uPhoto, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, sceneTex); gl.uniform1i(U.uScenes, 3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    var lo = T.a;
    pass(DOWN, T.a, sceneT); gl.uniform1i(DOWN.s, 0); gl.uniform2f(DOWN.px, 1 / bw, 1 / bh); gl.drawArrays(gl.TRIANGLES, 0, 3);
    pass(BLURH, T.b, T.a); gl.uniform1i(BLURH.s, 0); gl.uniform2f(BLURH.px, 1 / lo.w, 1 / lo.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    pass(TRAIL, T.g1, T.b, T.g0); gl.uniform1i(TRAIL.s, 0); gl.uniform1i(TRAIL.prev, 1); gl.uniform2f(TRAIL.px, 1 / lo.w, 1 / lo.h); gl.uniform1f(TRAIL.keep, keep); gl.drawArrays(gl.TRIANGLES, 0, 3);
    pass(COMP, null, sceneT, T.g1); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1i(COMP.s, 0); gl.uniform1i(COMP.g, 1); gl.uniform2f(COMP.px, 1 / bw, 1 / bh); gl.uniform1f(COMP.k, 0.46); gl.drawArrays(gl.TRIANGLES, 0, 3);
    var sw = T.g0; T.g0 = T.g1; T.g1 = sw;
  }
  // For tests: hold a scroll position and a moment.
  window.__hold = function (y, t, fig) { frozen = y == null ? null : { y: y, t: t || 0, fig: fig }; if (y != null) window.scrollTo(0, y); lastDraw = 0; };
  // For tests: what one frame costs at a scroll position, waiting for the graphics card each time.
  window.__bench = function (y, n, moving) {
    var px = new Uint8Array(4), s = performance.now();
    window.scrollTo(0, y);
    for (var i = 0; i < n; i++) { draw(y, 10 + i * 0.016, 0.9, moving); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return (performance.now() - s) / n;
  };
  window.__info = function () { var G = geom(); return { H: G.H, endTop: endEl.offsetTop, max: document.documentElement.scrollHeight - G.H, fig: figs.map(function (F) { return F.el.getBoundingClientRect().top + window.scrollY; }) }; };
  requestAnimationFrame(frame);
})();
