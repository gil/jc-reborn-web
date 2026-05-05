// Screensaver bootstrap — implemented in Task 4+
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
ctx.fillStyle = '#000';
ctx.fillRect(0, 0, 640, 480);
