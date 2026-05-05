import { describe, it, expect } from 'vitest';
import { makeLayer } from './layer.js';
import { drawSprite, drawSpriteFlip } from './sprite.js';
import { SCREEN_W, TRANSPARENT, type Sprite } from '../types.js';

const sp: Sprite = {
  width: 2, height: 2,
  indexed: new Uint8Array([1, TRANSPARENT, TRANSPARENT, 2]),
};

describe('drawSprite', () => {
  it('honors transparent index', () => {
    const l = makeLayer();
    drawSprite(l, sp, 5, 5);
    expect(l.indexed[5 * SCREEN_W + 5]).toBe(1);
    expect(l.indexed[5 * SCREEN_W + 6]).toBe(TRANSPARENT);
    expect(l.indexed[6 * SCREEN_W + 5]).toBe(TRANSPARENT);
    expect(l.indexed[6 * SCREEN_W + 6]).toBe(2);
  });
});

describe('drawSpriteFlip', () => {
  it('mirrors columns horizontally', () => {
    const l = makeLayer();
    drawSpriteFlip(l, sp, 0, 0);
    // original row0=[1,X] row1=[X,2] → flipped row0=[X,1] row1=[2,X]
    expect(l.indexed[0]).toBe(TRANSPARENT);
    expect(l.indexed[1]).toBe(1);
    expect(l.indexed[SCREEN_W]).toBe(2);
    expect(l.indexed[SCREEN_W + 1]).toBe(TRANSPARENT);
  });
});
