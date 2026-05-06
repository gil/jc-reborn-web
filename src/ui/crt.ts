import { BTN_STYLE } from './sound-icon.js';

const SVG_CRT = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="5" y1="7" x2="19" y2="7"/><line x1="5" y1="10" x2="19" y2="10"/><line x1="5" y1="13" x2="19" y2="13"/></svg>`;

export function initCrt(canvas: HTMLCanvasElement, controls: HTMLElement): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:absolute;inset:0;pointer-events:none;display:none',
    'background-image:' +
      'repeating-linear-gradient(0deg,transparent,transparent 1px,rgba(0,0,0,0.25) 1px,rgba(0,0,0,0.25) 3px),' +
      'radial-gradient(ellipse at 50% 50%,transparent 55%,rgba(0,0,0,0.45) 100%)',
  ].join(';');

  // Insert between canvas and controls so overlay doesn't stack above the buttons
  canvas.insertAdjacentElement('afterend', overlay);

  const btn = document.createElement('button');
  btn.innerHTML = SVG_CRT;
  btn.style.cssText = BTN_STYLE;

  btn.addEventListener('click', () => {
    const on = overlay.style.display === 'none';
    overlay.style.display = on ? 'block' : 'none';
    btn.style.boxShadow = on ? '0 0 0 1px rgba(255,255,255,0.45)' : '';
  });

  controls.appendChild(btn);
}
