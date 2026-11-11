// ============================================================================
// src/video/video_recorder.js
// Browser Video Export (.WEBM / .MP4 via MediaRecorder + captureStream at
// 16 Mbps) for the Video Preview & Framed Order Demo Studio.
// ============================================================================

function getSupportedVideoMime() {
  const candidates = [
    { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4', label: 'MP4 (H.264)' },
    { mime: 'video/mp4', ext: 'mp4', label: 'MP4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm', label: 'WebM (VP9 HD)' },
    { mime: 'video/webm;codecs=vp8', ext: 'webm', label: 'WebM (VP8)' },
    { mime: 'video/webm', ext: 'webm', label: 'WebM' }
  ];
  if (typeof MediaRecorder === 'undefined') return candidates[2];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c.mime)) {
      return c;
    }
  }
  return candidates[4];
}

function recordCanvasVideoBlob(compositeCanvas, renderFrameAt, animCfg, onProgress) {
  return new Promise((resolve, reject) => {
    if (typeof MediaRecorder === 'undefined' || !compositeCanvas.captureStream) {
      reject(new Error('Przeglądarka nie obsługuje MediaRecorder / captureStream.'));
      return;
    }

    const fps = animCfg.fps || 30;
    const durationSec = animCfg.durationSec || 8.0;
    const exportW = animCfg.exportWidth || 1280;
    const exportH = animCfg.exportHeight || 720;
    const formatInfo = getSupportedVideoMime();

    renderFrameAt(0.0, animCfg, exportW, exportH);

    const stream = compositeCanvas.captureStream(fps);
    const chunks = [];
    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: formatInfo.mime,
        videoBitsPerSecond: 16000000 // 16 Mbps for crisp CAD wireframes
      });
    } catch (_) {
      recorder = new MediaRecorder(stream);
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onerror = (err) => {
      reject(err.error || new Error('Błąd nagrywania wideo w przeglądarce.'));
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || formatInfo.mime });
      resolve({
        blob,
        ext: (recorder.mimeType || '').includes('mp4') ? 'mp4' : formatInfo.ext,
        mimeType: recorder.mimeType || formatInfo.mime,
        width: exportW,
        height: exportH,
        durationSec
      });
    };

    recorder.start(200);
    const startPerf = performance.now();
    const totalMs = durationSec * 1000;
    const totalFrames = Math.round(fps * durationSec);

    function stepRecordFrame(now) {
      const elapsed = now - startPerf;
      const tNorm = clamp01(elapsed / totalMs);
      renderFrameAt(tNorm, animCfg, exportW, exportH);
      if (onProgress) {
        onProgress(tNorm, Math.min(totalFrames, Math.round(tNorm * totalFrames)), totalFrames);
      }

      if (elapsed < totalMs) {
        requestAnimationFrame(stepRecordFrame);
      } else {
        renderFrameAt(1.0, animCfg, exportW, exportH);
        setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
          stream.getTracks().forEach(tr => tr.stop());
        }, 180);
      }
    }

    requestAnimationFrame(stepRecordFrame);
  });
}
