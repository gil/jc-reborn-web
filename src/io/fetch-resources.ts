export async function fetchData(): Promise<{ map: ArrayBuffer; archive: ArrayBuffer }> {
  const [mapRes, arcRes] = await Promise.all([
    fetch('/data/RESOURCE.MAP'),
    fetch('/data/RESOURCE.001'),
  ]);
  if (!mapRes.ok) throw new Error(`RESOURCE.MAP: ${mapRes.status}`);
  if (!arcRes.ok) throw new Error(`RESOURCE.001: ${arcRes.status}`);
  return { map: await mapRes.arrayBuffer(), archive: await arcRes.arrayBuffer() };
}
