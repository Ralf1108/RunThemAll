// Scales an emulator screen (canvas or text element) to the largest size that fits
// into the emulator area while keeping its aspect ratio. Works for the normal page
// and for fullscreen, since it follows the size of the area.

/**
 * Keeps `el` as large as possible inside `box` (aspect ratio kept).
 * Canvases are resized via CSS width/height, so mouse coordinates stay correct
 * (the emulators scale them by the displayed size). Other elements (v86 text mode)
 * are scaled with a CSS transform.
 * @param {HTMLElement} el
 * @param {HTMLElement} box
 * @returns {() => void} stops following size changes
 */
export function fitToBox(el, box) {
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
    const scale = Math.min(boxW / w, boxH / h);
    if (isCanvas) {
      el.style.setProperty('width', `${Math.floor(w * scale)}px`, 'important');
      el.style.setProperty('height', `${Math.floor(h * scale)}px`, 'important');
    } else {
      el.style.transformOrigin = 'center';
      el.style.transform = `scale(${scale})`;
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
