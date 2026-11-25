/* RoboTwin 2.0 episode browser (episodes/index.html).
   Data: the episode dataset on Hugging Face; ?data=<base url> points the page at another copy. */
(() => {
  'use strict';
  const BASE = (new URLSearchParams(location.search).get('data') ||
    'https://huggingface.co/datasets/Hugo-AGI/nanoAstra-RoboTwin-episodes/resolve/main').replace(/\/$/, '');
  const FPS = 5;                       // one frame per executed step, plus the initial frame
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const words = t => t.replace(/_/g, ' ').replace(/\brgb\b/, 'RGB').replace(/^./, c => c.toUpperCase());
  const pad3 = n => String(n).padStart(3, '0');
  const dir = (task, ep) => `${BASE}/${task}/episode_${pad3(ep)}`;
  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  const CAMERAS = ['overview', 'left_camera', 'right_camera'];

  // ---------------------------------------------------------------- overview grid, from the outcomes inlined in the page
  // (index.json of the dataset, one string per task: 1 success, 0 failure, - no episode)
  const OUTCOMES = JSON.parse($('#ep-index').textContent);
  const grid = $('.ep-grid');
  grid.innerHTML = Object.keys(OUTCOMES).map(task => {
    const s = OUTCOMES[task], name = esc(words(task));
    const cells = [...s].map((c, k) => c === '-' ? '' : `<a class="ep-cell${c === '1' ? ' ok' : ''}" href="#${task}/${k}" data-key="${task}/${k}" title="${name}, episode ${k}: ${c === '1' ? 'success' : 'failure'}"></a>`);
    return `<div class="ep-row"><span class="ep-task">${name}</span><span class="ep-cells">${cells.join('')}</span><span class="ep-count">${s.split('1').length - 1}/${s.replace(/-/g, '').length}</span></div>`;
  }).join('');

  // episode.json is small (about 10 KB compressed); fetch it while the pointer rests on a cell
  const cache = new Map();
  const load = key => {
    if (!cache.has(key)) {
      const [task, ep] = key.split('/');
      cache.set(key, fetch(`${dir(task, +ep)}/episode.json`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .catch(e => { cache.delete(key); throw e; }));
    }
    return cache.get(key);
  };
  let hover = 0;
  grid.addEventListener('pointerover', ev => {
    const c = ev.target.closest('.ep-cell'); clearTimeout(hover);
    if (c) hover = setTimeout(() => load(c.dataset.key).catch(() => {}), 120);
  });

  // ---------------------------------------------------------------- episode player
  const view = $('#episode'), video = $('video', view), side = $('.ep-side', view);
  const tlbar = $('.ep-tlbar', view), headLine = $('.ep-head-line', view);
  let E = null, segs = [], cur = -1, curStep = -2, rate = 1, loadToken = 0;

  function parseReply(text) {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    try { return JSON.parse(m ? m[1] : text); } catch { return null; }
  }

  // "- step 2: right [...]: FAILED (note)" -> {n, status, note}
  function parseResult(line) {
    const m = line.match(/^- step (\d+): .*?: (ok|FAILED|SKIPPED|INVALID|nothing was executed)(?: \((.*)\))?$/s);
    return m ? { n: +m[1], status: m[2], note: m[3] || '' } : null;
  }

  function prepare(ep) {
    for (const t of ep.turns) {
      t.parsed = parseReply(t.reply);
      t.res = t.results.map(parseResult);
      // executed steps in order; the k-th one is shown by frame video_s[0]*FPS + k
      const executed = [];
      for (const r of t.res) if (r && r.status !== 'SKIPPED' && !executed.includes(r.n)) executed.push(r.n);
      t.executed = executed;
      t.f0 = Math.round(t.video_s[0] * FPS);
      t.f1 = Math.round(t.video_s[1] * FPS);
    }
    ep.frames = ep.turns.length ? ep.turns[ep.turns.length - 1].f1 + 1 : 1;
    return ep;
  }

  function open(task, epNum, picked = true) {
    const token = ++loadToken, d = dir(task, epNum), ok = OUTCOMES[task][epNum] === '1';
    view.hidden = false;
    document.querySelectorAll('.ep-cell.cur').forEach(c => c.classList.remove('cur'));
    const cell = grid.querySelector(`.ep-cell[data-key="${task}/${epNum}"]`);
    if (cell) cell.classList.add('cur');
    // the recording, the first turn's images and the episode data load together
    E = null; cur = -1; curStep = -2; segs = []; lastFrame = -1;
    video.pause();
    video.preload = picked ? 'auto' : 'metadata';   // the default episode loads its recording only when played
    video.src = `${d}/video.mp4`;
    video.playbackRate = rate;
    setImages(d, 1);
    $('.ep-title h3', view).textContent = `${words(task)} · episode ${epNum}`;
    const badge = $('.ep-badge', view);
    badge.textContent = ok ? 'Success' : 'Failure';
    badge.className = `ep-badge ${ok ? 'ok' : 'bad'}`;
    $('.ep-instr', view).textContent = '\u00a0';
    $('.sf-progt', side).textContent = '';
    $('.ep-steps', side).innerHTML = '';
    $('.ep-turnnum', view).textContent = '';
    tlbar.innerHTML = '';
    if (picked) view.scrollIntoView({ behavior: 'smooth', block: 'start' });
    load(`${task}/${epNum}`).then(ep => {
      if (token !== loadToken) return;
      E = prepare(ep);
      E.dir = d;
      $('.ep-instr', view).textContent = ep.instruction;
      drawTimeline();
      showTurn(0);
      seekFrame(E.turns[0] ? E.turns[0].f0 : 0);
      setPlaying(false);
    }).catch(() => { if (token === loadToken) $('.ep-instr', view).textContent = 'This episode could not be loaded.'; });
  }

  const thumbs = [...side.querySelectorAll('.sf-img')];
  function setImages(d, turn) {
    thumbs.forEach((b, k) => {
      const src = `${d}/turn${pad3(turn)}_${CAMERAS[k]}.jpg`;
      b.dataset.src = src;
      const img = b.firstElementChild;
      if (img.getAttribute('src') !== src) img.src = src;
    });
  }

  function drawTimeline() {
    const n = E.frames - 1 || 1;
    tlbar.innerHTML = E.turns.map((t, i) => {
      return `<button type="button" class="ep-seg" data-i="${i}" style="left:${100 * t.f0 / n}%;width:${100 * (t.f1 - t.f0) / n}%" title="Turn ${t.turn}"><i></i></button>`;
    }).join('');
    segs = [...tlbar.querySelectorAll('.ep-seg i')];
  }

  function turnAt(frame) {
    const T = E.turns;
    for (let i = 0; i < T.length; i++) if (frame < T[i].f1) return frame >= T[i].f0 ? i : Math.max(0, i - 1);
    return T.length - 1;
  }

  function stepCard(step, n, results, state) {
    if (step === 'done' || (typeof step === 'string')) {
      return `<li class="ep-step${state}"><span class="sf-id">${n}</span><span class="ep-cmds"><b>${esc(step)}</b></span><span class="ep-st"></span></li>`;
    }
    const arms = ['left', 'right'].filter(a => Array.isArray(step[a]) && !(step[a].length === 1 && step[a][0] === 'wait'));
    const cmds = arms.length
      ? arms.map(a => `<span class="ep-arm"><b>${a === 'left' ? 'L' : 'R'}</b> ${step[a].map(esc).join('<span class="sf-sep"> · </span>')}</span>`).join('')
      : '<span class="ep-arm"><b>both</b> wait</span>';
    const rs = results.filter(r => r && r.n === n);
    const status = rs.some(r => r.status === 'FAILED') ? 'FAILED' : rs.some(r => r.status === 'SKIPPED') ? 'SKIPPED'
      : rs.some(r => r.status === 'INVALID') ? 'INVALID' : rs.length ? 'ok' : '';
    // only the reason of a failure; the other notes (gripper readings) are in the next turn's text
    const notes = [...new Set(rs.filter(r => r.status === 'FAILED' || r.status === 'INVALID').map(r => r.note).filter(Boolean))];
    const cls = status === 'FAILED' || status === 'INVALID' ? ' is-failed' : status === 'SKIPPED' ? ' is-skipped' : '';
    const word = status.toLowerCase();
    return `<li class="ep-step${cls}${state}"><span class="sf-id">${n}</span><span class="ep-cmds">${cmds}${
      notes.length ? `<span class="ep-note" title="${notes.map(esc).join('; ')}">${notes.map(esc).join('; ')}</span>` : ''
    }</span><span class="ep-st">${word}</span></li>`;
  }

  function showTurn(i, step = -1) {
    if (!E || !E.turns.length) return;
    const t = E.turns[i];
    if (i !== cur) {
      cur = i;
      $('.ep-turnnum', view).textContent = `Turn ${t.turn} / ${E.turns.length}`;
      setImages(E.dir, t.turn);
      const nxt = E.turns[i + 1];             // warm the next turn's images
      if (nxt) nxt.images.forEach(f => { new Image().src = `${E.dir}/${f}`; });
      $('.sf-progt', side).textContent = t.parsed && t.parsed.progress || '';
      segs.forEach((el, k) => el.parentNode.classList.toggle('cur', k === i));
      $('.ep-prev', view).disabled = i === 0;
      $('.ep-next', view).disabled = i === E.turns.length - 1;
      curStep = -2;
    }
    if (step !== curStep) {
      curStep = step;
      const steps = t.parsed && Array.isArray(t.parsed.steps) ? t.parsed.steps : null;
      const list = $('.ep-steps', side);
      list.innerHTML = steps
        ? steps.map((s, k) => stepCard(s, k + 1, t.res, k + 1 === step ? ' is-running' : '')).join('')
        : `<li class="ep-raw"><pre>${esc(t.reply)}</pre></li>`;
      // keep the running step in view when the list scrolls (wide screens); never scroll the page
      const run = list.querySelector('.is-running');
      if (step < 1) list.scrollTop = 0;
      else if (run && list.scrollHeight > list.clientHeight) {
        const lr = list.getBoundingClientRect(), rr = run.getBoundingClientRect();
        if (rr.bottom > lr.bottom) list.scrollTop += rr.bottom - lr.bottom + 4;
        else if (rr.top < lr.top) list.scrollTop -= lr.top - rr.top + 4;
      }
    }
  }

  function frameOf(time) { return Math.min(E.frames - 1, Math.floor(time * FPS + 1e-3)); }
  function seekFrame(f) { video.currentTime = (f + 0.5) / FPS; lastFrame = -1; sync(); }

  let lastFrame = -1;
  function sync() {
    if (!E) return;
    const f = frameOf(video.currentTime);
    if (f === lastFrame) return;           // the recording has 5 frames a second; redraw only when it changes
    lastFrame = f;
    const i = turnAt(f), t = E.turns[i];
    const k = f - t.f0;
    showTurn(i, k >= 1 && k <= t.executed.length ? t.executed[k - 1] : -1);
    const n = E.frames - 1 || 1;
    headLine.style.left = `${100 * Math.min(f, n) / n}%`;
    // the played part fills the turn segments; the current turn's segment is raised
    segs.forEach((el, k) => {
      const u = E.turns[k];
      el.style.width = `${k < i ? 100 : k > i ? 0 : u.f1 > u.f0 ? 100 * Math.min(1, (f - u.f0) / (u.f1 - u.f0)) : 100}%`;
    });
  }

  function setPlaying(on) {
    $('.ep-play', view).innerHTML = on ? ICON_PAUSE : ICON_PLAY;
    $('.ep-play', view).setAttribute('aria-label', on ? 'Pause' : 'Play');
    $('.ep-vid', view).classList.toggle('is-paused', !on);
  }

  let raf = 0;
  const tick = () => { sync(); raf = video.paused ? 0 : requestAnimationFrame(tick); };
  video.addEventListener('play', () => { setPlaying(true); if (!raf) raf = requestAnimationFrame(tick); });
  video.addEventListener('pause', () => { setPlaying(false); sync(); });
  video.addEventListener('ended', () => setPlaying(false));
  video.addEventListener('seeked', sync);
  const toggle = () => { if (!E) return; if (video.paused) { if (video.ended) seekFrame(0); video.play(); } else video.pause(); };
  video.addEventListener('click', toggle);
  $('.ep-play', view).addEventListener('click', toggle);
  const step = d => { if (!E || cur < 0) return; video.pause(); seekFrame(E.turns[Math.max(0, Math.min(E.turns.length - 1, cur + d))].f0); };
  $('.ep-prev', view).addEventListener('click', () => step(-1));
  $('.ep-next', view).addEventListener('click', () => step(1));
  $('.sf-seg', view).addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    rate = +b.dataset.rate; video.playbackRate = rate;
    $('.sf-seg', view).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
  });
  $('.ep-tl', view).addEventListener('click', ev => {
    if (!E) return;
    const seg = ev.target.closest('.ep-seg');
    if (seg) { video.pause(); seekFrame(E.turns[+seg.dataset.i].f0); return; }
    const r = tlbar.getBoundingClientRect();
    seekFrame(Math.round((ev.clientX - r.left) / r.width * (E.frames - 1)));
  });
  document.addEventListener('keydown', ev => {
    if (view.hidden || !E || !lb.hidden || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const el = ev.target instanceof Element ? ev.target : null;
    if (el && el.closest('input, textarea, select')) return;
    if (ev.key === 'ArrowLeft') step(-1);
    else if (ev.key === 'ArrowRight') step(1);
    // a focused button or link already acts on Space itself
    else if (ev.key === ' ' && !(el && el.closest('button, a'))) { ev.preventDefault(); toggle(); }
  });

  // ---------------------------------------------------------------- lightbox: images and the prompt
  const lb = $('.sf-lb'), lbBody = $('.ep-lbbody');
  const openLb = html => { lbBody.innerHTML = html; lb.hidden = false; document.documentElement.classList.add('sf-lock'); };
  const closeLb = () => { lb.hidden = true; lbBody.innerHTML = ''; document.documentElement.classList.remove('sf-lock'); };
  lb.addEventListener('click', ev => { if (ev.target === lb || ev.target.closest('.sf-x')) closeLb(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !lb.hidden) closeLb(); });
  side.addEventListener('click', ev => {
    const img = ev.target.closest('.sf-img');
    if (img) { video.pause(); openLb(`<img src="${img.dataset.src}" alt="">`); return; }
    if (ev.target.closest('.sf-prompt') && E) {
      video.pause();
      const t = E.turns[cur];
      openLb(`<h4>System prompt</h4><pre>${esc(E.system_prompt)}</pre><h4>Turn ${t.turn}</h4><pre>${esc(t.prompt)}</pre>` +
        (cur > 0 ? '<p>The request also carries the previous turn\'s message (without its images) and reply.</p>' : ''));
    }
  });

  // #<task>/<episode>; without one, a short successful episode is shown so the page opens on a replay
  const DEFAULT = ['place_container_plate', 8];
  function route() {
    const m = location.hash.match(/^#([a-z0-9_]+)\/(\d+)$/);
    if (m && OUTCOMES[m[1]] && /[01]/.test(OUTCOMES[m[1]][+m[2]] || '')) open(m[1], +m[2]);
    else if (!E && loadToken === 0) open(DEFAULT[0], DEFAULT[1], false);
  }
  window.addEventListener('hashchange', route);
  route();
})();
