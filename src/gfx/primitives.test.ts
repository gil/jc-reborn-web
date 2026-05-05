import { describe, it, expect } from 'vitest';
import { makeLayer } from './layer.js';
import { putPixel, drawLine, drawRect } from './primitives.js';
import { SCREEN_W, TRANSPARENT } from '../types.js';

describe('putPixel', () => {
  it('writes color at index', () => {
    const l = makeLayer();
    putPixel(l, 100, 50, 7);
    expect(l.indexed[50 * SCREEN_W + 100]).toBe(7);
  });
  it('drops out-of-bounds writes', () => {
    const l = makeLayer();
    putPixel(l, -1, 0, 7);
    putPixel(l, 0, -1, 7);
    putPixel(l, 9999, 0, 7);
    expect(l.indexed.every(v => v === TRANSPARENT)).toBe(true);
  });
});

describe('drawLine', () => {
  it('horizontal line writes pixels', () => {
    const l = makeLayer();
    drawLine(l, 10, 5, 20, 5, 3);
    expect(l.indexed[5 * SCREEN_W + 10]).toBe(3);
    expect(l.indexed[5 * SCREEN_W + 19]).toBe(3);
  });
});

describe('drawRect', () => {
  it('fills inclusive area', () => {
    const l = makeLayer();
    drawRect(l, 0, 0, 2, 2, 9);
    expect(l.indexed[0]).toBe(9);
    expect(l.indexed[1]).toBe(9);
    expect(l.indexed[SCREEN_W]).toBe(9);
    expect(l.indexed[SCREEN_W + 1]).toBe(9);
    expect(l.indexed[2]).toBe(TRANSPARENT);
  });
});
