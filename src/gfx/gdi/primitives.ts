import { brushColorAt, colorIndex } from './color.js';
import { activeClip, plot, type ClipRect, type DrawState, type Surface } from './surface.js';

export function setPixel(surface: Surface, state: DrawState, x: number, y: number, color: number): void {
  plot(surface, activeClip(surface, state), x, y, colorIndex(color));
}

export function drawLine(surface: Surface, state: DrawState, x1: number, y1: number, x2: number, y2: number): void {
  lineTo(surface, activeClip(surface, state), x1, y1, x2, y2, colorIndex(state.foreground));
}

export function drawRect(surface: Surface, state: DrawState, x: number, y: number, w: number, h: number): void {
  const clip = activeClip(surface, state);
  const pen = colorIndex(state.foreground);
  if (!state.fill || w < 2 || h < 2) {
    const right = x + w - 1;
    const bottom = y + h - 1;
    lineTo(surface, clip, x, y, right, y, pen);
    lineTo(surface, clip, right, y, right, bottom, pen);
    lineTo(surface, clip, right, bottom, x, bottom, pen);
    lineTo(surface, clip, x, bottom, x, y, pen);
    return;
  }
  if (state.foreground === state.background) {
    fillWithBrush(surface, clip, x, y, x + w, y + h, state.background);
    return;
  }
  fillWithBrush(surface, clip, x + 1, y + 1, x + w - 1, y + h - 1, state.background);
  for (let px = x; px < x + w; px++) {
    plot(surface, clip, px, y, pen);
    plot(surface, clip, px, y + h - 1, pen);
  }
  for (let py = y + 1; py < y + h - 1; py++) {
    plot(surface, clip, x, py, pen);
    plot(surface, clip, x + w - 1, py, pen);
  }
}

export function drawCircle(surface: Surface, state: DrawState, r: number, cx: number, cy: number): void {
  const clip = activeClip(surface, state);
  const pen = colorIndex(state.foreground);
  const inside = (px: number, py: number) => (px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2 <= r * r;
  for (let py = cy - r; py < cy + r; py++) {
    for (let px = cx - r; px < cx + r; px++) {
      if (!inside(px, py)) continue;
      const border = !inside(px - 1, py) || !inside(px + 1, py) || !inside(px, py - 1) || !inside(px, py + 1);
      plot(surface, clip, px, py, border ? pen : brushColorAt(state.background, px, py));
    }
  }
}

function lineTo(surface: Surface, clip: ClipRect, x1: number, y1: number, x2: number, y2: number, index: number): void {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x2 >= x1 ? 1 : -1;
  const sy = y2 >= y1 ? 1 : -1;
  const major = Math.max(dx, dy);
  const minor = Math.min(dx, dy);
  let error = major >> 1;
  let x = x1;
  let y = y1;
  for (let i = 0; i < major; i++) {
    plot(surface, clip, x, y, index);
    error -= minor;
    const stepMinor = error < 0;
    if (stepMinor) error += major;
    if (dx >= dy) {
      x += sx;
      if (stepMinor) y += sy;
    } else {
      y += sy;
      if (stepMinor) x += sx;
    }
  }
}

function fillWithBrush(surface: Surface, clip: ClipRect, left: number, top: number, right: number, bottom: number, color: number): void {
  for (let py = top; py < bottom; py++) {
    for (let px = left; px < right; px++) plot(surface, clip, px, py, brushColorAt(color, px, py));
  }
}
