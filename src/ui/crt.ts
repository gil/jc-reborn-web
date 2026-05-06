import { BTN_STYLE } from './sound-icon.js';

const SVG_CRT = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="5" y1="7" x2="19" y2="7"/><line x1="5" y1="10" x2="19" y2="10"/><line x1="5" y1="13" x2="19" y2="13"/></svg>`;

const VERT = `#version 300 es
precision highp float;
const vec2 POSITIONS[4] = vec2[4](
  vec2(-1.0,-1.0), vec2(1.0,-1.0), vec2(-1.0,1.0), vec2(1.0,1.0)
);
const vec2 UVS[4] = vec2[4](
  vec2(0.0,0.0), vec2(1.0,0.0), vec2(0.0,1.0), vec2(1.0,1.0)
);
out vec2 vUv;
void main() {
  vUv = UVS[gl_VertexID];
  gl_Position = vec4(POSITIONS[gl_VertexID], 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTexture;
uniform float uTime;
uniform float uScanlineIntensity;
uniform float uScanlineCount;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
uniform float uBloomIntensity;
uniform float uBloomThreshold;
uniform float uRgbShift;
uniform float uAdaptiveIntensity;
uniform float uVignetteStrength;
uniform float uCurvature;
uniform float uFlickerStrength;
in vec2 vUv;
out vec4 fragColor;

const float PI = 3.14159265;
const vec3 LUMA = vec3(0.299, 0.587, 0.114);
const float RGB_SHIFT_SCALE = 0.005;
const float RGB_SHIFT_INTENSITY = 0.08;

vec2 curve(vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  c *= 1.0 + dot(c, c) * uCurvature * 0.25;
  return c * 0.5 + 0.5;
}

vec4 bloom(vec2 uv, float r, vec4 center) {
  return center * 0.4 + (
    texture(uTexture, uv + vec2(r, 0.0)) +
    texture(uTexture, uv - vec2(r, 0.0)) +
    texture(uTexture, uv + vec2(0.0, r)) +
    texture(uTexture, uv - vec2(0.0, r))
  ) * 0.15;
}

void main() {
  vec2 uv = vUv;

  if (uCurvature > 0.001) {
    uv = curve(uv);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      fragColor = vec4(0.0);
      return;
    }
  }

  vec4 pixel = texture(uTexture, uv);

  if (uBloomIntensity > 0.001) {
    float lum = dot(pixel.rgb, LUMA);
    if (lum > uBloomThreshold * 0.5) {
      vec4 b = bloom(uv, 0.005, pixel);
      b.rgb *= uBrightness;
      float bFactor = uBloomIntensity * max(0.0, (dot(b.rgb, LUMA) - uBloomThreshold) * 1.5);
      pixel.rgb += b.rgb * bFactor;
    }
  }

  if (uRgbShift > 0.005) {
    float s = uRgbShift * RGB_SHIFT_SCALE;
    pixel.r += texture(uTexture, vec2(uv.x + s, uv.y)).r * RGB_SHIFT_INTENSITY;
    pixel.b += texture(uTexture, vec2(uv.x - s, uv.y)).b * RGB_SHIFT_INTENSITY;
  }

  pixel.rgb *= uBrightness;
  float lum = dot(pixel.rgb, LUMA);
  pixel.rgb = (pixel.rgb - 0.5) * uContrast + 0.5;
  pixel.rgb = mix(vec3(lum), pixel.rgb, uSaturation);

  float mask = 1.0;

  if (uScanlineIntensity > 0.001) {
    float pattern = abs(sin(uv.y * uScanlineCount * PI));
    float adapt = (uAdaptiveIntensity > 0.001)
      ? 1.0 - (sin(uv.y * 30.0) * 0.5 + 0.5) * uAdaptiveIntensity * 0.2
      : 1.0;
    mask *= 1.0 - pattern * uScanlineIntensity * adapt;
  }

  if (uFlickerStrength > 0.001) {
    mask *= 1.0 + sin(uTime * 110.0) * uFlickerStrength;
  }

  if (uVignetteStrength > 0.001) {
    vec2 v = uv * 2.0 - 1.0;
    float d = max(abs(v.x), abs(v.y));
    mask *= max(0.0, 1.0 - d * d * uVignetteStrength);
  }

  pixel.rgb *= mask;
  fragColor = pixel;
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
  return s;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  return p;
}

export function initCrt(canvas: HTMLCanvasElement, controls: HTMLElement): void {
  const glCanvas = document.createElement('canvas');
  glCanvas.width = canvas.width;
  glCanvas.height = canvas.height;
  glCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;image-rendering:pixelated';
  canvas.insertAdjacentElement('afterend', glCanvas);

  const glOrNull = glCanvas.getContext('webgl2', { alpha: false });
  if (!glOrNull) return;
  const gl: WebGL2RenderingContext = glOrNull;

  const program = createProgram(gl);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0);

  const uloc = (n: string) => gl.getUniformLocation(program, n);
  const U = {
    time:              uloc('uTime'),
    scanlineIntensity: uloc('uScanlineIntensity'),
    scanlineCount:     uloc('uScanlineCount'),
    brightness:        uloc('uBrightness'),
    contrast:          uloc('uContrast'),
    saturation:        uloc('uSaturation'),
    bloomIntensity:    uloc('uBloomIntensity'),
    bloomThreshold:    uloc('uBloomThreshold'),
    rgbShift:          uloc('uRgbShift'),
    adaptiveIntensity: uloc('uAdaptiveIntensity'),
    vignetteStrength:  uloc('uVignetteStrength'),
    curvature:         uloc('uCurvature'),
    flickerStrength:   uloc('uFlickerStrength'),
  };

  gl.uniform1f(U.scanlineIntensity, 0.5);
  gl.uniform1f(U.scanlineCount,     256.0);
  gl.uniform1f(U.brightness,        1.5);
  gl.uniform1f(U.contrast,          1.05);
  gl.uniform1f(U.saturation,        1.1);
  gl.uniform1f(U.bloomIntensity,    0.5);
  gl.uniform1f(U.bloomThreshold,    0.5);
  gl.uniform1f(U.rgbShift,          1.0);
  gl.uniform1f(U.adaptiveIntensity, 0.3);
  gl.uniform1f(U.vignetteStrength,  0.3);
  gl.uniform1f(U.curvature,         0.1);
  gl.uniform1f(U.flickerStrength,   0.01);

  let enabled = false;
  let rafId = 0;

  function frame(ts: number): void {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.bindVertexArray(vao);
    gl.uniform1f(U.time, ts * 0.001);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (enabled) rafId = requestAnimationFrame(frame);
  }

  const STORAGE_KEY = 'crt-enabled';

  function applyEnabled(): void {
    if (enabled) {
      canvas.style.visibility = 'hidden';
      glCanvas.style.display = 'block';
      rafId = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(rafId);
      glCanvas.style.display = 'none';
      canvas.style.visibility = '';
    }
    btn.style.boxShadow = enabled ? '0 0 0 1px rgba(255,255,255,0.45)' : '';
    localStorage.setItem(STORAGE_KEY, String(enabled));
  }

  const btn = document.createElement('button');
  btn.innerHTML = SVG_CRT;
  btn.style.cssText = BTN_STYLE;

  btn.addEventListener('click', () => {
    enabled = !enabled;
    applyEnabled();
  });

  if (localStorage.getItem(STORAGE_KEY) === 'true') {
    enabled = true;
    applyEnabled();
  }

  controls.appendChild(btn);
}
