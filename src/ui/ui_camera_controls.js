// ============================================================================
// src/ui/ui_camera_controls.js
// 3D Viewport Camera Controls (Orbit, Pan, Zoom & Pointer/Wheel Bindings)
// ============================================================================

function bindStudioCameraControls(ctx) {
  const { canvas3d, studio, state } = ctx;

  // 1. 3D Viewport (Orbit, Pan, Zoom, Exact 16-bit PickID Hover & Shift+Click)
  let isDragging3D = false, isPanning3D = false;
  let lastX = 0, lastY = 0, downPos = [0, 0];

  canvas3d.addEventListener('mousedown', e => {
    isDragging3D = true;
    isPanning3D = (e.button === 2 || e.button === 1);
    lastX = e.clientX; lastY = e.clientY;
    downPos = [e.clientX, e.clientY];
    state.autoRotate = false;
  });

  window.addEventListener('mousemove', e => {
    if (isDragging3D) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (isPanning3D) {
        const ps = 0.20;
        studio.camera.target[0] -= dx * ps * Math.cos(studio.camera.yaw);
        studio.camera.target[1] -= dx * ps * Math.sin(studio.camera.yaw);
        studio.camera.target[2] += dy * ps;
      } else {
        studio.camera.yaw += dx * 0.008;
        studio.camera.pitch = Math.max(-1.25, Math.min(1.50, studio.camera.pitch + dy * 0.008));
      }
      return;
    }
  });

  window.addEventListener('mouseup', e => {
    if (isDragging3D) {
      if (typeof scheduleSaveActiveConfig === 'function') {
        scheduleSaveActiveConfig(state, 200);
      }
    }
    isDragging3D = false;
    isPanning3D = false;
  });

  canvas3d.addEventListener('contextmenu', e => e.preventDefault());
  canvas3d.addEventListener('wheel', e => {
    e.preventDefault();
    studio.camera.distance = Math.max(22, Math.min(480, studio.camera.distance + e.deltaY * 0.16));
    if (typeof scheduleSaveActiveConfig === 'function') {
      scheduleSaveActiveConfig(state, 250);
    }
  }, { passive: false });
}

if (typeof window !== 'undefined') {
  window.bindStudioCameraControls = bindStudioCameraControls;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { bindStudioCameraControls };
}
