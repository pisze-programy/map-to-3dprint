// ============================================================================
// src/ui/ui_camera_controls.js
// 3D Viewport Camera Controls (Orbit, Distance-Scaled Map-Plane Pan,
// Smooth Exponential Wheel Zoom & Touch Pinch/Orbit/Pan Bindings)
// ============================================================================

const CAM_MIN_DISTANCE = 2.5;
const CAM_MAX_DISTANCE = 520.0;
const CAM_TARGET_XY_BOUND = 110.0;
const CAM_WHEEL_ZOOM_RATE = 0.0012;
const CAM_PINCH_WHEEL_RATE = 0.0040;

function computeZoomedCameraDistance(currentDist, deltaY, deltaMode = 0, isPinchGesture = false) {
  const baseDist = Math.max(CAM_MIN_DISTANCE, Math.min(CAM_MAX_DISTANCE, Number(currentDist) || 274));
  const rawDeltaY = (deltaMode === 1)
    ? (Number(deltaY) || 0) * 32
    : (deltaMode === 2)
      ? (Number(deltaY) || 0) * 240
      : (Number(deltaY) || 0);
  const clampedDeltaY = Math.max(-220, Math.min(220, rawDeltaY));
  const rate = isPinchGesture ? CAM_PINCH_WHEEL_RATE : CAM_WHEEL_ZOOM_RATE;
  const nextDist = baseDist * Math.exp(clampedDeltaY * rate);
  return Math.max(CAM_MIN_DISTANCE, Math.min(CAM_MAX_DISTANCE, nextDist));
}

function panStudioCameraTarget(camera, dx, dy) {
  if (!camera || !Array.isArray(camera.target)) return;
  const dist = Math.max(CAM_MIN_DISTANCE, Math.min(CAM_MAX_DISTANCE, Number(camera.distance) || 274));
  const ps = Math.max(0.012, dist * 0.0011);
  const yaw = Number(camera.yaw) || 0;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  // Camera right in XY plane = (cos(yaw), sin(yaw));
  // Camera ground-forward in XY plane = (-sin(yaw), cos(yaw)).
  // When inspecting from underneath (pitch < -0.1), screen-up flips along ground-forward.
  const fwdSign = (Number(camera.pitch) < -0.1) ? -1 : 1;
  const nextX = (Number(camera.target[0]) || 0) - dx * ps * cy - dy * ps * fwdSign * sy;
  const nextY = (Number(camera.target[1]) || 0) - dx * ps * sy + dy * ps * fwdSign * cy;
  camera.target[0] = Math.max(-CAM_TARGET_XY_BOUND, Math.min(CAM_TARGET_XY_BOUND, nextX));
  camera.target[1] = Math.max(-CAM_TARGET_XY_BOUND, Math.min(CAM_TARGET_XY_BOUND, nextY));
  camera.target[2] = Math.max(-6.0, Math.min(48.0, Number(camera.target[2]) || 0));
}

function bindStudioCameraControls(ctx) {
  const { canvas3d, studio, state } = ctx;

  // 1. 3D Viewport Mouse Orbit, Distance-Scaled Map-Plane Pan & Exponential Wheel Zoom
  let isDragging3D = false, isPanning3D = false;
  let lastX = 0, lastY = 0, downPos = [0, 0];

  canvas3d.addEventListener('mousedown', e => {
    isDragging3D = true;
    isPanning3D = (e.button === 2 || e.button === 1 || (e.button === 0 && !!e.shiftKey));
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
        panStudioCameraTarget(studio.camera, dx, dy);
      } else {
        studio.camera.yaw += dx * 0.008;
        studio.camera.pitch = Math.max(-1.25, Math.min(1.52, studio.camera.pitch + dy * 0.008));
      }
      return;
    }
  });

  window.addEventListener('mouseup', () => {
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
    studio.camera.distance = computeZoomedCameraDistance(
      studio.camera.distance,
      e.deltaY,
      e.deltaMode || 0,
      !!e.ctrlKey
    );
    if (typeof scheduleSaveActiveConfig === 'function') {
      scheduleSaveActiveConfig(state, 250);
    }
  }, { passive: false });

  // 2. Touch Support: 1-Finger Orbit, 2-Finger Multiplicative Pinch-Zoom & Map-Plane Pan
  let activeTouchCount = 0;
  let lastTouchX = 0, lastTouchY = 0;
  let lastPinchSpan = 0;

  canvas3d.addEventListener('touchstart', e => {
    if (!e.touches || e.touches.length === 0) return;
    state.autoRotate = false;
    activeTouchCount = e.touches.length;
    if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      lastPinchSpan = 0;
    } else if (e.touches.length >= 2) {
      e.preventDefault();
      const t0 = e.touches[0], t1 = e.touches[1];
      lastTouchX = (t0.clientX + t1.clientX) * 0.5;
      lastTouchY = (t0.clientY + t1.clientY) * 0.5;
      lastPinchSpan = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    }
  }, { passive: false });

  canvas3d.addEventListener('touchmove', e => {
    if (!e.touches || e.touches.length === 0) return;
    e.preventDefault();
    if (e.touches.length === 1 && activeTouchCount === 1) {
      const dx = e.touches[0].clientX - lastTouchX;
      const dy = e.touches[0].clientY - lastTouchY;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      studio.camera.yaw += dx * 0.008;
      studio.camera.pitch = Math.max(-1.25, Math.min(1.52, studio.camera.pitch + dy * 0.008));
    } else if (e.touches.length >= 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const midX = (t0.clientX + t1.clientX) * 0.5;
      const midY = (t0.clientY + t1.clientY) * 0.5;
      const span = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      if (activeTouchCount >= 2) {
        const midDx = midX - lastTouchX;
        const midDy = midY - lastTouchY;
        panStudioCameraTarget(studio.camera, midDx, midDy);
        if (lastPinchSpan > 4 && span > 4) {
          const pinchRatio = Math.max(0.75, Math.min(1.35, lastPinchSpan / span));
          studio.camera.distance = Math.max(
            CAM_MIN_DISTANCE,
            Math.min(CAM_MAX_DISTANCE, studio.camera.distance * pinchRatio)
          );
        }
      }
      activeTouchCount = e.touches.length;
      lastTouchX = midX;
      lastTouchY = midY;
      lastPinchSpan = span;
    }
  }, { passive: false });

  const handleTouchEnd = e => {
    if (e.touches && e.touches.length === 1) {
      activeTouchCount = 1;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      lastPinchSpan = 0;
    } else if (!e.touches || e.touches.length === 0) {
      if (activeTouchCount > 0 && typeof scheduleSaveActiveConfig === 'function') {
        scheduleSaveActiveConfig(state, 200);
      }
      activeTouchCount = 0;
      lastPinchSpan = 0;
    }
  };
  canvas3d.addEventListener('touchend', handleTouchEnd);
  canvas3d.addEventListener('touchcancel', handleTouchEnd);
}

if (typeof window !== 'undefined') {
  window.CAM_MIN_DISTANCE = CAM_MIN_DISTANCE;
  window.CAM_MAX_DISTANCE = CAM_MAX_DISTANCE;
  window.CAM_TARGET_XY_BOUND = CAM_TARGET_XY_BOUND;
  window.computeZoomedCameraDistance = computeZoomedCameraDistance;
  window.panStudioCameraTarget = panStudioCameraTarget;
  window.bindStudioCameraControls = bindStudioCameraControls;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CAM_MIN_DISTANCE,
    CAM_MAX_DISTANCE,
    CAM_TARGET_XY_BOUND,
    computeZoomedCameraDistance,
    panStudioCameraTarget,
    bindStudioCameraControls
  };
}
