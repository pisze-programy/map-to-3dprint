// ============================================================================
// src/ui/ui_map2d.js
// Web Mercator Tile Projection & Interactive 2D Slippy Map Canvas Renderer
// ============================================================================

function lon2tileF(lon, z) {
  return ((lon + 180.0) / 360.0) * Math.pow(2, z);
}
function lat2tileF(lat, z) {
  const clampedLat = Math.max(-85.0, Math.min(85.0, lat));
  const rad = clampedLat * Math.PI / 180.0;
  return ((1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0) * Math.pow(2, z);
}
function tileF2lon(x, z) {
  return (x / Math.pow(2, z)) * 360.0 - 180.0;
}
function tileF2lat(y, z) {
  const n = Math.PI - (2.0 * Math.PI * y) / Math.pow(2, z);
  return (180.0 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function createMap2DController(canvas2d, ctx2d, osmTileCache, state) {
  function getSelectionBBox() {
    const sc = state.sceneData;
    const baseSpan = Number(state.mapSpanMeters) || (sc && sc.spanMeters) || 1200;

    const totalWidthMm = state.bedSizeMm || (state.targetWidthCm ? state.targetWidthCm * 10 : 500);
    const totalHeightMm = state.totalHeightMm || (state.targetHeightCm ? state.targetHeightCm * 10 : totalWidthMm);
    const maxDimMm = Math.max(totalWidthMm, totalHeightMm) || 500;

    const spanX = baseSpan * (totalWidthMm / maxDimMm);
    const spanY = baseSpan * (totalHeightMm / maxDimMm);

    const halfMx = spanX * 0.5;
    const halfMy = spanY * 0.5;
    const cosLat = Math.max(0.2, Math.cos(state.mapCenterLat * Math.PI / 180.0));
    const dLat = halfMy / 111320.0;
    const dLon = halfMx / (111320.0 * cosLat);
    const south = state.mapCenterLat - dLat;
    const north = state.mapCenterLat + dLat;
    const west = state.mapCenterLon - dLon;
    const east = state.mapCenterLon + dLon;

    const rotDeg = Number(state.mapRotationDeg) || 0;
    const rad = Math.abs(rotDeg) * Math.PI / 180.0;
    const absCos = Math.abs(Math.cos(rad));
    const absSin = Math.abs(Math.sin(rad));
    const envPad = 1.045;
    const envHalfMx = (halfMx * absCos + halfMy * absSin) * envPad;
    const envHalfMy = (halfMx * absSin + halfMy * absCos) * envPad;
    const fetchDLat = envHalfMy / 111320.0;
    const fetchDLon = envHalfMx / (111320.0 * cosLat);

    return {
      south, west, north, east, spanX, spanY,
      targetSpanMeters: baseSpan,
      targetWidthMm: totalWidthMm,
      targetHeightMm: totalHeightMm,
      rotationDeg: rotDeg,
      fetchSouth: state.mapCenterLat - fetchDLat,
      fetchWest: state.mapCenterLon - fetchDLon,
      fetchNorth: state.mapCenterLat + fetchDLat,
      fetchEast: state.mapCenterLon + fetchDLon
    };
  }

  function getSelectedBBoxLatLon() {
    const b = getSelectionBBox();
    const arr = [b.south, b.west, b.north, b.east];
    arr.south = b.south; arr.west = b.west; arr.north = b.north; arr.east = b.east;
    arr.targetSpanMeters = b.targetSpanMeters;
    arr.targetWidthMm = b.targetWidthMm;
    arr.targetHeightMm = b.targetHeightMm;
    arr.rotationDeg = b.rotationDeg;
    arr.fetchSouth = b.fetchSouth; arr.fetchWest = b.fetchWest;
    arr.fetchNorth = b.fetchNorth; arr.fetchEast = b.fetchEast;
    return arr;
  }

  function draw2DMap() {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas2d.clientWidth || 360;
    const ch = canvas2d.clientHeight || 220;
    if (canvas2d.width !== Math.floor(cw * dpr) || canvas2d.height !== Math.floor(ch * dpr)) {
      canvas2d.width = Math.floor(cw * dpr);
      canvas2d.height = Math.floor(ch * dpr);
    }

    ctx2d.save();
    ctx2d.scale(dpr, dpr);
    ctx2d.fillStyle = '#dce6f0';
    ctx2d.fillRect(0, 0, cw, ch);

    const z = Math.round(state.mapZoom);
    const nTiles = Math.pow(2, z);
    const centerTileX = lon2tileF(state.mapCenterLon, z);
    const centerTileY = lat2tileF(state.mapCenterLat, z);
    const tMinX = Math.floor(centerTileX - (cw / 512) - 1);
    const tMaxX = Math.floor(centerTileX + (cw / 512) + 1);
    const tMinY = Math.max(0, Math.floor(centerTileY - (ch / 512) - 1));
    const tMaxY = Math.min(nTiles - 1, Math.floor(centerTileY + (ch / 512) + 1));

    for (let tx = tMinX; tx <= tMaxX; tx++) {
      const wrappedTx = ((tx % nTiles) + nTiles) % nTiles;
      for (let ty = tMinY; ty <= tMaxY; ty++) {
        const key = `${z}/${wrappedTx}/${ty}`;
        if (!osmTileCache[key]) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { osmTileCache[key].loaded = true; draw2DMap(); };
          img.onerror = () => {
            if (!img._triedFallback) {
              img._triedFallback = true;
              const sub = ['a', 'b', 'c'][(wrappedTx + ty) % 3];
              img.crossOrigin = 'anonymous';
              img.src = `https://${sub}.tile.openstreetmap.fr/hot/${z}/${wrappedTx}/${ty}.png`;
            }
          };
          img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${ty}/${wrappedTx}`;
          osmTileCache[key] = { img, loaded: false };
        } else if (osmTileCache[key].loaded) {
          const sx = cw / 2 + (tx - centerTileX) * 256;
          const sy = ch / 2 + (ty - centerTileY) * 256;
          try {
            ctx2d.drawImage(osmTileCache[key].img, sx, sy, 256, 256);
          } catch (_) {}
        }
      }
    }

    const rawScene = state.sceneData;
    const geoScene = (rawScene && rawScene._unrotatedSnapshot) ? rawScene._unrotatedSnapshot : rawScene;
    if (rawScene && rawScene.center && z >= 11) {
      const scLat = rawScene.center[0];
      const scLon = rawScene.center[1];
      const mToU = rawScene.metersToUnits || 0.13;
      const cosLat = Math.max(0.2, Math.cos(scLat * Math.PI / 180.0));

      const toScreenGeo = (pt) => {
        const lon = scLon + (pt[0] / mToU) / (111320.0 * cosLat);
        const lat = scLat + (pt[1] / mToU) / 111320.0;
        const tx = lon2tileF(lon, z);
        const ty = lat2tileF(lat, z);
        return [cw / 2 + (tx - centerTileX) * 256.0, ch / 2 + (ty - centerTileY) * 256.0];
      };

      const [scCenterSx, scCenterSy] = toScreenGeo([0, 0]);
      if (Math.hypot(scCenterSx - cw / 2, scCenterSy - ch / 2) < Math.max(cw, ch) * 1.5) {
        ctx2d.fillStyle = 'rgba(14, 165, 233, 0.24)';
        ((geoScene && geoScene.waterPolys) || []).forEach(wp => {
          if (!wp || !wp.outer || wp.outer.length < 3) return;
          ctx2d.beginPath();
          wp.outer.forEach((p, i) => {
            const [sx, sy] = toScreenGeo(p);
            if (i === 0) ctx2d.moveTo(sx, sy); else ctx2d.lineTo(sx, sy);
          });
          ctx2d.closePath();
          (wp.holes || []).forEach(h => {
            if (!h || h.length < 3) return;
            h.forEach((p, i) => {
              const [sx, sy] = toScreenGeo(p);
              if (i === 0) ctx2d.moveTo(sx, sy); else ctx2d.lineTo(sx, sy);
            });
            ctx2d.closePath();
          });
          ctx2d.fill('evenodd');
        });

        const geoBlds = (geoScene && geoScene.buildings) || [];
        const curBlds = (rawScene && rawScene.buildings) || [];
        for (let bi = 0; bi < curBlds.length; bi++) {
          const b = curBlds[bi];
          const gb = geoBlds[bi] || b;
          if (b.hidden) continue;
          const pid = b._pickId || b.id;
          const isSel = state.userClickedBuilding && (state.selectedBuildingIds.has(pid) || state.selectedBuildingId === pid);
          if (!isSel && !b.highlighted) continue;
          ctx2d.fillStyle = b.highlighted ? 'rgba(245, 158, 11, 0.85)' : 'rgba(37, 99, 235, 0.85)';
          ctx2d.strokeStyle = '#ffffff';
          ctx2d.lineWidth = 1.0;
          ctx2d.beginPath();
          gb.outer.forEach((p, i) => {
            const [sx, sy] = toScreenGeo(p);
            if (i === 0) ctx2d.moveTo(sx, sy); else ctx2d.lineTo(sx, sy);
          });
          ctx2d.closePath();
          ctx2d.fill();
          ctx2d.stroke();
        }
      }
    }

    const [south, west, north, east] = getSelectedBBoxLatLon();
    const bx0 = cw / 2 + (lon2tileF(west, z) - centerTileX) * 256.0;
    const bx1 = cw / 2 + (lon2tileF(east, z) - centerTileX) * 256.0;
    const by0 = ch / 2 + (lat2tileF(north, z) - centerTileY) * 256.0;
    const by1 = ch / 2 + (lat2tileF(south, z) - centerTileY) * 256.0;
    const bw = Math.max(16, bx1 - bx0);
    const bh = Math.max(16, by1 - by0);
    const fcx = (bx0 + bx1) * 0.5;
    const fcy = (by0 + by1) * 0.5;
    const rotDeg = Number(state.mapRotationDeg) || 0;
    const rotRad = rotDeg * Math.PI / 180.0;

    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.rect(0, 0, cw, ch);
    const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
    const hw = bw * 0.5, hh = bh * 0.5;
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(
      ([dx, dy]) => [fcx + dx * cosR - dy * sinR, fcy + dx * sinR + dy * cosR]
    );
    ctx2d.moveTo(corners[0][0], corners[0][1]);
    ctx2d.lineTo(corners[1][0], corners[1][1]);
    ctx2d.lineTo(corners[2][0], corners[2][1]);
    ctx2d.lineTo(corners[3][0], corners[3][1]);
    ctx2d.closePath();
    ctx2d.fillStyle = 'rgba(15, 23, 42, 0.34)';
    ctx2d.fill('evenodd');
    ctx2d.restore();

    ctx2d.save();
    ctx2d.translate(fcx, fcy);
    ctx2d.rotate(rotRad);
    ctx2d.strokeStyle = '#2563eb';
    ctx2d.lineWidth = 2.2;
    ctx2d.strokeRect(-hw, -hh, bw, bh);

    const tCols = state.tileCols || 1;
    const tRows = state.tileRows || 1;
    if (tCols > 1 || tRows > 1) {
      ctx2d.strokeStyle = 'rgba(6, 182, 212, 0.9)';
      ctx2d.lineWidth = 1.25;
      ctx2d.setLineDash([4, 3]);
      for (let c = 1; c < tCols; c++) {
        const sx = -hw + (c / tCols) * bw;
        ctx2d.beginPath(); ctx2d.moveTo(sx, -hh); ctx2d.lineTo(sx, hh); ctx2d.stroke();
      }
      for (let r = 1; r < tRows; r++) {
        const sy = -hh + (r / tRows) * bh;
        ctx2d.beginPath(); ctx2d.moveTo(-hw, sy); ctx2d.lineTo(hw, sy); ctx2d.stroke();
      }
      ctx2d.setLineDash([]);
      ctx2d.font = 'bold 8.5px monospace';
      const tw = bw / tCols, th = bh / tRows;
      const showLabels = tw >= 22 && th >= 14;
      for (let r = 0; r < tRows; r++) {
        for (let c = 0; c < tCols; c++) {
          const tid = (tRows - 1 - r) * tCols + c;
          const tx = -hw + c * tw, ty = -hh + r * th;
          if (state.exportTileFilter !== 'all' && parseInt(state.exportTileFilter, 10) === tid) {
            ctx2d.fillStyle = 'rgba(6, 182, 212, 0.25)';
            ctx2d.fillRect(tx, ty, tw, th);
          }
          if (showLabels) {
            ctx2d.fillStyle = 'rgba(15, 23, 42, 0.72)';
            ctx2d.fillRect(tx + 1.5, ty + 1.5, Math.min(30, tw - 3), 11);
            ctx2d.fillStyle = '#38bdf8';
            ctx2d.fillText(`R${r + 1}C${c + 1}`, tx + 3, ty + 10);
          }
        }
      }
    }

    const handleDist = Math.min(18, Math.max(11, hh * 0.22));
    ctx2d.strokeStyle = '#10b981';
    ctx2d.lineWidth = 1.8;
    ctx2d.beginPath(); ctx2d.moveTo(0, -hh); ctx2d.lineTo(0, -hh - handleDist); ctx2d.stroke();
    ctx2d.fillStyle = '#10b981';
    ctx2d.beginPath(); ctx2d.arc(0, -hh - handleDist, 6.5, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.strokeStyle = '#ffffff';
    ctx2d.lineWidth = 1.4;
    ctx2d.stroke();

    if (rotDeg !== 0) {
      const badgeTxt = `${rotDeg > 0 ? '+' : ''}${Math.round(rotDeg)}°`;
      ctx2d.fillStyle = 'rgba(16, 185, 129, 0.92)';
      ctx2d.fillRect(-20, -hh + 2, 40, 13);
      ctx2d.fillStyle = '#ffffff';
      ctx2d.font = 'bold 9px monospace';
      ctx2d.textAlign = 'center';
      ctx2d.fillText(badgeTxt, 0, -hh + 11.5);
      ctx2d.textAlign = 'start';
    }
    ctx2d.restore();

    state._rotHandleScreen = {
      x: fcx - (-hh - handleDist) * sinR,
      y: fcy + (-hh - handleDist) * cosR,
      fcx, fcy
    };

    ctx2d.strokeStyle = 'rgba(37, 99, 235, 0.65)';
    ctx2d.lineWidth = 1.0;
    ctx2d.beginPath();
    ctx2d.moveTo(cw / 2 - 6, ch / 2); ctx2d.lineTo(cw / 2 + 6, ch / 2);
    ctx2d.moveTo(cw / 2, ch / 2 - 6); ctx2d.lineTo(cw / 2, ch / 2 + 6);
    ctx2d.stroke();

    const pill = document.getElementById('mapStatusPill');
    if (pill) {
      const dimW = (state.bedSizeMm ? state.bedSizeMm / 10 : (state.targetWidthCm || 50)).toFixed(0);
      const dimH = (state.totalHeightMm ? state.totalHeightMm / 10 : (state.targetHeightCm || 50)).toFixed(0);
      const rotSuffix = rotDeg ? ` • ↻${rotDeg > 0 ? '+' : ''}${Math.round(rotDeg)}°` : '';
      pill.textContent = `N ${south.toFixed(4)}°..${north.toFixed(4)}° • E ${west.toFixed(4)}°..${east.toFixed(4)}° • ${dimW}×${dimH} cm${rotSuffix}`;
    }
    ctx2d.restore();
  }

  return { getSelectedBBoxLatLon, getSelectionBBox, draw2DMap };
}
