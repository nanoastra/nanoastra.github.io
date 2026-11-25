/* Streaming execution (index.html, Efficiency section): a player for replayed episodes (figure.sf).  The simulator
   camera is the only video; the request, the streamed reply and the timeline are drawn from
   static/streaming/<episode>.json in step with the video clock, which is simulated time (frame n = n / 30 s). */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg', DIR = 'static/streaming/';
  var REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var END_HOLD = 2500;     // ms on the last frame before the next episode
  var uid = 0;

  // ---------------------------------------------------------------- helpers
  function el(tag, cls, parent, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  function sv(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function button(cls, parent, html, label, onClick) {
    var b = el('button', cls, parent, html);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function secs(x, d) { return x.toFixed(d == null ? 1 : d) + ' s'; }
  function span(a, b) { return a.toFixed(2) + '–' + b.toFixed(2) + ' s'; }
  function stepsText(ids) {
    if (ids.length < 2) return ids.length ? 'step ' + ids[0] : 'no steps';
    var run = ids.every(function (x, i) { return !i || x === ids[i - 1] + 1; });
    return 'steps ' + (run ? ids[0] + '–' + ids[ids.length - 1] : ids.slice(0, -1).join(', ') + ' and ' + ids[ids.length - 1]);
  }
  function playSafe(v, blocked) {      // blocked(): the browser refused to play (not just an interrupted play)
    var p = v.play();
    if (p && p.catch) p.catch(function (e) { if (e && e.name === 'NotAllowedError' && blocked) blocked(); });
  }
  var ICON = {
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>',
    prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3 5.5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'
  };

  // ---------------------------------------------------------------- episode data
  var cache = {};
  function load(name) {
    if (!cache[name]) {
      cache[name] = fetch(DIR + name + '.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(prep);
      cache[name].catch(function () { delete cache[name]; });       // a failed load can be retried
    }
    return cache[name];
  }
  function prep(ep) {
    var D = ep.duration, writtenIn = {};
    ep.blocks = [];
    ep.turns.forEach(function (tu, k) {
      tu.steps.forEach(function (s) {
        var st = JSON.parse(s.text);
        s.parts = ['left', 'right'].map(function (a) {
          var c = (st[a] || []).filter(function (x) { return x !== 'wait'; });
          return c.length ? [a === 'left' ? 'Left: ' : 'Right: ', c.join(', ')] : null;
        }).filter(Boolean);
        if (!s.parts.length) s.parts = [['', 'Both arms wait']];
        s.plain = s.parts.map(function (p) { return p[0] + p[1]; }).join(' · ');
        if (!s.carried) writtenIn[s.id] = tu.n;
        if (!s.carried && s.start != null && s.start < s.arrive) s.arrive = s.start;     // ms rounding in the trace
        s.wturn = writtenIn[s.id];
        s.tu = tu;
        if (s.state === 'ran' && s.start != null && s.start < D) ep.blocks.push(s);
      });
      // the cut is decided once the reply is complete and the last step before it has started
      var ran = tu.steps.filter(function (s) { return s.state === 'ran'; });
      var decided = Math.max(tu.t_reply, ran.length ? ran[ran.length - 1].start : tu.t_send);
      tu.steps.forEach(function (s) { if (s.state === 'cut') s.carryAt = decided; });
      tu.failed = tu.steps.filter(function (s) { return s.ok === false; })[0] || null;
      tu.pre = tu.steps.filter(function (s) { return s.carried; }).map(function (s) { return s.id; });
      var prev = ep.turns[k - 1];      // a failure ends its turn at once, so it is told in the next one
      if (prev && prev.failed) tu.after = 'step ' + prev.failed.id + ' of reply ' + prev.n + ' failed' +
        (prev.steps.some(function (s) { return s.state === 'skipped'; }) ? ', the rest was dropped' : '');
    });
    ep.turnAt = function (t) {
      var k = 0;
      while (k + 1 < ep.turns.length && ep.turns[k + 1].t_send <= t + 1e-4) k++;
      return k;
    };
    ep.lanes = {
      idle: ep.idle, success: ep.success_at,
      segs: ep.turns.filter(function (tu) { return tu.t_send < D; }).map(function (tu) {
        return { a: tu.t_send, b: Math.min(tu.t_reply, D), tip: 'Model infers reply ' + tu.n + ' · ' + span(tu.t_send, Math.min(tu.t_reply, D)) };
      }),
      blocks: ep.blocks.map(function (s) { return { a: s.start, b: Math.min(s.end, D), kind: s.carried ? 'pre' : 'new', ok: s.ok, id: s.id, tip: stepTip(s) }; }),
      snaps: ep.turns.map(function (tu) { return { t: tu.t_send, n: tu.n }; })
    };
    return ep;
  }
  function stepTip(s) {
    return 'Step ' + s.id + (s.carried ? ', prefilled from reply ' + s.wturn : '') + ' · ' + s.label +
      (s.start != null ? ' · ' + span(s.start, s.end) : '') + (s.ok === false ? ' · failed: ' + s.note : '');
  }
  function stepState(s, t, ep) {
    if (!s.carried) { if (t < s.write0) return 'hidden'; if (t < s.arrive) return t >= ep.duration - 1e-3 ? 'stopped' : 'writing'; }
    if (s.state === 'ran') return t < s.start ? 'queued' : t < s.end ? 'running' : s.ok === false ? 'failed' : 'done';
    if (s.state === 'skipped') return s.tu.failed && t >= s.tu.failed.end ? 'skipped' : 'queued';
    if (s.state === 'unrun' && t >= ep.duration - 1e-3) return 'unneeded';
    if (s.state === 'cut' && t >= s.carryAt) return 'carry';
    return 'queued';
  }
  var STATE = { writing: 'writing', queued: 'queued', running: 'running', done: 'done', failed: 'failed', skipped: 'skipped', unneeded: 'not run', stopped: 'stopped' };

  // ---------------------------------------------------------------- timeline
  var LEGEND =
    '<span><i class="lg lg-infer"></i>model infers</span>' +
    '<span><i class="lg lg-new"></i>robot runs a step</span>' +
    '<span><i class="lg lg-pre"></i>robot runs a prefilled step</span>' +
    '<span><i class="lg lg-idle"></i>robot waits</span>' +
    '<span><i class="lg lg-snap"></i>snapshot sent</span>';

  // d: {segs, blocks, idle, snaps, success} (prep); G: geometry; x: time -> px
  function drawLanes(svg, d, x, G) {
    var defs = sv('defs', {}, svg), hid = 'sf-hatch' + (++uid), cid = 'sf-clip' + uid;
    var pat = sv('pattern', { id: hid, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    sv('rect', { width: 6, height: 6, fill: '#f6dcd5' }, pat);
    sv('rect', { width: 2.4, height: 6, fill: '#c8553d' }, pat);
    sv('rect', { x: G.L, y: 0, width: G.W - G.L - G.R, height: G.H }, sv('clipPath', { id: cid }, defs));
    sv('text', { x: 0, y: G.yM + G.hM / 2 + 4, class: 'ln' }, svg).textContent = 'Model';
    sv('text', { x: 0, y: G.yR + G.hR / 2 + 4, class: 'ln' }, svg).textContent = 'Robot';
    sv('rect', { x: G.L, y: G.yM, width: G.W - G.L - G.R, height: G.hM, rx: 3, class: 'lane' }, svg);
    sv('rect', { x: G.L, y: G.yR, width: G.W - G.L - G.R, height: G.hR, rx: 3, class: 'lane' }, svg);
    var g = sv('g', { 'clip-path': 'url(#' + cid + ')' }, svg);
    d.idle.forEach(function (iv) {
      sv('rect', { x: x(iv[0]), y: G.yR, width: Math.max(1, x(iv[1]) - x(iv[0])), height: G.hR, fill: 'url(#' + hid + ')', 'data-tip': 'Robot waits for the model · ' + span(iv[0], iv[1]) }, g);
    });
    d.segs.forEach(function (s) {
      sv('rect', { x: x(s.a), y: G.yM, width: Math.max(1, x(s.b) - x(s.a)), height: G.hM, class: 'm-infer', 'data-tip': s.tip }, g);
    });
    d.blocks.forEach(function (b) {
      var x0 = x(b.a) + 0.75, w = Math.max(1.5, x(b.b) - x(b.a) - 1.5);
      sv('rect', { x: x0, y: G.yR, width: w, height: G.hR, rx: 2.5, class: 'b-' + b.kind + (b.ok === false ? ' b-fail' : ''), 'data-tip': b.tip }, g);
      if (b.id != null && w >= String(b.id).length * 7 + 6) sv('text', { x: x0 + w / 2, y: G.yR + G.hR / 2 + 4, class: 'bl bl-' + b.kind }, g).textContent = b.id;
    });
    var lastX = -99;
    d.snaps.forEach(function (sn) {
      var X = x(sn.t);
      if (X < G.L - 1 || X > G.W - G.R + 1) return;
      sv('line', { x1: X, x2: X, y1: G.yM - 8, y2: G.yR + G.hR + 3, class: 'snap' }, svg);
      sv('circle', { cx: X, cy: G.yM - 8, r: 3.5, class: 'snapdot', 'data-tip': 'Snapshot ' + sn.n + ' sent at ' + secs(sn.t, 2) }, svg);
      if (X - lastX > 16 && !(d.success != null && Math.abs(x(d.success) - X) < 14)) { sv('text', { x: X + 5, y: G.yM - 4, class: 'sn' }, svg).textContent = sn.n; lastX = X; }
    });
    if (d.success != null) {
      var X = x(d.success);
      sv('line', { x1: X, x2: X, y1: G.yM - 4, y2: G.yR + G.hR + 3, class: 'done' }, svg);
      sv('path', { d: 'M' + X + ',' + (G.yM - 11) + ' l8,3.5 l-8,3.5 z', class: 'doneflag', 'data-tip': 'Task completed at ' + secs(d.success, 2) }, svg);
    }
  }
  function drawAxis(svg, x, T, y, G) {
    var px = (G.W - G.L - G.R) / T, step = [1, 2, 5, 10].filter(function (s) { return s * px >= 44; })[0] || 10;
    for (var t = 0; t <= T + 1e-6; t += step) {
      var X = x(t);
      sv('line', { x1: X, x2: X, y1: y, y2: y + 3, class: 'axt' }, svg);
      sv('text', { x: X, y: y + 14, class: 'axl' }, svg).textContent = t + (t + step > T + 1e-6 ? ' s' : '');
    }
  }
  function lanesGeometry(W, L, R) {
    var G = { W: W, L: L, R: R, yM: 20, hM: 14 };
    G.yR = G.yM + G.hM + 8; G.hR = 20; G.H = G.yR + G.hR + 22;
    return G;
  }
  function tooltip(host) {        // one floating label, filled from the hovered element's data-tip
    var tip = el('div', 'sf-tip', host), shown = null, w = 0, h = 0;
    return {
      show: function (e) {
        var text = e.target.getAttribute && e.target.getAttribute('data-tip');
        if (!text) { tip.style.display = 'none'; return; }
        tip.style.display = 'block';
        if (text !== shown) { shown = text; tip.textContent = text; w = tip.offsetWidth; h = tip.offsetHeight; }
        var r = host.getBoundingClientRect();
        tip.style.left = clamp(e.clientX - r.left - w / 2, 0, r.width - w) + 'px';
        tip.style.top = (e.clientY - r.top - h - 12) + 'px';
      },
      hide: function () { tip.style.display = 'none'; }
    };
  }

  // the player's timeline: click or drag to seek (a touch seeks on a tap or once it moves sideways, so that a
  // vertical swipe across it still scrolls the page), arrow keys step by a second
  function Timeline(parent, onSeek) {
    var self = this, drag = null, w = this.wrap = el('div', 'sf-tlsvg');
    this.box = el('div', 'sf-tl', parent);
    this.box.appendChild(w);
    el('div', 'sf-legend', this.box, LEGEND);
    var tip = tooltip(this.box);
    var at = function (e) {
      var r = w.getBoundingClientRect(), G = self.G;
      return clamp((e.clientX - r.left - G.L) / (G.W - G.L - G.R) * self.T, 0, self.T);
    };
    var live = function (e) { drag.live = self.held = true; try { w.setPointerCapture(e.pointerId); } catch (x) { /* */ } onSeek(at(e)); };
    w.addEventListener('pointerdown', function (e) {
      if (!self.G || drag) return;
      tip.hide();
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, live: false };
      if (e.pointerType !== 'touch') { live(e); e.preventDefault(); }
    });
    w.addEventListener('pointermove', function (e) {
      if (!drag) { tip.show(e); return; }
      if (e.pointerId !== drag.id) return;
      if (drag.live) { onSeek(at(e)); return; }
      var dx = Math.abs(e.clientX - drag.x0), dy = Math.abs(e.clientY - drag.y0);
      if (dy > 10 && dy >= dx) drag = null;             // a scroll, not a seek
      else if (dx > 6 && dx > dy) live(e);
    });
    w.addEventListener('pointerup', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.live && Math.abs(e.clientX - drag.x0) < 10 && Math.abs(e.clientY - drag.y0) < 10) onSeek(at(e));      // a tap
      drag = null; self.held = false;
    });
    w.addEventListener('pointercancel', function (e) { if (drag && e.pointerId === drag.id) { drag = null; self.held = false; } });
    w.addEventListener('pointerleave', tip.hide);
    w.tabIndex = 0;
    w.setAttribute('role', 'slider');
    w.setAttribute('aria-label', 'Playback position');
    w.setAttribute('aria-valuemin', '0');
    w.addEventListener('keydown', function (e) {
      var d = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[e.key];
      if (e.key === 'Home') onSeek(0); else if (e.key === 'End') onSeek(self.T); else if (d && self.T) onSeek(clamp((self.t || 0) + d, 0, self.T)); else return;
      e.preventDefault();
    });
    if (window.ResizeObserver) new ResizeObserver(function () { self.draw(); }).observe(w);
  }
  Timeline.prototype.set = function (lanes, T) {
    this.lanes = lanes; this.T = T; this.W = 0;
    this.wrap.setAttribute('aria-valuemax', T.toFixed(1));
    this.draw();
  };
  Timeline.prototype.draw = function () {
    var W = this.wrap.clientWidth;
    if (!this.lanes || !W || W === this.W) return;
    this.W = W;
    var G = this.G = lanesGeometry(W, W < 560 ? 44 : 52, 10), T = this.T;
    var x = this.x = function (t) { return G.L + (G.W - G.L - G.R) * t / T; };
    this.wrap.innerHTML = '';
    var svg = sv('svg', { width: W, height: G.H, viewBox: '0 0 ' + W + ' ' + G.H, class: 'sf-svg' }, this.wrap);
    drawLanes(svg, this.lanes, x, G);
    drawAxis(svg, x, T, G.yR + G.hR + 4, G);
    this.mask = sv('rect', { y: G.yM - 1, height: G.yR + G.hR - G.yM + 2, class: 'future' }, svg);
    this.head = sv('line', { y1: 3, y2: G.yR + G.hR + 3, class: 'head' }, svg);
    if (this.t != null) this.setTime(this.t);
  };
  Timeline.prototype.setTime = function (t) {
    this.t = t;
    var v = t.toFixed(1);
    if (v !== this.aria) { this.aria = v; this.wrap.setAttribute('aria-valuenow', v); this.wrap.setAttribute('aria-valuetext', v + ' s'); }
    if (!this.mask) return;
    var G = this.G, X = clamp(this.x(t), G.L, G.W - G.R);
    this.mask.setAttribute('x', X); this.mask.setAttribute('width', Math.max(0, G.W - G.R - X));
    this.head.setAttribute('x1', X); this.head.setAttribute('x2', X);
  };

  // ---------------------------------------------------------------- player
  function Player(root) {
    this.root = root;
    this.t = 0; this.k = null; this.rate = 1; this.playing = !REDUCED; this.visible = false; this.token = 0; this.flights = [];
    this.build();
  }
  Player.prototype.build = function () {
    var r = this.root, self = this;
    var pick = r.querySelector('.sf-pick'), caption = r.querySelector('figcaption');
    this.task = el('p', 'sf-task');
    var stage = this.stage = el('div', 'sf-stage');
    r.insertBefore(stage, r.firstChild);
    r.insertBefore(this.task, stage);

    // left: the robot
    this.vbox = el('div', 'sf-vid', stage);
    var v = this.video = el('video', null, this.vbox);
    v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';     // no src until the player is near
    v.setAttribute('aria-label', 'Simulator camera');
    v.addEventListener('click', function () { self.toggle(); });
    this.robotChip = el('div', 'sf-chip sf-robot', this.vbox);
    this.clock = el('div', 'sf-chip sf-clock', this.vbox);
    this.snapChip = el('div', 'sf-chip sf-snapchip', this.vbox);
    el('div', 'sf-paused', this.vbox, ICON.play);

    // right: the model, what it receives (top) and what it writes (below)
    var inner = el('div', 'sf-side', stage);
    var req = el('section', 'sf-req', inner);
    var rh = el('h5', null, req, 'Sent to the model');
    this.reqMeta = el('span', null, rh);
    var row = el('div', 'sf-reqrow', req), imgs = el('div', 'sf-imgs', row);
    this.imgs = ['overview', 'left wrist', 'right wrist'].map(function (name) {
      var b = button('sf-img', imgs, null, name + ' camera, as sent to the model', function () {
        self.lightbox('<img src="' + esc(im.src) + '" alt="">', name + ' camera, as sent to the model');
      });
      var im = el('img', null, b); im.alt = ''; im.width = 320; im.height = 240;
      b.title = name;
      return im;
    });
    button('sf-prompt', row, 'View the prompt', null, function () { self.showPrompt(); });
    var rep = el('section', 'sf-rep', inner);
    var ph = el('h5', null, rep);
    this.repTitle = el('b', null, ph);
    this.status = el('span', 'sf-status', ph);
    var pg = el('div', 'sf-prog', rep);
    el('span', 'sf-lab', pg, 'Progress');
    var pt = el('span', 'sf-progt', pg);
    this.progText = el('span', null, pt);
    this.progCaret = el('i', 'sf-caret', pt);
    var sh = el('div', 'sf-steph', rep);
    el('span', 'sf-lab', sh, 'Steps');
    this.note = el('span', 'sf-note', sh);
    this.list = el('ol', 'sf-steps', rep);

    this.tl = new Timeline(r, function (t) { self.seek(t); });

    // controls
    var bar = el('div', 'sf-ctl', r);
    this.playBtn = button('sf-icon', bar, ICON.pause, 'Pause', function () { self.toggle(); });
    var turns = el('div', 'sf-turns', bar);
    this.prevBtn = button('sf-icon', turns, ICON.prev, 'Previous turn', function () { self.stepTurn(-1); });
    this.turnLabel = el('span', null, turns);
    this.nextBtn = button('sf-icon', turns, ICON.next, 'Next turn', function () { self.stepTurn(1); });
    var speed = el('div', 'sf-seg', bar);
    speed.setAttribute('role', 'group'); speed.setAttribute('aria-label', 'Playback speed');
    this.rates = [0.25, 0.5, 1].map(function (x) {
      var b = button(null, speed, x + '×', null, function () {
        self.rate = x; v.playbackRate = x;
        self.rates.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      });
      b.setAttribute('aria-pressed', String(x === 1));
      return b;
    });
    r.appendChild(pick);
    this.picks = Array.prototype.slice.call(pick.querySelectorAll('button[data-ep]'));
    this.picks.forEach(function (b, i) { b.addEventListener('click', function () { self.open(i, true); }); });
    if (caption) r.appendChild(caption);
    // the lightbox: a modal over the viewport
    this.lb = el('div', 'sf-lb', r);
    this.lb.hidden = true;
    this.lb.addEventListener('click', function (e) { if (e.target === self.lb) self.closeLightbox(); });
    this.lb.addEventListener('keydown', function (e) { if (e.key === 'Tab') { self.lb.querySelector('.sf-x').focus(); e.preventDefault(); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') self.closeLightbox(); });

    // a seek before the metadata is in waits in pending; after that the video clock reads the new time at once
    v.addEventListener('loadedmetadata', function () {
      if (self.pending != null) { try { v.currentTime = self.pending; } catch (e) { /* */ } self.pending = null; }
      v.playbackRate = self.rate;
    });
    v.addEventListener('error', function () { self.pending = null; self.playing = false; self.resume(); });
  };
  Player.prototype.lightbox = function (html, caption) {
    var self = this;
    this.lb.innerHTML = '<div class="sf-lbin" role="dialog" aria-modal="true">' + html + '<p>' + esc(caption) + '</p></div>';
    var box = this.lb.firstChild;
    box.setAttribute('aria-label', caption);
    box.insertBefore(button('sf-x', null, '&times;', 'Close', function () { self.closeLightbox(); }), box.firstChild);
    this.lbBack = { focus: document.activeElement, playing: this.playing };
    if (this.playing) { this.playing = false; this.resume(); }
    this.lb.hidden = false;
    document.documentElement.classList.add('sf-lock');
    box.querySelector('.sf-x').focus({ preventScroll: true });
  };
  Player.prototype.closeLightbox = function () {
    if (this.lb.hidden) return;
    this.lb.hidden = true;
    document.documentElement.classList.remove('sf-lock');
    var back = this.lbBack;
    if (back.playing) { this.playing = true; this.resume(); }
    if (back.focus && back.focus.focus) back.focus.focus({ preventScroll: true });
  };
  Player.prototype.showPrompt = function () {     // the text of the current request, results of the last turn marked
    var tu = this.ep && this.ep.turns[this.k];
    if (!tu) return;
    this.lightbox('<pre>' + esc(tu.prompt).replace(/(RESULT OF YOUR LAST TURN:[\s\S]*?)(\n\n)/, '<mark>$1</mark>$2') + '</pre>',
      'Text of request ' + tu.n + ', sent with the three images; the system prompt and the previous turn are not shown');
  };
  Player.prototype.start = function () {
    if (this.started) return;
    this.started = true;
    this.open(0, false);
  };
  Player.prototype.open = function (i, user) {
    var self = this, token = ++this.token, name = this.picks[i].dataset.ep;
    this.pi = i; this.loading = true; this.endedAt = null;
    this.press(i);
    load(name).then(function (ep) {
      if (self.token !== token) return;
      self.loading = false; self.shown = i;
      if (user) self.playing = true;
      self.ep = ep; self.k = null;
      self.video.src = DIR + ep.name + '.mp4';
      self.video.poster = DIR + ep.name + '.jpg';
      self.video.playbackRate = self.rate;
      self.task.innerHTML = '<b>Task.</b> ' + esc(ep.instruction);
      self.tl.set(ep.lanes, ep.duration);
      self.seek(0);
      self.resume();
      var after = self.picks[(i + 1) % self.picks.length].dataset.ep;      // the next one, ahead of time
      load(after).catch(function () {});
      (new Image()).src = DIR + after + '.jpg';
    }, function () {
      if (self.token !== token) return;
      self.loading = false;
      if (self.shown == null) return;
      self.press(self.shown);
      if (user) self.pi = self.shown;
      else self.endedAt = performance.now();      // auto-advance: try the one after it, after another hold
    });
  };
  Player.prototype.press = function (i) {
    this.picks.forEach(function (o, j) { o.setAttribute('aria-pressed', String(j === i)); });
  };
  Player.prototype.seek = function (t) {
    if (!this.ep) return;
    t = clamp(t, 0, this.ep.duration);
    this.endedAt = null;
    var v = this.video;
    if (v.readyState >= 1) { v.currentTime = t; this.pending = null; } else this.pending = t;
    if (this.playing && this.visible && v.paused && v.readyState >= 1 && t < this.ep.duration - 0.05) playSafe(v);     // back from the end
    this.render(t, true);
    loop.wake();
  };
  Player.prototype.resume = function () {
    var self = this, on = this.playing;
    this.playBtn.innerHTML = on ? ICON.pause : ICON.play;
    this.playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
    this.vbox.classList.toggle('is-paused', !on && !!this.ep);
    this.root.classList.toggle('is-still', !(on && this.visible));       // pulses and carets rest with the video
    if (!this.ep) return;
    if (on && this.visible) {
      if (this.endedAt != null) this.endedAt = performance.now();     // at the end: hold again, then the next episode
      else playSafe(this.video, function () { self.playing = false; self.resume(); });
      loop.wake();
    } else this.video.pause();
  };
  Player.prototype.toggle = function () {
    this.playing = !this.playing;
    if (this.playing && this.ep && this.t >= this.ep.duration - 0.05) this.seek(0);
    this.resume();
  };
  Player.prototype.stepTurn = function (d) {
    var ep = this.ep;
    if (!ep) return;
    var k = ep.turnAt(this.t);
    if (d < 0 && this.t - ep.turns[k].t_send > 0.6) d = 0;      // first back to the start of this turn
    if (k + d < 0 || k + d >= ep.turns.length) return;
    this.seek(ep.turns[k + d].t_send + 0.001);
  };

  // ---- a new turn on screen
  Player.prototype.land = function () {       // end the snapshot animation, if one is still in flight
    this.flights.forEach(function (a) { a.cancel(); });
    this.flights = [];
    this.root.querySelectorAll('.sf-fly').forEach(function (e) { e.remove(); });
  };
  Player.prototype.still = function () {      // a jump: stop whatever moves; cards are placed without transitions
    this.land();
    this.list.querySelectorAll('.is-out').forEach(function (e) { e.remove(); });
    this.list.classList.add('no-anim');
    this.settle = true;      // transitions come back once this frame is laid out (end of render)
  };
  Player.prototype.showTurn = function (k, smooth, t) {
    var self = this, ep = this.ep, tu = ep.turns[k], last = ep.turns.length - 1;
    if (smooth) this.land(); else this.still();
    this.reqMeta.textContent = secs(tu.t_send, 2);
    tu.images.forEach(function (f, i) { self.imgs[i].src = DIR + ep.name + '/' + f; });
    this.repTitle.textContent = 'Model reply ' + tu.n;
    this.turnLabel.textContent = 'Turn ' + tu.n + ' / ' + ep.turns.length;
    var lost = document.activeElement;
    this.prevBtn.disabled = k === 0;
    this.nextBtn.disabled = k === last;
    if (lost && lost.disabled) (lost === this.prevBtn ? this.nextBtn : this.prevBtn).focus({ preventScroll: true });      // keep the keyboard on the bar
    this.pc = null;
    this.syncRows(tu, smooth, t);
    var next = ep.turns[k + 1];
    if (next) next.images.forEach(function (f) { (new Image()).src = DIR + ep.name + '/' + f; });
    if (smooth) {        // the snapshot travels from the camera to the request
      var R = this.root.getBoundingClientRect(), a = this.vbox.getBoundingClientRect(), b = this.imgs[0].parentNode.getBoundingClientRect();
      var fly = el('img', 'sf-fly', this.root);
      fly.src = this.imgs[0].src;
      fly.style.left = (b.left - R.left) + 'px'; fly.style.top = (b.top - R.top) + 'px'; fly.style.width = b.width + 'px';
      var f = fly.animate([{ transform: 'translate(' + (a.left - b.left) + 'px,' + (a.top - b.top) + 'px) scale(' + (a.width / b.width) + ')', opacity: 0.8 },
                           { transform: 'none', opacity: 1 }], { duration: 900, easing: 'cubic-bezier(.3,.6,.2,1)' });
      f.onfinish = function () { fly.remove(); };
      this.flights.push(f);
      this.imgs.forEach(function (im, i) { self.flights.push(im.parentNode.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 700 + 120 * i, easing: 'ease-out' })); });
    }
  };
  // The step cards sit in four fixed slots (a reply has at most four steps) and persist across turns, keyed by step
  // id.  On a switch to the next turn the finished cards take their final state and fade out in place, and the carried
  // cards move up to the first slots, as one eased motion; new cards are born hidden and fade in when the model starts
  // writing them.  Any other jump places the cards without transitions (restored after the frame is painted).
  Player.prototype.syncRows = function (tu, smooth, t) {
    var self = this, ep = this.ep, byId = {}, L = this.list;
    (this.rows || []).forEach(function (r) { byId[r.s.id] = r; });
    L.querySelectorAll('.is-out').forEach(function (e) { e.remove(); });
    if (!smooth) { L.innerHTML = ''; byId = {}; }
    this.rows = tu.steps.map(function (s, i) {
      var r = smooth && s.carried && byId[s.id];
      if (r) { delete byId[s.id]; r.s = s; r.state = ''; r.chars = null; r.li.title = s.plain; self.tag(r, 'is-on'); }
      else { r = self.makeRow(s, stepState(s, t, ep)); L.appendChild(r.li); }
      r.li.style.setProperty('--i', i);
      return r;
    });
    Object.keys(byId).forEach(function (id) {
      var r = byId[id], st = stepState(r.s, t, ep);
      if (st !== r.state) self.paint(r, st);
      r.li.classList.add('is-out');
      setTimeout(function () { r.li.remove(); }, 700);
    });
  };
  Player.prototype.makeRow = function (s, st) {
    var li = el('li', 'sf-card');
    li.setAttribute('data-sid', s.id);
    li.title = s.plain;
    var g = el('div', 'sf-g', li), top = el('div', null, g);
    el('span', 'sf-id', top, String(s.id));
    var code = el('div', 'sf-cmd', li);
    var r = { s: s, li: li, g: g, st: el('span', 'sf-st', top), text: el('span', null, code), caret: el('i', 'sf-caret', code),
              bar: el('i', null, el('div', 'sf-bar', li)), state: '', chars: null };
    if (s.carried) this.tag(r, 'is-on');
    this.paint(r, st);
    return r;
  };
  Player.prototype.tag = function (r, how) {      // "prefilled": faint while the card waits to move, solid after
    var tag = r.g.querySelector('.sf-tag');
    if (!how) { if (tag) tag.remove(); return; }
    if (!tag) tag = el('span', 'sf-tag', r.g, 'prefilled');
    tag.className = 'sf-tag ' + how;
  };
  Player.prototype.paint = function (r, st) {
    r.state = st;
    r.li.className = 'sf-card is-' + st + (r.s.carried ? ' is-pre' : '') + (r.li.classList.contains('is-out') ? ' is-out' : '');
    r.li.setAttribute('aria-hidden', String(st === 'hidden'));
    r.st.textContent = st === 'carry' ? '→ reply ' + (r.s.tu.n + 1) : STATE[st] || '';
    if (!r.s.carried) this.tag(r, st === 'carry' ? 'is-soon' : null);
  };
  function typed(s, n) {        // the first n characters of a step's text, with the arm names in bold
    var out = '', left = n;
    for (var i = 0; i < s.parts.length && left > 0; i++) {
      var p = s.parts[i];
      if (i) { out += '<span class="sf-sep">' + ' · '.slice(0, left) + '</span>'; left -= 3; }
      if (left <= 0) break;
      out += '<b>' + esc(p[0].slice(0, left)) + '</b>'; left -= p[0].length;
      if (left > 0) { out += esc(p[1].slice(0, left)); left -= p[1].length; }
    }
    return out;
  }

  Player.prototype.render = function (t, force) {
    var ep = this.ep;
    if (!ep) return;
    t = clamp(t, 0, ep.duration);
    if (!force && Math.abs(t - this.t) < 1e-4) return;
    if (force) this.still();
    var k = ep.turnAt(t), end = t >= ep.duration - 1e-3;
    if (k !== this.k) {      // only plain playback into the next turn animates; a seek just places things
      var smooth = !force && !REDUCED && this.k != null && k === this.k + 1 && t >= this.t && t - ep.turns[k].t_send < 0.3;
      this.k = k;
      this.showTurn(k, smooth, t);
    }
    this.t = t;
    var tu = ep.turns[k], i, s, txt;
    txt = secs(t);
    if (txt !== this.clockText) { this.clockText = txt; this.clock.textContent = txt; }
    this.snapChip.classList.toggle('on', t - tu.t_send < 1.1);
    if (this.snapN !== tu.n) { this.snapN = tu.n; this.snapChip.textContent = 'Snapshot ' + tu.n + ' → model'; }

    // the robot
    var rs = ['hold', 'Holding', ''];
    if (ep.success_at != null && t >= ep.success_at - 1e-3) rs = ['ok', 'Task completed', ''];
    else {
      for (i = 0; i < ep.blocks.length; i++) {
        s = ep.blocks[i];
        if (t >= s.start && t < s.end) { rs = [s.carried ? 'pre' : 'new', 'Step ' + s.id + (s.carried ? ' · prefilled' : ''), s.label]; break; }
      }
      if (rs[0] === 'hold' && ep.idle.some(function (iv) { return t >= iv[0] && t < iv[1]; })) rs = ['wait', 'Waiting for the model', ''];
    }
    var key = rs.join('|');
    if (key !== this.rkey) {
      this.rkey = key;
      this.robotChip.className = 'sf-chip sf-robot is-' + rs[0];
      this.robotChip.innerHTML = '<i></i><b>' + esc(rs[1]) + '</b>' + (rs[2] ? '<span>' + esc(rs[2]) + '</span>' : '');
    }

    // the model
    var ms;
    if (end && t < tu.t_reply) ms = ['idle', 'Stopped'];
    else if (t < tu.p0) ms = ['read', 'Reading request ' + tu.n];
    else if (t >= tu.t_reply) ms = ['idle', 'Reply complete'];
    else if (tu.pre.length && t >= tu.p1 && t < tu.c0) ms = ['read', 'Reading the prefilled steps'];
    else {
      var w = tu.steps.filter(function (x) { return !x.carried && t >= x.write0 && t < x.arrive; })[0];
      ms = ['write', w ? 'Writing step ' + w.id : t < tu.p1 ? 'Writing the progress line' : 'Writing'];
    }
    key = ms.join('|');
    if (key !== this.mkey) { this.mkey = key; this.status.className = 'sf-status is-' + ms[0]; this.status.innerHTML = '<i></i>' + esc(ms[1]); }

    var pf = clamp((t - tu.p0) / Math.max(1e-3, tu.p1 - tu.p0), 0, 1), writing = t >= tu.p0 && pf < 1 && !end;
    var n = t < tu.p0 ? 0 : Math.round(tu.progress.length * pf), pk = n + (writing ? 'w' : '');
    if (pk !== this.pc) {
      this.pc = pk;
      this.progText.textContent = tu.progress.slice(0, n);
      this.progCaret.hidden = !writing;
    }
    var bad = tu.failed && t >= tu.failed.end;
    var note = bad ? 'step ' + tu.failed.id + ' failed, the rest is dropped'
      : tu.fallback && t >= tu.t_reply ? 'the continuation changed a prefilled step and was discarded'
      : tu.pre.length ? stepsText(tu.pre) + ' prefilled from reply ' + (tu.n - 1) : tu.after || '';
    bad = bad || (!!tu.after && !tu.pre.length);
    if (note !== this.noteText) { this.noteText = note; this.note.textContent = note; this.note.className = 'sf-note' + (bad ? ' is-bad' : ''); }
    for (i = 0; i < this.rows.length; i++) {
      var r = this.rows[i], st = stepState(r.s, t, ep);
      s = r.s;
      if (st !== r.state) this.paint(r, st);
      var part = st === 'writing' || st === 'stopped';
      var c = st === 'hidden' ? 0 : part ? Math.round(s.plain.length * clamp((t - s.write0) / Math.max(1e-3, s.arrive - s.write0), 0, 1)) : s.plain.length;
      var ck = c + (st === 'writing' ? 'w' : '');
      if (ck !== r.chars) { r.chars = ck; r.text.innerHTML = typed(s, c); r.caret.hidden = st !== 'writing'; }
      if (st === 'running') r.bar.style.width = (100 * (t - s.start) / Math.max(1e-3, s.end - s.start)).toFixed(1) + '%';
    }
    this.tl.setTime(t);
    if (this.settle) { this.settle = false; void this.list.offsetHeight; this.list.classList.remove('no-anim'); }
  };
  // one frame: returns whether the player still needs frames
  Player.prototype.tick = function (now) {
    if (!this.ep || !this.visible) return false;
    var v = this.video;
    var t = this.pending != null ? this.pending : v.currentTime;
    // the end hold counts from when the video itself is at the end, and not while the timeline is held
    if (this.pending == null && !this.loading && !this.tl.held && (v.ended || v.currentTime >= this.ep.duration - 0.02)) {
      if (this.endedAt == null) this.endedAt = now;
      if (this.playing && now - this.endedAt > END_HOLD) this.open((this.pi + 1) % this.picks.length, false);
    }
    this.render(t);
    return this.playing || this.pending != null;
  };

  // one animation loop for all players, running only while one of them needs it
  var players = [];
  var loop = {
    running: false,
    wake: function () {
      if (loop.running) return;
      loop.running = true;
      requestAnimationFrame(function frame(now) {
        var need = false;
        players.forEach(function (p) { if (p.tick(now)) need = true; });
        if (need) requestAnimationFrame(frame); else loop.running = false;
      });
    }
  };

  // ---------------------------------------------------------------- wiring
  document.querySelectorAll('.sf').forEach(function (root) { players.push(new Player(root)); });
  var byRoot = function (e) { return players.filter(function (p) { return p.root === e.target || p.stage === e.target; })[0]; };
  if ('IntersectionObserver' in window) {
    var near = new IntersectionObserver(function (es) {             // load shortly before the player is reached
      es.forEach(function (e) { if (e.isIntersecting) byRoot(e).start(); });
    }, { rootMargin: '400px 0px' });
    var seen = new IntersectionObserver(function (es) {             // play only while the camera is on screen
      es.forEach(function (e) { var p = byRoot(e); p.visible = e.isIntersecting; p.resume(); });
    }, { threshold: 0.3 });
    players.forEach(function (p) { near.observe(p.root); seen.observe(p.stage); });
  } else players.forEach(function (p) { p.visible = true; p.start(); });
  document.addEventListener('visibilitychange', function () {       // time in a background tab is not end hold
    if (!document.hidden) players.forEach(function (p) { if (p.endedAt != null) p.endedAt = performance.now(); });
  });
  window.__sf = players;      // for the checks in the pipeline folder (tools/shot.mjs)
})();
