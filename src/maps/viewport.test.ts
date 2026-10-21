import { expect, it } from 'vitest';
import { revealNodeViewport } from './layout';

it('leaves a visible node alone and minimally reveals a new child without changing zoom', () => {
  const viewport = { x: 20, y: 30, zoom: 0.5 };
  const size = { width: 600, height: 400 };
  expect(revealNodeViewport(viewport, { x: 100, y: 100, height: 80 }, size)).toEqual(viewport);
  expect(revealNodeViewport(viewport, { x: 1000, y: -200, height: 80 }, size)).toEqual({ x: -84, y: 164, zoom: 0.5 });
});

it('centers an oversized node without altering the scale', () => {
  expect(revealNodeViewport({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0, height: 800 }, { width: 390, height: 300 })).toEqual({ x: 64, y: -250, zoom: 1 });
});
