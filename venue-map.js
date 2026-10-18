'use strict';
// Bundled public geometry; colors and visit checks come only from this device.
(() => {
  const mapColors = ['red','orange','yellow','green','blue'];
  const fills = {red:'#f87171',orange:'#fb923c',yellow:'#facc15',green:'#4ade80',blue:'#60a5fa'};
  let viewId = 'all', zoom = 1, fitted = true, initialized = false;
  let selectedSpace = '', focusedSpace = '', validData = null;

  function validateMap(data, rows) {
    if (!data || data.schema !== 'kansai-comitia-venue-v1' || data.event !== 77 ||
        data.catalogSpaces !== rows.length || !Array.isArray(data.spots) || data.spots.length !== rows.length ||
        ![data.width,data.height].every(n => Number.isFinite(n) && n > 0) ||
        data.image !== './map/venue77.png' || !Array.isArray(data.views) || !data.views.length) {
      throw new Error('一覧と配置図の対応を確認できませんでした。カタログを更新してください。');
    }
    const spaces = new Set(rows.map(c => c.space)), seen = new Set(), views = new Set();
    const validBox = box => [box.x,box.y,box.w,box.h].every(Number.isFinite) &&
      box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 &&
      box.x + box.w <= data.width + .01 && box.y + box.h <= data.height + .01;
    for (const spot of data.spots) {
      if (!spaces.has(spot.space) || seen.has(spot.space) || !validBox(spot)) throw new Error('配置図の区画に不整合があります。公式PDFをご確認ください。');
      seen.add(spot.space);
    }
    for (const view of data.views) {
      if (!view.id || views.has(view.id) || !validBox(view)) throw new Error('配置図の表示範囲を確認できませんでした。');
      views.add(view.id);
    }
    return data;
  }
  function currentView() { return validData.views.find(v => v.id === viewId) || validData.views[0]; }
  function visibleSpots() {
    const v = currentView();
    return validData.spots.filter(s => s.x >= v.x && s.y >= v.y && s.x+s.w <= v.x+v.w+.01 && s.y+s.h <= v.y+v.h+.01);
  }
  function shownColors() { return Array.isArray(prefs.mapColors) ? mapColors.filter(k => prefs.mapColors.includes(k)) : mapColors; }
  function showPage(map) {
    $('catalogPage').hidden = map; $('mapPage').hidden = !map;
    $('catalogTab').setAttribute('aria-pressed',String(!map)); $('mapTab').setAttribute('aria-pressed',String(map));
  }
  function renderControls(rows, spots) {
    $('mapViews').innerHTML = validData.views.map(v => `<button data-map-view="${esc(v.id)}" aria-pressed="${v.id===viewId}">${esc(v.label)}</button>`).join('');
    const active = shownColors(), counts = Object.fromEntries(mapColors.map(k => [k,0]));
    for (const c of rows.values()) if (c.state.color in counts) counts[c.state.color]++;
    $('mapColors').innerHTML = mapColors.map(k => `<button class="c-${k}" data-map-color="${k}" aria-pressed="${active.includes(k)}" aria-label="${colorLabel[k]}の着色を${active.includes(k)?'非表示':'表示'}にする">${colorLabel[k]} ${counts[k]}</button>`).join('');
    const count = spots.filter(s => active.includes(rows.get(s.space).state.color)).length;
    $('mapMarkerCount').textContent = `この図の着色 ${count}件 ／ 対応するサークル ${spots.length}件`;
    $('mapZoomLabel').textContent = Math.round(zoom*100) + '%';
    $('mapZoomOut').disabled = zoom <= .15; $('mapZoomIn').disabled = zoom >= 12;
  }
  function draw() {
    if (!validData) return;
    const v = currentView(), spots = visibleSpots(), rows = new Map(circles.map(c => [c.space,c])), active = shownColors();
    $('mapStage').style.width = v.w*zoom+'px'; $('mapStage').style.height = v.h*zoom+'px';
    const markers = spots.map(s => {
      const c = rows.get(s.space), colored = active.includes(c.state.color), visited = c.state.visited;
      const label = `${c.space} ${c.name}、${colorLabel[c.state.color]}${visited?'、訪問済み':''}`;
      return `<rect class="map-spot${colored?' colored':''}${c.state.reviewed?' is-reviewed':''}${focusedSpace===s.space?' is-focused':''}" data-map-space="${esc(s.space)}" role="button" tabindex="0" aria-label="${esc(label)}" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${colored?fills[c.state.color]:'#fff'}" fill-opacity="${colored?0.68:0.001}"><title>${esc(label)}</title></rect>` +
        (visited ? `<text class="map-visit-check" x="${s.x+s.w/2}" y="${s.y+s.h/2}" font-size="${Math.min(s.w,s.h)*.86}">✓</text>` : '');
    }).join('');
    $('mapStage').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${v.x} ${v.y} ${v.w} ${v.h}" aria-label="関西コミティア77 ${esc(v.label)} 配置図"><image href="${esc(validData.image)}" x="0" y="0" width="${validData.width}" height="${validData.height}" pointer-events="none"/>${markers}</svg>`;
    $('mapStage').querySelector('image').addEventListener('error', () => {
      $('mapStatus').textContent = '配置図画像を読み込めませんでした。オンラインでアプリを開き直すか、公式の配置図をご確認ください。';
    });
    renderControls(rows,spots);
  }
  function refresh() {
    if ($('mapPage').hidden) return;
    try {
      validData = validateMap(window.VENUE_MAP_DATA,circles);
      if (!validData.views.some(v => v.id === viewId)) viewId = validData.views[0].id;
      $('mapReady').hidden = false;
      $('mapStatus').textContent = `公式参加案内書10ページの配置図 · 全${circles.length.toLocaleString('ja-JP')}件と照合済み`;
      draw();
      if ($('mapDialog').open) renderDialog();
    } catch (error) {
      validData = null; $('mapReady').hidden = true; $('mapStage').innerHTML = ''; $('mapStatus').textContent = error.message;
    }
  }
  function fit() {
    if (!validData) return;
    zoom = Math.max(.15,Math.min(12,($('mapScroll').clientWidth-2)/currentView().w)); fitted = true;
    draw(); $('mapScroll').scrollTo({left:0,top:0});
  }
  function setZoom(next, cx = $('mapScroll').clientWidth/2, cy = $('mapScroll').clientHeight/2) {
    if (!validData) return;
    const scroll = $('mapScroll'), previous = zoom;
    zoom = Math.max(.15,Math.min(12,next)); fitted = false;
    const left = (scroll.scrollLeft+cx)*zoom/previous-cx, top = (scroll.scrollTop+cy)*zoom/previous-cy;
    draw(); scroll.scrollTo({left,top});
  }
  function showMap(space = '') {
    showPage(true); refresh(); if (!validData) return;
    if (space) {
      const spot = validData.spots.find(s => s.space === normSpace(space)); if (!spot) return;
      viewId = /^[OP]-/.test(spot.space) ? 'annex' : 'main'; zoom = 6; fitted = false; focusedSpace = spot.space;
      draw(); const v = currentView(), scroll = $('mapScroll');
      scroll.scrollTo({left:(spot.x-v.x+spot.w/2)*zoom-scroll.clientWidth/2,top:(spot.y-v.y+spot.h/2)*zoom-scroll.clientHeight/2});
    } else if (!initialized) { fit(); }
    initialized = true;
    window.scrollTo({top:0});
  }
  function renderDialog() {
    const c = circles.find(c => c.space === selectedSpace); if (!c) return;
    $('mapDialogSpace').textContent = c.space; $('mapDialogName').textContent = c.name;
    $('mapDialogLinks').innerHTML = link(c.web,'Web',c.status?.web)+link(c.pixiv,'pixiv',c.status?.pixiv)+link(c.x,'X',c.status?.x);
    $('mapDialogExtras').innerHTML = (c.extras||[]).filter(e=>safeUrl(e.url)).map(e=>`<a href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">${esc(e.label||extrasLabel[e.kind]||'関連リンク')} ↗</a>`).join('');
    $('mapDialogColors').innerHTML = colors.map(k=>`<button class="chip c-${k}${c.state.color===k?' on':''}" data-map-set-color="${k}" aria-pressed="${c.state.color===k}" aria-label="${esc(c.name)}を${colorLabel[k]}にする">${colorLabel[k]}</button>`).join('');
    $('mapDialogVisited').checked = c.state.visited;
    $('mapDialogMemo').textContent = [c.state.item&&'購入予定：'+c.state.item,c.state.budget&&'予算：'+c.state.budget,c.state.memo].filter(Boolean).join('\n');
  }
  function openSpot(space) {
    const c = circles.find(c => c.space === space); if (!c) return;
    selectedSpace = space; renderDialog(); $('mapDialog').showModal();
  }
  function editSelected(fn) {
    const c = circles.find(c => c.space === selectedSpace); if (!c) return;
    update(c.id,fn); render();
  }
  $('mapTab').onclick = () => showMap();
  $('catalogTab').onclick = () => showPage(false);
  $('mapViews').onclick = e => {
    const b = e.target.closest('[data-map-view]'); if (!b || !validData) return;
    viewId = b.dataset.mapView; focusedSpace = ''; fit();
  };
  $('mapColors').onclick = e => {
    const b = e.target.closest('[data-map-color]'); if (!b) return;
    const selected = new Set(shownColors()), k = b.dataset.mapColor;
    selected.has(k) ? selected.delete(k) : selected.add(k);
    prefs.mapColors = mapColors.filter(k => selected.has(k)); save(); draw();
  };
  $('mapZoomIn').onclick = () => setZoom(zoom*1.5);
  $('mapZoomOut').onclick = () => setZoom(zoom/1.5);
  $('mapFit').onclick = fit;
  $('mapStage').onclick = e => { const target = e.target.closest('[data-map-space]'); if (target) openSpot(target.dataset.mapSpace); };
  $('mapStage').onkeydown = e => {
    const target = e.target.closest('[data-map-space]');
    if (target && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSpot(target.dataset.mapSpace); }
  };
  $('mapDialogClose').onclick = () => $('mapDialog').close();
  $('mapDialogColors').onclick = e => {
    const b = e.target.closest('[data-map-set-color]'); if (!b || !colors.includes(b.dataset.mapSetColor)) return;
    const k = b.dataset.mapSetColor; editSelected(c => c.state.color = k);
    $('mapDialogColors').querySelector(`[data-map-set-color="${k}"]`).focus({preventScroll:true});
  };
  $('mapDialogVisited').onchange = e => editSelected(c => c.state.visited = e.target.checked);
  $('mapDialogList').onclick = () => {
    $('mapDialog').close(); showPage(false);
    prefs.view = 'all'; prefs.review = 'all'; prefs.linkFilter = 'all'; setFilter('q',selectedSpace);
    $('q').focus({preventScroll:true}); $('list').scrollIntoView({block:'start'});
  };
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-map-focus]'); if (button) showMap(button.dataset.mapFocus);
  });
  window.addEventListener('resize', () => { if (!$('mapPage').hidden && fitted) fit(); });
  window.catalogMap = {refresh,show:showMap,validate:validateMap};
})();
