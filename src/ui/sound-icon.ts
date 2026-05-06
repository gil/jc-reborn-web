import { resumeAudioCtx, toggleMute } from '../audio/sound.js';

const SVG_ON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
const SVG_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

export function initSoundIcon(canvas: HTMLCanvasElement): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:block;width:fit-content;margin:0 auto;';
  canvas.style.margin = '0';
  canvas.parentNode!.insertBefore(wrap, canvas);
  wrap.appendChild(canvas);

  const btn = document.createElement('button');
  btn.innerHTML = SVG_ON;
  btn.style.cssText = [
    'position:absolute;top:8px;right:8px',
    'background:rgba(0,0,0,0.55)',
    'border:none;border-radius:4px;padding:5px',
    'cursor:pointer;color:#fff',
    'opacity:0;transition:opacity 0.15s',
    'line-height:0',
  ].join(';');

  wrap.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
  wrap.addEventListener('mouseleave', () => { btn.style.opacity = '0'; });

  let audioStarted = false;
  btn.addEventListener('click', async () => {
    if (!audioStarted) {
      await resumeAudioCtx();
      audioStarted = true;
    }
    const muted = toggleMute();
    btn.innerHTML = muted ? SVG_OFF : SVG_ON;
  });

  wrap.appendChild(btn);
}
