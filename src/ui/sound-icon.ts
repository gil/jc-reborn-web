import { resumeAudioCtx, toggleMute } from '../audio/sound.js';

const SVG_ON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
const SVG_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

export const BTN_STYLE = [
  'background:rgba(0,0,0,0.55)',
  'border:none;border-radius:4px;padding:5px',
  'cursor:pointer;color:#fff;line-height:0',
].join(';');

// Returns the controls container so other icons can be appended to it.
export function initSoundIcon(canvas: HTMLCanvasElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:block;width:fit-content;margin:0 auto;';
  canvas.style.margin = '0';
  canvas.parentNode!.insertBefore(wrap, canvas);
  wrap.appendChild(canvas);

  const controls = document.createElement('div');
  controls.style.cssText = [
    'position:absolute;top:8px;right:8px',
    'display:flex;gap:4px',
    'opacity:0;transition:opacity 0.15s',
  ].join(';');
  wrap.addEventListener('mouseenter', () => { controls.style.opacity = '1'; });
  wrap.addEventListener('mouseleave', () => { controls.style.opacity = '0'; });

  const btn = document.createElement('button');
  btn.innerHTML = SVG_OFF;
  btn.style.cssText = BTN_STYLE;

  let audioStarted = false;
  btn.addEventListener('click', async () => {
    if (!audioStarted) { await resumeAudioCtx(); audioStarted = true; }
    btn.innerHTML = toggleMute() ? SVG_ON : SVG_OFF;
  });

  controls.appendChild(btn);
  wrap.appendChild(controls);
  return controls;
}
