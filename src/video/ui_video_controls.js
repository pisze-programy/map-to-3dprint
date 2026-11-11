// ============================================================================
// src/video/ui_video_controls.js
// DOM Controls, Element & Landmark Chips, State Sync, and Video/PNG Export
// Triggers for the Browser Video Preview & Framed Order Demo Studio.
// ============================================================================

function createVideoControlsController(vState, engine, previewCanvas, deps) {
  function renderElementTogglesUI() {
    const box = document.getElementById('vidElementsChecklist');
    if (!box) return;
    const items = [
      { key: 'water', label: '1. Woda i batymetria' },
      { key: 'base', label: '2. Warstwice terenu DEM' },
      { key: 'greenery', label: '3. Parki i drzewa 3D' },
      { key: 'roads', label: '4. Ulice, place i mosty' },
      { key: 'buildings', label: '5. Budynki i dachy LoD2' },
      { key: 'highlighted', label: '6. Wyróżnione obiekty ★' }
    ];
    box.innerHTML = '';
    items.forEach(it => {
      const active = !!vState.elementVisible[it.key];
      const lbl = document.createElement('label');
      lbl.className = `flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs cursor-pointer transition ${active ? 'border-blue-500/60 bg-blue-500/10 font-semibold text-[var(--foreground)]' : 'border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]'}`;
      lbl.innerHTML = `<input type="checkbox" data-vid-elem="${it.key}" ${active ? 'checked' : ''} class="rounded accent-blue-600" /><span class="truncate">${it.label}</span>`;
      box.appendChild(lbl);
    });
    box.querySelectorAll('[data-vid-elem]').forEach(chk => {
      chk.addEventListener('change', e => {
        vState.elementVisible[e.target.getAttribute('data-vid-elem')] = e.target.checked;
        vState.pinnedSlots = [];
        renderElementTogglesUI();
        deps.rebuildSlots();
      });
    });
  }

  function updateVideoLandmarkChips() {
    const box = document.getElementById('vidLandmarkChips');
    if (!box || !vState.sceneData) return;
    box.innerHTML = '';
    const seen = new Set();
    const candidates = [...(vState.sceneData.buildings || [])]
      .filter(b => !b.hidden && ((b.name && !b.name.startsWith('Budynek OSM')) || b.h >= 40))
      .sort((a, b) => (b.highlighted ? 1000 : 0) + (b.h || 0) - ((a.highlighted ? 1000 : 0) + (a.h || 0)));

    candidates.slice(0, 8).forEach(b => {
      const labelName = (b.name && !b.name.startsWith('Budynek OSM')) ? b.name : `Wieżowiec ${Math.round(b.h)}m`;
      if (seen.has(labelName)) return;
      seen.add(labelName);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `px-2 py-0.5 rounded border text-[11px] transition truncate max-w-[165px] ${b.highlighted ? 'border-amber-500 bg-amber-500/20 text-amber-400 font-bold' : 'border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)] hover:border-blue-500'}`;
      chip.textContent = `${b.highlighted ? '★ ' : ''}${labelName.slice(0, 20)} (${Math.round(b.h || 10)}m)`;
      chip.addEventListener('click', () => { b.highlighted = !b.highlighted; vState.pinnedSlots = []; deps.rebuildSlots(); });
      box.appendChild(chip);
    });
  }

  function syncControlsFromState() {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
    const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    setVal('vidStoryboardSelect', vState.storyboard);
    setVal('vidWaveModeSelect', vState.waveMode);
    setVal('vidStyleSelect', vState.styleTransition);
    setVal('vidAspectSelect', vState.aspectPreset);
    setVal('vidEasingSelect', vState.easing);
    setVal('vidPaletteSelect', vState.paletteId);
    setVal('vidFrameFinishSelect', vState.frameStyle);
    setVal('vidFrameAnimSelect', vState.frameAnimMode);
    setVal('vidMatStyleSelect', vState.matStyle);
    setVal('vidBackingSelect', vState.backingStyle);
    setVal('vidBgThemeSelect', vState.bgTheme);
    setVal('vidTitleInput', vState.title);
    setVal('vidSubtitleInput', vState.subtitle);
    setChk('chkVidGhostLayers', vState.ghostHiddenLayers);
    setChk('chkVidShowFrame', vState.showFrameProduct);
    setChk('chkVidShowPlaque', vState.showPlaque);
    setChk('chkVidShowGlass', vState.showGlass);
    setChk('chkVidTelemetry', vState.showTelemetry);
    setChk('chkVidWhipPan', vState.showWhipPan);
    setChk('chkVidOrderHud', vState.showOrderHud);
    const descEl = document.getElementById('vidStoryboardDesc');
    const foundSb = VIDEO_STORYBOARDS.find(x => x.id === vState.storyboard);
    if (descEl && foundSb) descEl.textContent = foundSb.desc;
    renderElementTogglesUI();
    deps.draw2DMap();
  }

  function bindStudioControls() {
    const sbSel = document.getElementById('vidStoryboardSelect');
    const sbDesc = document.getElementById('vidStoryboardDesc');
    if (sbSel) {
      sbSel.innerHTML = '';
      VIDEO_STORYBOARDS.forEach(sb => {
        const opt = document.createElement('option');
        opt.value = sb.id;
        opt.textContent = sb.name;
        opt.selected = sb.id === vState.storyboard;
        sbSel.appendChild(opt);
      });
      sbSel.addEventListener('change', e => {
        vState.storyboard = e.target.value;
        vState.tNorm = 0.0;
        vState.isPlaying = true;
        engine.resetUserOrbit();
        deps.syncPlayButtonUI();
        const found = VIDEO_STORYBOARDS.find(x => x.id === vState.storyboard);
        if (sbDesc && found) sbDesc.textContent = found.desc;
        deps.renderPreview();
      });
    }

    const palSel = document.getElementById('vidPaletteSelect');
    if (palSel) {
      palSel.innerHTML = '';
      PALETTES.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        opt.selected = p.id === vState.paletteId;
        palSel.appendChild(opt);
      });
      palSel.addEventListener('change', e => {
        const p = PALETTES.find(x => x.id === e.target.value) || PALETTES[0];
        vState.paletteId = p.id;
        vState.colors = { ...p.colors };
        if (p.id === 'white') {
          vState.colors.water = '#161b24';
          vState.backingStyle = 'obsidian';
          const bSel = document.getElementById('vidBackingSelect');
          if (bSel) bSel.value = 'obsidian';
        }
        vState.pinnedSlots = [];
        deps.rebuildSlots();
      });
    }

    const btnSync3D = document.getElementById('btnVidSyncFrom3D');
    if (btnSync3D) btnSync3D.addEventListener('click', () => deps.syncFrom3D(true));

    document.querySelectorAll('[data-elem-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-elem-preset');
        if (p === 'all') vState.elementVisible = { water: true, base: true, greenery: true, roads: true, buildings: true, highlighted: true };
        else if (p === 'arch') {
          vState.elementVisible = { water: false, base: false, greenery: false, roads: true, buildings: true, highlighted: true };
          vState.backingStyle = 'obsidian';
        } else if (p === 'spotlight_only') {
          vState.elementVisible = { water: false, base: false, greenery: false, roads: false, buildings: false, highlighted: true };
          vState.ghostHiddenLayers = true;
        } else if (p === 'hydro_relief') vState.elementVisible = { water: true, base: true, greenery: true, roads: false, buildings: false, highlighted: false };
        else if (p === 'urban_grid') vState.elementVisible = { water: true, base: false, greenery: false, roads: true, buildings: true, highlighted: true };
        vState.pinnedSlots = [];
        syncControlsFromState();
        deps.rebuildSlots();
      });
    });

    const bindSelect = (id, prop, rebuild) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', e => {
        vState[prop] = e.target.value;
        if (rebuild) { vState.pinnedSlots = []; deps.rebuildSlots(); }
        else deps.renderPreview();
      });
    };
    bindSelect('vidWaveModeSelect', 'waveMode', false);
    bindSelect('vidStyleSelect', 'styleTransition', false);
    bindSelect('vidEasingSelect', 'easing', false);
    bindSelect('vidFrameAnimSelect', 'frameAnimMode', false);
    bindSelect('vidBgThemeSelect', 'bgTheme', false);
    bindSelect('vidAspectSelect', 'aspectPreset', false);
    bindSelect('vidFrameFinishSelect', 'frameStyle', true);
    bindSelect('vidMatStyleSelect', 'matStyle', true);
    bindSelect('vidBackingSelect', 'backingStyle', true);

    const bindCheck = (id, prop, rebuild) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', e => {
        vState[prop] = e.target.checked;
        if (rebuild) { vState.pinnedSlots = []; deps.rebuildSlots(); }
        else deps.renderPreview();
      });
    };
    bindCheck('chkVidGhostLayers', 'ghostHiddenLayers', true);
    bindCheck('chkVidTelemetry', 'showTelemetry', false);
    bindCheck('chkVidWhipPan', 'showWhipPan', false);
    bindCheck('chkVidOrderHud', 'showOrderHud', false);
    bindCheck('chkVidShowFrame', 'showFrameProduct', false);
    bindCheck('chkVidShowPlaque', 'showPlaque', true);
    bindCheck('chkVidShowGlass', 'showGlass', true);

    document.querySelectorAll('[data-vid-frame-dim]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [w, h] = btn.getAttribute('data-vid-frame-dim').split('x').map(Number);
        vState.targetWidthCm = w; vState.targetHeightCm = h;
        vState.bedSizeMm = w * 10; vState.totalHeightMm = h * 10;
        vState.pinnedSlots = [];
        deps.draw2DMap();
        deps.rebuildSlots();
      });
    });

    const durSlider = document.getElementById('vidDurationSlider');
    if (durSlider) durSlider.addEventListener('input', e => {
      vState.durationSec = parseFloat(e.target.value) || 8.5;
      const lbl = document.getElementById('vidDurationLabel');
      if (lbl) lbl.textContent = `${vState.durationSec.toFixed(1)} s`;
      deps.updateTimelineLabelsUI();
    });
    const fpsSel = document.getElementById('vidFpsSelect');
    if (fpsSel) fpsSel.addEventListener('change', e => { vState.fps = parseInt(e.target.value, 10) || 30; });

    let zTimer = null;
    const bindScaleSlider = (id, lblId, prop) => {
      const sl = document.getElementById(id);
      if (!sl) return;
      sl.addEventListener('input', e => {
        vState[prop] = parseInt(e.target.value, 10) / 100;
        const lbl = document.getElementById(lblId);
        if (lbl) lbl.textContent = `${vState[prop].toFixed(2)}×`;
        clearTimeout(zTimer);
        zTimer = setTimeout(() => { vState.pinnedSlots = []; deps.rebuildSlots(); }, 90);
      });
    };
    bindScaleSlider('vidZScaleSlider', 'vidZScaleLabel', 'zScale');
    bindScaleSlider('vidTerrainScaleSlider', 'vidTerrainScaleLabel', 'terrainScale');

    const sunSlider = document.getElementById('vidSunSlider');
    if (sunSlider) sunSlider.addEventListener('input', e => {
      vState.sunAngleDeg = parseInt(e.target.value, 10) || 132;
      deps.renderPreview();
    });

    let txtTimer = null;
    ['vidTitleInput', 'vidSubtitleInput'].forEach(id => {
      const inp = document.getElementById(id);
      if (!inp) return;
      inp.addEventListener('input', () => {
        vState.title = (document.getElementById('vidTitleInput').value || 'MAP3D').slice(0, 22);
        vState.subtitle = (document.getElementById('vidSubtitleInput').value || '').slice(0, 36);
        clearTimeout(txtTimer);
        txtTimer = setTimeout(() => { vState.pinnedSlots = []; deps.rebuildSlots(); }, 140);
      });
    });

    const scrubber = document.getElementById('vidTimelineScrubber');
    if (scrubber) scrubber.addEventListener('input', e => {
      vState.isPlaying = false;
      vState.tNorm = parseInt(e.target.value, 10) / 1000;
      deps.syncPlayButtonUI();
      deps.renderPreview();
    });
    const btnPlay = document.getElementById('btnVidPlayPause');
    if (btnPlay) btnPlay.addEventListener('click', () => {
      if (!vState.isPlaying && vState.tNorm >= 0.995) vState.tNorm = 0.0;
      vState.isPlaying = !vState.isPlaying;
      deps.syncPlayButtonUI();
    });
    const btnRestart = document.getElementById('btnVidRestart');
    if (btnRestart) btnRestart.addEventListener('click', () => {
      vState.tNorm = 0.0; vState.isPlaying = true; engine.resetUserOrbit(); deps.syncPlayButtonUI(); deps.renderPreview();
    });
    const btnJump = document.getElementById('btnVidJumpPackshot');
    if (btnJump) btnJump.addEventListener('click', () => {
      vState.isPlaying = false; vState.tNorm = 0.92; deps.syncPlayButtonUI(); deps.renderPreview();
    });

    const btnRecord = document.getElementById('btnVidRecordExport');
    if (btnRecord) btnRecord.addEventListener('click', async () => {
      if (vState.isRecording) return;
      vState.isRecording = true; vState.isPlaying = false; deps.syncPlayButtonUI();
      const recBanner = document.getElementById('vidRecordingBanner');
      const recText = document.getElementById('vidRecordingProgressText');
      const recBar = document.getElementById('vidRecordingProgressBar');
      const resultBox = document.getElementById('vidExportResultCard');
      if (recBanner) recBanner.classList.remove('hidden');
      if (resultBox) resultBox.classList.add('hidden');
      btnRecord.disabled = true;
      try {
        const res = await engine.recordVideoBlob(deps.getAnimConfig(), (pct, fIdx, fTot) => {
          const p100 = Math.round(pct * 100);
          if (recText) recText.textContent = `Renderowanie klatki ${fIdx}/${fTot} (${p100}%)...`;
          if (recBar) recBar.style.width = `${p100}%`;
        });
        if (vState.recordedVideoUrl) URL.revokeObjectURL(vState.recordedVideoUrl);
        vState.recordedVideoUrl = URL.createObjectURL(res.blob);
        vState.recordedVideoExt = res.ext;
        const vidPlayer = document.getElementById('vidRecordedPlayer');
        const dlLink = document.getElementById('btnVidDownloadFile');
        const metaBadge = document.getElementById('vidRecordedMetaBadge');
        const slug = (vState.title || 'map3d').toLowerCase().replace(/[^a-z0-9]+/g, '_');
        if (vidPlayer) { vidPlayer.src = vState.recordedVideoUrl; vidPlayer.play().catch(() => {}); }
        if (dlLink) {
          dlLink.href = vState.recordedVideoUrl;
          dlLink.download = `preview_${slug}_${res.width}x${res.height}.${res.ext}`;
          dlLink.textContent = `⬇ Pobierz Wideo .${res.ext.toUpperCase()} (${(res.blob.size / (1024 * 1024)).toFixed(1)} MB)`;
        }
        if (metaBadge) metaBadge.textContent = `${res.width}×${res.height} • ${vState.fps} FPS • ${res.durationSec.toFixed(1)}s`;
        if (resultBox) resultBox.classList.remove('hidden');
      } catch (err) {
        alert('Błąd generowania wideo: ' + (err && err.message ? err.message : String(err)));
      } finally {
        vState.isRecording = false; btnRecord.disabled = false;
        if (recBanner) recBanner.classList.add('hidden');
        deps.renderPreview();
      }
    });

    const btnPng = document.getElementById('btnVidDownloadPng');
    if (btnPng) btnPng.addEventListener('click', () => {
      const cfg = deps.getAnimConfig();
      engine.renderFrameAt(0.92, cfg, cfg.exportWidth, cfg.exportHeight);
      const a = document.createElement('a');
      const slug = (vState.title || 'map3d').toLowerCase().replace(/[^a-z0-9]+/g, '_');
      a.href = previewCanvas.toDataURL('image/png');
      a.download = `packshot_ramka_${slug}_${cfg.exportWidth}x${cfg.exportHeight}.png`;
      a.click();
      deps.renderPreview();
    });
  }

  return {
    renderElementTogglesUI,
    updateVideoLandmarkChips,
    syncControlsFromState,
    bindStudioControls
  };
}
