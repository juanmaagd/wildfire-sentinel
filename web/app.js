/* Wildfire Sentinel — map UI. Plain JS, no build step. */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const MOCK = params.get('mock') === '1';
  // Optional backend origin override, e.g. ?api=http://localhost:8000
  const API = (params.get('api') || '').replace(/\/$/, '');

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—');
  const coord = (s) => `${num(s.lat, 3)}, ${num(s.lon, 3)}`;
  const humanize = (k) => String(k).replace(/_/g, ' ').replace(/\b(m|ms|pct|c)\b$/, (u) => ({ m: '(m)', ms: '(m/s)', pct: '(%)', c: '(°C)' }[u])).replace(/^./, (c) => c.toUpperCase());
  const ms = (v) => (typeof v === 'number' ? `${Math.round(v)} ms` : '');
  const imgUrl = (u) => (!u ? null : /^https?:/.test(u) ? u : API + u);

  const MEMORY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="8" r="3"/><circle cx="10" cy="18" r="3"/><path d="M8.5 7.5l6.8 0.4M7.2 8.7l1.9 6.6M16.4 10.6l-4.2 5.4"/></svg>';
  const memoryBadge = () => `<span class="badge" title="Known site, answered from Neo4j memory — no model call">${MEMORY_ICON}memory</span>`;

  // ---------- Map ----------
  const map = L.map('map', { zoomControl: true, preferCanvas: false, worldCopyJump: false }).setView([36.5, 137.5], 5);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">出典：国土地理院</a>',
    minZoom: 4, maxZoom: 18, maxNativeZoom: 18,
  }).addTo(map);

  // ---------- State ----------
  let sites = new Map();
  let stream = null;
  let runToken = 0;
  let timer = null;
  let startedAt = 0;
  let selectedId = null;
  let lang = 'en';
  const badImages = new Set();
  const stats = { total: 0, industrial: 0, memory: 0, alerts: 0, jev: 0, elapsed: 0 };

  try { lang = localStorage.getItem('ws-lang') || 'en'; } catch (e) { /* storage unavailable */ }

  function site(id) {
    let s = sites.get(id);
    if (!s) { s = { id }; sites.set(id, s); }
    return s;
  }

  // ---------- Markers ----------
  function markerClass(s) {
    const c = ['mk'];
    const v = s.triage && s.triage.verdict;
    if (v === 'possible_fire') c.push('mk-fire');
    else if (v === 'industrial') c.push('mk-industrial');
    else if (v === 'water') c.push('mk-water');
    else if (v) c.push('mk-other');
    if (s.triage && s.triage.source === 'memory') c.push('mk-memory');
    const u = s.report && s.report.scores && s.report.scores.urgency;
    if (u >= 1 && u <= 5) c.push('u' + Math.round(u));
    if (s.id === selectedId) c.push('mk-selected');
    return c.join(' ');
  }

  function iconFor(s) {
    const fire = s.triage && s.triage.verdict === 'possible_fire';
    return L.divIcon({
      className: markerClass(s),
      html: (fire ? '<span class="ring"></span>' : '') + '<span class="dot"></span>',
      iconSize: fire ? [36, 36] : [16, 16],
    });
  }

  function renderMarker(s) {
    if (typeof s.lat !== 'number' || typeof s.lon !== 'number') return;
    const fire = s.triage && s.triage.verdict === 'possible_fire';
    if (!s.marker) {
      s.marker = L.marker([s.lat, s.lon], { icon: iconFor(s), keyboard: false, riseOnHover: true })
        .addTo(map)
        .on('click', () => select(s.id, false));
    } else {
      s.marker.setIcon(iconFor(s));
    }
    s.marker.setZIndexOffset(fire ? 1000 : (s.triage ? 0 : -100));
    const v = s.triage ? verdictLabel(s.triage.verdict) : 'Hotspot · triaging';
    s.marker.bindTooltip(`${esc(v)}${s.triage && s.triage.source === 'memory' ? ' · memory' : ''}<br><span style="font-family:var(--mono)">${coord(s)}</span>`, { direction: 'top', offset: [0, -8] });
  }

  function verdictLabel(v) {
    return { possible_fire: 'Possible fire', industrial: 'Industrial (filtered)', water: 'Water', other: 'Other' }[v] || String(v || 'Unknown');
  }

  // ---------- Stats ----------
  function setStat(id, value, html) {
    const el = $(id);
    const next = html != null ? html : String(value);
    if (el.innerHTML === next) return;
    el.innerHTML = next;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }
  function renderStats() {
    setStat('stTotal', stats.total);
    setStat('stIndustrial', stats.industrial);
    setStat('stMemory', stats.memory);
    setStat('stAlerts', stats.alerts);
    $('stAlerts').parentElement.classList.toggle('on', stats.alerts > 0);
    setStat('stJev', stats.jev);
    const el = $('stElapsed');
    el.innerHTML = `${stats.elapsed.toFixed(1)}<small>s</small>`;
  }

  // ---------- Feed ----------
  function feed(text, kind) {
    const li = document.createElement('li');
    const t = startedAt ? ((performance.now() - startedAt) / 1000).toFixed(1) + 's' : '';
    li.innerHTML = `<time>${esc(t.padStart(6, ' '))}</time><span class="${kind ? 'f-' + kind : ''}">${esc(text)}</span>`;
    li.title = text;
    const list = $('feed');
    list.prepend(li);
    while (list.children.length > 300) list.lastChild.remove();
  }

  // ---------- Alerts list ----------
  function renderAlerts() {
    const list = $('alerts');
    const alerts = [...sites.values()].filter((s) => s.triage && s.triage.verdict === 'possible_fire');
    if (!alerts.length) { list.innerHTML = '<li class="empty">No alerts yet.</li>'; return; }
    alerts.sort((a, b) => (urg(b) - urg(a)) || (a.alertAt - b.alertAt));
    list.innerHTML = alerts.map((s) => {
      const u = urg(s);
      const r = s.report;
      const title = r ? (lang === 'ja' ? r.headline_ja : r.headline_en) || r.headline_en || 'Possible fire' : 'Possible fire';
      const badge = u
        ? `<span class="alert-badge" style="background:var(--u${u})" title="Urgency ${u} of 5">${u}</span>`
        : `<span class="alert-badge pending" title="Report pending">NEW</span>`;
      const step = r ? `urgency ${u}/5` : s.probe ? 'writing report…' : 'probing…';
      return `<li class="alert" role="option" tabindex="0" data-id="${esc(s.id)}" aria-selected="${s.id === selectedId}">
        ${badge}
        <div class="alert-main">
          <div class="alert-title"${r && lang === 'ja' ? ' lang="ja"' : ''}>${esc(title)}</div>
          <div class="alert-meta"><span>${coord(s)}</span>${s.frp != null ? `<span>FRP ${num(s.frp, 1)} MW</span>` : ''}<span>${esc(step)}</span>${s.triage.source === 'memory' ? memoryBadge() : ''}</div>
        </div></li>`;
    }).join('');
  }
  const urg = (s) => (s.report && s.report.scores && Math.round(s.report.scores.urgency)) || 0;

  $('alerts').addEventListener('click', (e) => {
    const li = e.target.closest('.alert');
    if (li) select(li.dataset.id, true);
  });
  $('alerts').addEventListener('keydown', (e) => {
    const li = e.target.closest('.alert');
    if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(li.dataset.id, true); }
  });

  // ---------- Selection / detail ----------
  function select(id, fly) {
    const prev = selectedId;
    selectedId = id;
    if (prev && sites.get(prev)) renderMarker(sites.get(prev));
    const s = sites.get(id);
    if (!s) return;
    renderMarker(s);
    if (fly && typeof s.lat === 'number') map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 11), { duration: 0.8 });
    renderAlerts();
    renderDetail();
  }

  function pips(v, color) {
    const n = Math.max(0, Math.min(5, Math.round(Number(v) || 0)));
    return `<div class="pips" style="--pip:${color}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
  }

  // Normalizes {value, probability|confidence} | number | boolean | string to a row.
  function answerRow(key, a) {
    let value = a, p = null;
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      value = 'value' in a ? a.value : (a.answer != null ? a.answer : '');
      p = a.probability != null ? a.probability : (a.confidence != null ? a.confidence : null);
    } else if (typeof a === 'number' && a >= 0 && a <= 1) {
      p = a; value = a >= 0.5 ? 'yes' : 'no';
    }
    if (typeof value === 'boolean') value = value ? 'yes' : 'no';
    if (Array.isArray(value)) value = value.join(', ');
    if (value && typeof value === 'object') value = JSON.stringify(value);
    const pv = typeof p === 'number' ? Math.max(0, Math.min(1, p)) : null;
    return `<div class="row"><span class="row-k" title="${esc(key)}">${esc(humanize(key))}</span><span class="row-v" title="${esc(value)}">${esc(value)}</span>
      <span class="row-p">${pv != null ? `<span class="bar"><i style="width:${(pv * 100).toFixed(0)}%"></i></span><span class="bar-n">${pv.toFixed(2)}</span>` : ''}</span></div>`;
  }

  function listItems(arr) {
    return (arr || []).map((x) => `<li>${esc(typeof x === 'string' ? x : (x && (x.action || x.text || x.label || x.title)) || JSON.stringify(x))}</li>`).join('');
  }

  function renderDetail() {
    const box = $('detail');
    const s = sites.get(selectedId);
    if (!s) { box.innerHTML = '<p class="empty">Select an alert or a marker to see photos, Jev answers and the situation report.</p>'; return; }
    const t = s.triage, p = s.probe, r = s.report;
    const parts = [];

    // Header
    const headline = r ? (lang === 'ja' ? r.headline_ja : r.headline_en) || r.headline_en || r.headline_ja : (t ? verdictLabel(t.verdict) : 'Hotspot · triaging');
    const when = s.acq_date ? `${s.acq_date} ${String(s.acq_time || '').padStart(4, '0').replace(/^(\d\d)(\d\d)$/, '$1:$2')} UTC` : '';
    parts.push(`<div class="detail-head"><div>
        <h3${r && lang === 'ja' ? ' lang="ja"' : ''}>${esc(headline)}</h3>
        <div class="sub">${coord(s)}${when ? ' · ' + esc(when) : ''}${s.frp != null ? ' · FRP ' + num(s.frp, 1) + ' MW' : ''}${s.detections != null ? ' · ' + esc(s.detections) + ' detections' : ''}</div>
      </div>
      ${r ? `<div class="lang-toggle" role="group" aria-label="Brief language"><button type="button" data-lang="ja" aria-pressed="${lang === 'ja'}">JA</button><button type="button" data-lang="en" aria-pressed="${lang === 'en'}">EN</button></div>` : ''}
    </div>`);
    if (r) {
      const brief = lang === 'ja' ? r.brief_ja : r.brief_en;
      if (brief) parts.push(`<p class="brief"${lang === 'ja' ? ' lang="ja"' : ''}>${esc(brief)}</p>`);
    }

    // Scores
    if (r && r.scores) {
      const sc = r.scores;
      const items = [['urgency', 'Urgency'], ['danger', 'Danger'], ['spread_risk', 'Spread risk'], ['exposure', 'Exposure']];
      parts.push(`<div class="section"><h4><span>Situation report · ai&amp;</span><span class="lat">${ms(r.latency_ms)}</span></h4><div class="scores">${items.map(([k, label]) => {
        const v = sc[k];
        const n = Math.round(Number(v) || 0);
        return `<div><div class="score-lbl"><span>${label}</span><b>${v != null ? esc(v) + '/5' : '—'}</b></div>${pips(v, n ? `var(--u${Math.min(5, Math.max(1, n))})` : 'var(--line)')}</div>`;
      }).join('')}</div>
      ${r.confidence != null ? `<div class="score-lbl" style="margin-top:10px"><span>Confidence</span><span class="conf">${esc(typeof r.confidence === 'number' ? r.confidence.toFixed(2) : r.confidence)}</span></div>` : ''}</div>`);
    }

    if (r && r.recommended_actions && r.recommended_actions.length) {
      parts.push(`<div class="section"><h4>Recommended actions</h4><ul class="list actions">${listItems(r.recommended_actions)}</ul></div>`);
    }

    // Images
    const imgs = [];
    if (p && p.images) {
      [['close', 'Close · z16'], ['wide', 'Wide · z14'], ['satellite', 'Satellite']].forEach(([k, label]) => { if (p.images[k]) imgs.push([p.images[k], label]); });
      Object.keys(p.images).forEach((k) => { if (!['close', 'wide', 'satellite'].includes(k) && p.images[k]) imgs.push([p.images[k], humanize(k)]); });
    }
    if (t && t.image_url && !imgs.some(([u]) => u === t.image_url)) imgs.unshift([t.image_url, 'Aerial · triage']);
    const goodImgs = imgs.filter(([u]) => !badImages.has(imgUrl(u)));
    if (goodImgs.length) {
      parts.push(`<div class="section"><h4>Imagery</h4><div class="imgs">${goodImgs.map(([u, label]) => `<figure><a href="${esc(imgUrl(u))}" target="_blank" rel="noopener"><img src="${esc(imgUrl(u))}" alt="${esc(label)}" loading="lazy" onerror="WS.badImage(this)"></a><figcaption>${esc(label)}</figcaption></figure>`).join('')}</div></div>`);
    }

    // Triage
    if (t) {
      const sig = t.signals || {};
      parts.push(`<div class="section"><h4><span>Jev triage · ${esc(verdictLabel(t.verdict))} ${t.source === 'memory' ? memoryBadge() : ''}</span><span class="lat">${t.source === 'memory' ? 'memory · ' : 'Jev · '}${ms(t.latency_ms)}</span></h4>
        <div class="rows">${t.confidence != null ? answerRow('confidence', { value: t.verdict, probability: t.confidence }) : ''}${Object.keys(sig).map((k) => answerRow(k, sig[k])).join('')}</div>
        ${t.source === 'memory' ? '<p class="imgs-none" style="margin:8px 0 0">Known site — Neo4j remembered this location; no model call was made.</p>' : ''}</div>`);
    } else {
      parts.push('<div class="section"><p class="imgs-none">Waiting for Jev triage…</p></div>');
    }

    // Probe
    if (p && p.answers) {
      parts.push(`<div class="section"><h4><span>Jev deep probe · ${Object.keys(p.answers).length} questions</span><span class="lat">${ms(p.latency_ms)}</span></h4>
        <div class="rows">${Object.keys(p.answers).map((k) => answerRow(k, p.answers[k])).join('')}</div></div>`);
    } else if (t && t.verdict === 'possible_fire') {
      parts.push('<div class="section"><p class="imgs-none">Deep probe running…</p></div>');
    }

    if (r && r.weather && typeof r.weather === 'object' && Object.keys(r.weather).length) {
      parts.push(`<div class="section"><h4>Weather</h4><div class="kv">${Object.keys(r.weather).map((k) => {
        const v = r.weather[k];
        return `<div><span>${esc(humanize(k))}</span><b>${esc(v && typeof v === 'object' ? JSON.stringify(v) : v)}</b></div>`;
      }).join('')}</div></div>`);
    }
    if (r && r.key_evidence && r.key_evidence.length) parts.push(`<div class="section"><h4>Key evidence</h4><ul class="list">${listItems(r.key_evidence)}</ul></div>`);
    if (r && r.unknowns && r.unknowns.length) parts.push(`<div class="section"><h4>Unknowns</h4><ul class="list">${listItems(r.unknowns)}</ul></div>`);
    if (r && r.generated_at) parts.push(`<p class="sub" style="margin-top:14px">Report generated ${esc(r.generated_at)}</p>`);

    box.innerHTML = parts.join('');
    // Jump to the top when a different site is shown or its report first arrives.
    const key = s.id + (r ? ':r' : '');
    if (box.dataset.key !== key) { box.parentElement.scrollTop = 0; box.dataset.key = key; }
  }

  $('detail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b) return;
    lang = b.dataset.lang;
    try { localStorage.setItem('ws-lang', lang); } catch (err) { /* ignore */ }
    renderDetail();
    renderAlerts();
  });

  // ---------- Event handlers (shared by SSE and mock) ----------
  const handlers = {
    hotspot(d) {
      const s = site(d.id);
      const isNew = !s.hotspot;
      Object.assign(s, { hotspot: d, lat: d.lat, lon: d.lon, frp: d.frp, acq_date: d.acq_date, acq_time: d.acq_time, detections: d.detections });
      if (isNew) stats.total += 1;
      renderMarker(s);
    },
    triage(d) {
      const s = site(d.id);
      const prev = s.triage;
      s.triage = d;
      if (!prev) {
        if (d.verdict === 'industrial') stats.industrial += 1;
        if (d.source === 'memory') stats.memory += 1;
        if (d.source !== 'memory') stats.jev += 1;
        if (d.verdict === 'possible_fire') stats.alerts += 1;
      }
      renderMarker(s);
      if (d.source === 'memory') feed(`Memory hit: ${verdictLabel(d.verdict)} site ${coord(s)} · ${ms(d.latency_ms)}`, 'memory');
      else feed(`Jev → ${d.verdict} (${num(d.confidence)}) · ${ms(d.latency_ms)}`, d.verdict === 'possible_fire' ? null : null);
      if (d.verdict === 'possible_fire') {
        s.alertAt = performance.now();
        feed(`ALERT possible fire at ${coord(s)}`, 'alert');
        renderAlerts();
        if (!selectedId || !(sites.get(selectedId) || {}).report) select(s.id, false);
      }
      if (s.id === selectedId) renderDetail();
    },
    probe(d) {
      const s = site(d.id);
      if (!s.probe) stats.jev += 1;
      s.probe = d;
      feed(`Jev deep probe: ${Object.keys(d.answers || {}).length} answers · ${ms(d.latency_ms)}`, 'sys');
      renderAlerts();
      if (s.id === selectedId) renderDetail();
    },
    report(d) {
      const s = site(d.id);
      s.report = d;
      const u = d.scores && d.scores.urgency;
      feed(`ai& report: urgency ${u != null ? u : '?'}/5${d.latency_ms ? ' · ' + ms(d.latency_ms) : ''}`, 'report');
      renderMarker(s);
      renderAlerts();
      if (!selectedId || selectedId === s.id || !(sites.get(selectedId) || {}).report) select(s.id, false);
      else if (s.id === selectedId) renderDetail();
    },
    summary(d) {
      if (typeof d.total === 'number') stats.total = d.total;
      if (typeof d.filtered_industrial === 'number') stats.industrial = d.filtered_industrial;
      if (typeof d.memory_hits === 'number') stats.memory = d.memory_hits;
      if (typeof d.alerts === 'number') stats.alerts = d.alerts;
      if (typeof d.jev_calls === 'number') stats.jev = d.jev_calls;
      if (typeof d.elapsed_s === 'number') stats.elapsed = d.elapsed_s;
      stopTimer();
      feed(`Summary: ${d.total} hotspots${d.in_japan != null ? ` (${d.in_japan} in Japan)` : ''}, ${d.filtered_industrial} industrial filtered, ${d.alerts} alert(s), ${d.jev_calls} Jev calls in ${num(d.elapsed_s, 1)} s`, 'sys');
    },
    done() {
      finish('done', 'Run complete');
    },
  };

  function dispatch(type, data) {
    const h = handlers[type];
    if (!h) return;
    try { h(data || {}); } catch (err) { console.error('handler', type, err); feed(`UI error on ${type}: ${err.message}`, 'err'); }
    renderStats();
  }

  // ---------- Run control ----------
  function setStatus(state, text) {
    $('runStatus').dataset.state = state;
    $('runStatusText').textContent = text;
  }
  function startTimer() {
    startedAt = performance.now();
    stopTimer();
    timer = setInterval(() => { stats.elapsed = (performance.now() - startedAt) / 1000; renderStats(); }, 100);
  }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  function finish(state, text) {
    if (stream) { stream.close(); stream = null; }
    stopTimer();
    renderStats();
    setStatus(state, text);
    document.querySelectorAll('.mode-btn').forEach((b) => { b.disabled = false; });
    if (state === 'done') feed(text, 'sys');
  }

  function reset() {
    runToken += 1;
    if (stream) { stream.close(); stream = null; }
    stopTimer();
    sites.forEach((s) => s.marker && s.marker.remove());
    sites = new Map();
    selectedId = null;
    Object.keys(stats).forEach((k) => { stats[k] = 0; });
    $('feed').innerHTML = '';
    renderAlerts();
    renderDetail();
    renderStats();
    map.setView([36.5, 137.5], 5);
  }

  function start(mode) {
    reset();
    document.querySelectorAll('.mode-btn').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); b.disabled = true; });
    const label = mode === 'live' ? 'Live · today' : 'Replay · Ofunato 2025';
    setStatus('running', `${label}${MOCK ? ' (mock)' : ''} — streaming…`);
    startTimer();
    feed(`Run started: ${label}${MOCK ? ' (mock data)' : ''}`, 'sys');
    if (MOCK) return runMock(runToken);

    const es = new EventSource(`${API}/api/run?mode=${encodeURIComponent(mode)}`);
    stream = es;
    es.addEventListener('day', (e) => {
      const d = JSON.parse(e.data);
      setStatus('running', `${label} — day ${d.index}/${d.of} · ${d.date}`);
      feed(`── Day ${d.index}/${d.of}: ${d.date} ──`, 'sys');
    });
    es.addEventListener('analysis_error', (e) => feed(`Analysis failed: ${JSON.parse(e.data).message}`, 'err'));
    ['hotspot', 'triage', 'probe', 'report', 'summary', 'done'].forEach((type) => {
      es.addEventListener(type, (e) => {
        let data = {};
        try { data = e.data ? JSON.parse(e.data) : {}; } catch (err) { feed(`Bad ${type} payload`, 'err'); return; }
        dispatch(type, data);
      });
    });
    // Server-sent "error" events carry data; connection failures do not.
    es.addEventListener('error', (e) => {
      if (e.data) { feed(`Server error: ${e.data}`, 'err'); return; }
      if (stream !== es) return;
      // Close instead of letting EventSource auto-reconnect (that would start a new run).
      finish('error', 'Stream closed — backend unreachable or run ended without "done"');
      feed('Stream closed unexpectedly', 'err');
    });
  }

  async function runMock(token) {
    let events;
    try {
      const res = await fetch('mock-events.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      events = await res.json();
    } catch (err) {
      finish('error', 'Could not load mock-events.json (serve web/ over http)');
      feed(`Mock load failed: ${err.message}`, 'err');
      return;
    }
    for (const ev of events) {
      const wait = typeof ev.delay === 'number' ? ev.delay : 150 + Math.random() * 250;
      await new Promise((r) => setTimeout(r, wait));
      if (token !== runToken) return; // a new run started
      dispatch(ev.event, ev.data);
    }
    if (token === runToken && $('runStatus').dataset.state === 'running') finish('done', 'Run complete');
  }

  document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => start(b.dataset.mode)));

  renderStats();
  if (MOCK) {
    setStatus('idle', 'Mock mode — starting replay…');
    setTimeout(() => start('replay'), 600);
  }

  // Broken images are hidden and never requested again in this page session.
  function badImage(img) {
    badImages.add(img.getAttribute('src'));
    const sec = img.closest('.section');
    img.closest('figure').remove();
    if (sec && !sec.querySelector('figure')) sec.remove();
  }

  // Exposed for inline handlers and console debugging.
  window.WS = { start, dispatch, badImage, sites: () => sites };
})();
