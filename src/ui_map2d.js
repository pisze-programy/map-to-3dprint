// ============================================================================
// src/ui_map2d.js
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
  function getSelectedBBoxLatLon() {
    // Fix R10: Keep 2D blue frame and 3D model crop 100% 1:1 aligned (using _fetchedCropRatio and spanMeters)
    const sc = state.sceneData;
    const baseCrop = (sc && sc._fetchedCropRatio) || 0.88;
    const effCrop = Math.min(1.0, Math.max(0.35, (state.cropRatio || 0.88) / baseCrop));
    const spanMeters = ((sc && sc.spanMeters) || 1291.3) * effCrop;
    const halfM = spanMeters * 0.5;
    const cosLat = Math.max(0.2, Math.cos(state.mapCenterLat * Math.PI / 180.0));
    const dLat = halfM / 111320.0;
    const dLon = halfM / (111320.0 * cosLat);
    const south = state.mapCenterLat - dLat;
    const north = state.mapCenterLat + dLat;
    const west = state.mapCenterLon - dLon;
    const east = state.mapCenterLon + dLon;
    return [south, west, north, east];
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

    // 1. Draw live CartoDB Voyager Slippy Map Tiles (zero OSM Referer blocks!)
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
          img.onload = () => { osmTileCache[key].loaded = true; draw2DMap(); };
          img.onerror = () => {
            if (!img._triedFallback) {
              img._triedFallback = true;
              const sub = ['a', 'b', 'c'][(wrappedTx + ty) % 3];
              img.src = `https://${sub}.tile.openstreetmap.fr/hot/${z}/${wrappedTx}/${ty}.png`;
            }
          };
          img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${ty}/${wrappedTx}`;
          osmTileCache[key] = { img, loaded: false };
        } else if (osmTileCache[key].loaded) {
          const sx = cw / 2 + (tx - centerTileX) * 256;
          const sy = ch / 2 + (ty - centerTileY) * 256;
          ctx2d.drawImage(osmTileCache[key].img, sx, sy, 256, 256);
        }
      }
    }

    // 2. Project loaded GIS vectors at their TRUE geographic coordinates (so panning moves them smoothly!)
    const scene = state.sceneData;
    if (scene && scene.center && z >= 12) {
      const scLat = scene.center[0];
      const scLon = scene.center[1];
      const mToU = scene.metersToUnits || 0.13;
      const cosLat = Math.max(0.2, Math.cos(scLat * Math.PI / 180.0));

      // Convert scene unit [x, y] -> [lat, lon] -> screen pixel [sx, sy]
      const toScreenGeo = (pt) => {
        const lon = scLon + (pt[0] / mToU) / (111320.0 * cosLat);
        const lat = scLat + (pt[1] / mToU) / 111320.0;
        const tx = lon2tileF(lon, z);
        const ty = lat2tileF(lat, z);
        return [cw / 2 + (tx - centerTileX) * 256.0, ch / 2 + (ty - centerTileY) * 256.0];
      };

      const [scCenterSx, scCenterSy] = toScreenGeo([0, 0]);
      if (Math.hypot(scCenterSx - cw / 2, scCenterSy - ch / 2) < Math.max(cw, ch) * 1.5) {
        // Subtle blue tint for loaded water/sea polygons on 2D map
        ctx2d.fillStyle = 'rgba(14, 165, 233, 0.24)';
        (scene.waterPolys || []).forEach(wp => {
          ctx2d.beginPath();
          wp.outer.forEach((p, i) => {
            const [sx, sy] = toScreenGeo(p);
            if (i === 0) ctx2d.moveTo(sx, sy); else ctx2d.lineTo(sx, sy);
          });
          ctx2d.closePath();
          ctx2d.fill();
        });

        // Highlighted / Selected buildings overlay on 2D map
        (scene.buildings || []).forEach(b => {
          if (b.hidden) return;
          const gid = b._groupId || b.id;
          const isSel = state.userClickedBuilding && (state.selectedBuildingIds.has(gid) || state.selectedBuildingId === gid);
          if (!isSel && !b.highlighted) return;
          ctx2d.fillStyle = b.highlighted ? 'rgba(245, 158, 11, 0.85)' : 'rgba(37, 99, 235, 0.85)';
          ctx2d.strokeStyle = '#ffffff';
          ctx2d.lineWidth = 1.0;
          ctx2d.beginPath();
          b.outer.forEach((p, i) => {
            const [sx, sy] = toScreenGeo(p);
            if (i === 0) ctx2d.moveTo(sx, sy); else ctx2d.lineTo(sx, sy);
          });
          ctx2d.closePath();
          ctx2d.fill();
          ctx2d.stroke();
        });
      }
    }

    // 3. Draw Blue Print Frame Bounding Box at current [south, west, north, east]
    const [south, west, north, east] = getSelectedBBoxLatLon();
    const bx0 = cw / 2 + (lon2tileF(west, z) - centerTileX) * 256.0;
    const bx1 = cw / 2 + (lon2tileF(east, z) - centerTileX) * 256.0;
    const by0 = ch / 2 + (lat2tileF(north, z) - centerTileY) * 256.0;
    const by1 = ch / 2 + (lat2tileF(south, z) - centerTileY) * 256.0;
    const bw = Math.max(16, bx1 - bx0);
    const bh = Math.max(16, by1 - by0);

    ctx2d.fillStyle = 'rgba(15, 23, 42, 0.32)';
    ctx2d.fillRect(0, 0, cw, Math.max(0, by0));
    ctx2d.fillRect(0, Math.min(ch, by0 + bh), cw, Math.max(0, ch - (by0 + bh)));
    ctx2d.fillRect(0, Math.max(0, by0), Math.max(0, bx0), Math.min(ch, bh));
    ctx2d.fillRect(Math.min(cw, bx0 + bw), Math.max(0, by0), Math.max(0, cw - (bx0 + bw)), Math.min(ch, bh));

    ctx2d.strokeStyle = '#2563eb';
    ctx2d.lineWidth = 2.2;
    ctx2d.strokeRect(bx0, by0, bw, bh);

    // Draw Multi-Tile Grid Split Overlay (e.g., 1x2, 2x2, 2x3, 2x4 for Anycubic Photon Mono 4)
    const tCols = state.tileCols || 1;
    const tRows = state.tileRows || 1;
    if (tCols > 1 || tRows > 1) {
      ctx2d.save();
      ctx2d.strokeStyle = 'rgba(6, 182, 212, 0.9)';
      ctx2d.lineWidth = 1.4;
      ctx2d.setLineDash([4, 3]);
      for (let c = 1; c < tCols; c++) {
        const sx = bx0 + (c / tCols) * bw;
        ctx2d.beginPath();
        ctx2d.moveTo(sx, by0);
        ctx2d.lineTo(sx, by0 + bh);
        ctx2d.stroke();
      }
      for (let r = 1; r < tRows; r++) {
        const sy = by0 + (r / tRows) * bh;
        ctx2d.beginPath();
        ctx2d.moveTo(bx0, sy);
        ctx2d.lineTo(bx0 + bw, sy);
        ctx2d.stroke();
      }
      ctx2d.setLineDash([]);
      ctx2d.font = 'bold 9px monospace';
      for (let r = 0; r < tRows; r++) {
        for (let c = 0; c < tCols; c++) {
          const tid = (tRows - 1 - r) * tCols + c;
          const tx = bx0 + (c / tCols) * bw;
          const ty = by0 + (r / tRows) * bh;
          const tw = bw / tCols;
          const th = bh / tRows;
          if (state.exportTileFilter !== 'all' && parseInt(state.exportTileFilter, 10) === tid) {
            ctx2d.fillStyle = 'rgba(6, 182, 212, 0.25)';
            ctx2d.fillRect(tx, ty, tw, th);
          }
          ctx2d.fillStyle = 'rgba(15, 23, 42, 0.72)';
          ctx2d.fillRect(tx + 3, ty + 3, 28, 12);
          ctx2d.fillStyle = '#38bdf8';
          // Fix B34: R1 is always the northernmost (top) row on the 2D map and in exported .STL/.ZIP files
          ctx2d.fillText(`R${r + 1}C${c + 1}`, tx + 5, ty + 12);
        }
      }
      ctx2d.restore();
    }

    // Crosshair in center of frame
    ctx2d.strokeStyle = 'rgba(37, 99, 235, 0.65)';
    ctx2d.lineWidth = 1.0;
    ctx2d.beginPath();
    ctx2d.moveTo(cw / 2 - 6, ch / 2); ctx2d.lineTo(cw / 2 + 6, ch / 2);
    ctx2d.moveTo(cw / 2, ch / 2 - 6); ctx2d.lineTo(cw / 2, ch / 2 + 6);
    ctx2d.stroke();

    const pill = document.getElementById('mapStatusPill');
    if (pill) {
      pill.textContent = `N ${south.toFixed(4)}°..${north.toFixed(4)}° • E ${west.toFixed(4)}°..${east.toFixed(4)}°`;
    }

    ctx2d.restore();
  }


  return { getSelectedBBoxLatLon, draw2DMap };
}
