let el: HTMLElement | null = null;
let enabled = false;
let frameCount = 0;
let fpsTimer = 0;
let fps = 0;

export function initHud(): void {
  el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;top:8px;left:8px',
    'background:rgba(0,0,0,0.65)',
    'color:#0f0;font:11px monospace',
    'padding:4px 8px;border-radius:3px',
    'pointer-events:none;z-index:100',
    'display:none;white-space:pre',
  ].join(';');
  document.body.appendChild(el);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'H' && e.key !== 'h') return;
    enabled = !enabled;
    el!.style.display = enabled ? 'block' : 'none';
    if (enabled) { frameCount = 0; fpsTimer = performance.now(); }
  });
}

export function hudUpdate(threadCount: number, scene: string): void {
  frameCount++;
  if (!el || !enabled) return;
  const now = performance.now();
  if (now - fpsTimer >= 1000) {
    fps = Math.round(frameCount * 1000 / (now - fpsTimer));
    frameCount = 0;
    fpsTimer = now;
  }
  el.textContent = `FPS ${fps}  threads ${threadCount}\n${scene}`;
}
