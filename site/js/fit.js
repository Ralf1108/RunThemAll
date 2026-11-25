// Scales an emulator screen (canvas or text element) to the largest size that fits
// into the emulator area while keeping the aspect ratio of the emulated monitor.
// Works for the normal page and for fullscreen, since it follows the size of the area.

/**
 * Aspect ratio of a PC monitor for a video mode: the low-resolution VGA modes
 * (320x200, 640x350, 640x400, 720x400 text mode) have non-square pixels and were
 * shown as 4:3; everything else (640x480, 800x600, 1024x768, ...) has square pixels.
 * @param {number} w
 * @param {number} h
 */
export function pcAspect(w, h) {
  return h <= 400 ? 4 / 3 : w / h;
}

/**
 * Keeps `el` as large as possible inside `box`.
 * Canvases are resized via CSS width/height, so mouse coordinates stay correct
 * (the emulators scale them by the displayed size). Other elements (v86 text mode)
 * are scaled with a CSS transform.
 * @param {HTMLElement} el
 * @param {HTMLElement} box
 * @param {(w: number, h: number) => number} [aspect] displayed aspect ratio for a
 *   resolution; default: as the pixels (square pixels)
 * @returns {() => void} stops following size changes
 */
export function fitToBox(el, box, aspect = (w, h) => w / h) {
  const isCanvas = el instanceof HTMLCanvasElement;
  let frame = 0;

  const update = () => {
    frame = 0;
    const style = getComputedStyle(box);
    const boxW = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const boxH = box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const w = isCanvas ? el.width : el.offsetWidth;
    const h = isCanvas ? el.height : el.offsetHeight;
    if (!w || !h || boxW <= 0 || boxH <= 0) return;
    const ratio = aspect(w, h);
    const width = Math.min(boxW, boxH * ratio);
    const height = width / ratio;
    if (isCanvas) {
      el.style.setProperty('width', `${Math.floor(width)}px`, 'important');
      el.style.setProperty('height', `${Math.floor(height)}px`, 'important');
    } else {
      el.style.transformOrigin = 'center';
      el.style.transform = `scale(${width / w}, ${height / h})`;
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

  const resize = new ResizeObserver(schedule);
  resize.observe(box);
  if (!isCanvas) resize.observe(el);
  // Emulators change the canvas resolution by setting its width/height attributes.
  const attrs = new MutationObserver(schedule);
  attrs.observe(el, { attributes: true, attributeFilter: ['width', 'height'] });
  schedule();

  return () => { resize.disconnect(); attrs.disconnect(); cancelAnimationFrame(frame); };
}
