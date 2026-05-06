import { BTN_STYLE } from './sound-icon.js';

const SVG_EXPAND = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
const SVG_COMPRESS = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>`;

export function initFullscreen(canvas: HTMLCanvasElement, controls: HTMLElement): void {
  const onSizeChange = () => {
    if (document.fullscreenElement) {
      const scale = Math.min(window.innerWidth / 640, window.innerHeight / 480);
      canvas.style.width  = Math.floor(640 * scale) + 'px';
      canvas.style.height = Math.floor(480 * scale) + 'px';
    } else {
      canvas.style.width = '';
      canvas.style.height = '';
    }
  };

  const toggle = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  document.addEventListener('fullscreenchange', onSizeChange);
  canvas.addEventListener('dblclick', toggle);

  const btn = document.createElement('button');
  btn.innerHTML = SVG_EXPAND;
  btn.style.cssText = BTN_STYLE;
  btn.addEventListener('click', toggle);
  document.addEventListener('fullscreenchange', () => {
    btn.innerHTML = document.fullscreenElement ? SVG_COMPRESS : SVG_EXPAND;
  });

  controls.appendChild(btn);
}
