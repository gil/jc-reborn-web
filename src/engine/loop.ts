export function startLoop(onTick: () => void, onRender: () => void): () => void {
  let stopped = false;
  const frame = () => {
    if (stopped) return;
    onTick();
    onRender();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return () => { stopped = true; };
}
