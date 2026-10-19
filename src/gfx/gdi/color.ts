export function colorIndex(color: number): number {
  return color & 0x0f;
}

export function brushColorAt(color: number, x: number, y: number): number {
  if (color < 16) return color;
  const high = color >> 4;
  const low = color & 0x0f;
  const highFirst = (y & 1) === 1;
  const evenColumn = highFirst ? high : low;
  const oddColumn = highFirst ? low : high;
  return (x & 1) === 0 ? evenColumn : oddColumn;
}
