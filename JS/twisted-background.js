/**
 * Twisted Stream — GPU particle background.
 *
 * A self-contained rewrite of Ryan The Developer's "A Twisted Stream" WebGL demo,
 * adapted to run as a themeable, runtime-configurable background layer.
 *
 * How it works: particle state lives in a floating point texture that is twice as
 * wide as it is tall. The left half stores positions, the right half stores
 * velocities, both encoded around 0.5. Every frame the simulation reads that
 * texture and writes the next state into a second one (ping-pong), then a point
 * cloud samples the position half in its vertex shader to place itself in space.
 *
 * A separate 256x256 "force" texture carries the pointer influence, so pushing
 * the cursor around deflects the stream. It can be switched off entirely.
 */

const QUAD_VERTEX_SHADER = `
precision highp float;

attribute vec2 aPosition;

varying vec2 vUv;

void main(void) {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FORCE_FRAGMENT_SHADER = `
precision mediump float;

varying vec2 vUv;

uniform vec2 uPointer;
uniform float uRadius;
uniform float uStrength;

const float HALF_PI = 1.5707963;

void main(void) {
  // 0.5 is "no force"; the sim reads this map as a signed offset around 0.5.
  vec4 force = vec4(0.5, 0.5, 0.5, 1.0);

  vec2 delta = vUv - uPointer;
  float distance = length(delta);

  if (distance < uRadius && uRadius > 0.0) {
    float falloff = sin((1.0 - distance / uRadius) * HALF_PI);
    vec2 direction = distance > 0.0001 ? delta / distance : vec2(0.0);
    force.rg += direction * falloff * uStrength;
  }

  gl_FragColor = force;
}
`;

const SIMULATION_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;

uniform sampler2D uState;
uniform sampler2D uForce;
uniform float uTime;
uniform float uVelocityScale;
uniform float uAccelerationScale;
uniform float uNoiseScale;
uniform float uForceInfluence;

const float DAMPING = 0.9963;
const float AXIS_PULL = 0.05;

vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec3 damp(vec3 value, float amount) { return (value - vec3(0.5)) * amount + vec3(0.5); }

float rand(vec2 co) { return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453); }

// A particle is spent once it has drifted off the head of the stream or strayed
// too far from it vertically; spent particles respawn at the tail.
bool isSpent(vec3 position) {
  return position.r < 0.01 || position.r > 1.01 || position.g < 0.1 || position.g > 0.9;
}

void main(void) {
  if (vUv.x < 0.5) {
    vec3 position = texture2D(uState, vUv).rgb;
    vec3 velocity = texture2D(uState, vec2(vUv.x + 0.5, vUv.y)).rgb;

    position += (velocity - vec3(0.5)) * uVelocityScale;

    if (isSpent(position)) {
      position = vec3(0.5)
        + (vec3(rand(position.rg), rand(position.gb), rand(position.br)) - vec3(0.5)) * 0.15;
      position.r = 1.0 + rand(position.yz) * 0.01;
    }

    gl_FragColor = vec4(position, 1.0);
    return;
  }

  vec3 position = texture2D(uState, vec2(vUv.x - 0.5, vUv.y)).rgb;
  vec3 velocity = texture2D(uState, vUv).rgb;
  vec3 nextPosition = position + (velocity - vec3(0.5)) * uVelocityScale;

  vec3 centred = position - vec3(0.5);

  // Curl-ish acceleration from simplex noise. The x term is biased negative so
  // the whole field keeps drifting along -x: that drift is the "stream".
  float accelX = (snoise(vec3(centred.x * uNoiseScale, centred.y * uNoiseScale, uTime)) - 1.0) * 0.5;
  float accelY = snoise(vec3(centred.y * uNoiseScale, centred.z * uNoiseScale, uTime));
  float accelZ = snoise(vec3(centred.z * uNoiseScale, centred.x * uNoiseScale, uTime));

  velocity += vec3(accelX, accelY, accelZ) * uAccelerationScale;
  velocity = damp(velocity, DAMPING);

  // Keep the stream tubular: anything past the (noisy) radius gets pulled back in.
  vec2 offAxisVelocity = velocity.yz - vec2(0.5);
  float maxRadius = 0.08 + snoise(vec3(position.x * 5.0, uTime, 0.0)) * 0.06;
  float radius = length(centred.yz);
  if (radius > maxRadius) {
    offAxisVelocity -= normalize(centred.yz) * ((radius - maxRadius) * AXIS_PULL);
  }
  velocity.yz = offAxisVelocity + vec2(0.5);

  if (uForceInfluence > 0.0) {
    vec3 force = texture2D(uForce, position.xy).rgb;
    velocity.xy += (force.xy - vec2(0.5)) * uForceInfluence;
  }

  if (isSpent(nextPosition)) {
    velocity = vec3(0.3 + rand(nextPosition.xy) * 0.1, 0.5, 0.5);
  }

  gl_FragColor = vec4(velocity, 1.0);
}
`;

const PARTICLE_VERTEX_SHADER = `
precision highp float;

attribute vec2 aLookup;
attribute float aSeed;

uniform sampler2D uState;
uniform mat4 uProjectionView;
// Per-axis world scale. x is stretched to span the viewport while y and z follow
// it proportionally, so the stream keeps its shape at any size.
uniform vec3 uSpread;
// Slides the stream along its own axis to frame the two ends independently.
uniform float uOffsetX;
uniform float uPointSize;
uniform float uFadeWidth;

varying float vAlpha;

void main(void) {
  vec3 position = texture2D(uState, aLookup).rgb - vec3(0.5);

  // Fade in at the tail and out at the head so the stream has no hard ends.
  // uFadeWidth is the fraction of the run spent fading, so a small value keeps
  // the stream at full brightness until it is nearly at the viewport edge.
  float travelled = 1.0 - abs(position.x) * 2.0;
  vAlpha = smoothstep(0.0, uFadeWidth, travelled) * aSeed;

  vec3 world = position * uSpread;
  world.x += uOffsetX;

  gl_Position = uProjectionView * vec4(world, 1.0);
  gl_PointSize = uPointSize;
}
`;

const PARTICLE_FRAGMENT_SHADER = `
precision mediump float;

uniform vec3 uColor;
uniform float uOpacity;

varying float vAlpha;

void main(void) {
  float alpha = clamp(vAlpha, 0.0, 1.0) * uOpacity;
  // Premultiplied, so the same shader works with additive and alpha blending.
  gl_FragColor = vec4(uColor * alpha, alpha);
}
`;

const FIELD_OF_VIEW = 45;
const NEAR_PLANE = 5;
const FAR_PLANE = 5000;
const FORCE_MAP_SIZE = 256;
const REDUCED_MOTION_FRAMES = 200;

/* Flow tuning at speed 1. VELOCITY_SCALE is how fast particles travel;
   TIME_STEP is how quickly the noise field itself churns. */
const VELOCITY_SCALE = 0.013;
const ACCELERATION_SCALE = 0.0012;
const NOISE_SCALE = 4.5;
const TIME_STEP = 0.001;

/* Fraction of the run spent fading in/out at each end (0..0.5). Smaller means
   particles stay bright closer to the edges of the viewport. */
const FADE_WIDTH = 0.2;

/* Where each end of the stream sits, as a fraction of the viewport half-width
   measured from the centre — so 1.0 is exactly on the edge and anything above
   that is off screen. Particles are born at the left end and dissipate at the
   right one, so the right is kept inside the frame to leave that dissolve
   visible. The view matrix mirrors x, so world +x is the left of the screen. */
const HEAD_EDGE = 0.94;
const TAIL_EDGE = 0.86;

/* The stream is fitted to the viewport on both axes, so the camera distance
   only decides how strongly perspective reads and can stay fixed. */
const CAMERA_DISTANCE = 1100;

/* Tube diameter as a fraction of the stream's length. Tying thickness to length
   rather than to a fixed world size is what keeps the stream looking like the
   same stream on a phone and on a widescreen monitor. */
const TUBE_THICKNESS = 0.23;

/* How far from its axis the simulation lets particles drift, in normalised
   units — the counterpart of the radius clamp in the simulation shader. */
const TUBE_HALF_EXTENT = 0.15;

/** Grid sides the particle-count control can step through. */
export const SIMULATION_SIZES = [128, 160, 192, 224, 256, 320, 384, 448, 512];

const PALETTE_DEFAULTS = {
  color: [0.8, 0.07, 0.07],
  background: [0.03, 0.03, 0.04],
  additive: true,
  opacity: 1,
};

/* -------------------------------------------------------------------------- */
/* Matrix helpers (column major, just what this scene needs)                   */
/* -------------------------------------------------------------------------- */

function perspective(fovDegrees, aspect, near, far) {
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
  const range = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * range, -1,
    0, 0, 2 * far * near * range, 0,
  ]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** View matrix looking down -z from `distance`, with +y pointing at the screen bottom. */
function streamView(distance) {
  return new Float32Array([
    -1, 0, 0, 0,
    0, -1, 0, 0,
    0, 0, 1, 0,
    0, 0, -distance, 1,
  ]);
}

function rotationYX(yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  // rotateY(yaw) * rotateX(pitch)
  return new Float32Array([
    cy, 0, -sy, 0,
    sy * sx, cx, cy * sx, 0,
    sy * cx, -sx, cy * cx, 0,
    0, 0, 0, 1,
  ]);
}

/* -------------------------------------------------------------------------- */
/* WebGL helpers                                                              */
/* -------------------------------------------------------------------------- */

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${log}`);
  }
  return shader;
}

/** Links a program and pre-resolves every active uniform and attribute location. */
function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }

  const uniforms = {};
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uniformCount; i++) {
    const { name } = gl.getActiveUniform(program, i);
    uniforms[name] = gl.getUniformLocation(program, name);
  }

  const attributes = {};
  const attributeCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < attributeCount; i++) {
    const { name } = gl.getActiveAttrib(program, i);
    attributes[name] = gl.getAttribLocation(program, name);
  }

  return { program, uniforms, attributes };
}

function createStaticBuffer(gl, data) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

function createRenderTarget(gl, width, height, { internalFormat, format, type }) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  if (!complete) {
    gl.deleteTexture(texture);
    gl.deleteFramebuffer(framebuffer);
    return null;
  }

  return { texture, framebuffer, width, height };
}

function disposeRenderTarget(gl, target) {
  if (!target) return;
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.framebuffer);
}

/**
 * Picks the highest precision colour-renderable float format the driver supports.
 * The simulation stores positions slightly outside [0,1], so 8-bit targets are
 * not an option — if nothing float-capable is available we bail out entirely.
 */
function resolveFloatFormat(gl, isWebGL2) {
  const candidates = [];

  if (isWebGL2) {
    if (gl.getExtension('EXT_color_buffer_float')) {
      candidates.push(
        { internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT },
        { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT },
      );
    }
    if (gl.getExtension('EXT_color_buffer_half_float')) {
      candidates.push({ internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT });
    }
  } else {
    if (gl.getExtension('OES_texture_float')) {
      candidates.push({ internalFormat: gl.RGBA, format: gl.RGBA, type: gl.FLOAT });
    }
    const halfFloat = gl.getExtension('OES_texture_half_float');
    if (halfFloat) {
      candidates.push({ internalFormat: gl.RGBA, format: gl.RGBA, type: halfFloat.HALF_FLOAT_OES });
    }
  }

  for (const candidate of candidates) {
    const probe = createRenderTarget(gl, 4, 4, candidate);
    if (probe) {
      disposeRenderTarget(gl, probe);
      return candidate;
    }
  }

  return null;
}

function toHalfFloat(source) {
  const out = new Uint16Array(source.length);
  const scratch = new Float32Array(1);
  const bits = new Uint32Array(scratch.buffer);
  for (let i = 0; i < source.length; i++) {
    scratch[0] = source[i];
    const value = bits[0];
    const sign = (value >>> 16) & 0x8000;
    const exponent = ((value >>> 23) & 0xff) - 112;
    const mantissa = value & 0x7fffff;
    if (exponent <= 0) out[i] = sign;
    else if (exponent >= 0x1f) out[i] = sign | 0x7c00;
    else out[i] = sign | (exponent << 10) | (mantissa >> 13);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The stream keeps its proportions across viewports, so the area it covers on
 * screen grows with the square of the viewport width. Scaling the grid side
 * linearly with that width therefore holds the particle density — and the look
 * of the thing — constant, while keeping small devices cheap to render.
 */
export function defaultSimulationSize() {
  const ideal = window.innerWidth * 0.36;
  return SIMULATION_SIZES.reduce((best, size) =>
    Math.abs(size - ideal) < Math.abs(best - ideal) ? size : best,
  );
}

/** Settings the user can change at runtime, and what they start at. */
export function defaultSettings() {
  return {
    pointerForce: false,
    simulationSize: defaultSimulationSize(),
    speed: 1,
    autoRotate: true,
    zoom: 1,
    yaw: 0,
    pitch: 0,
  };
}

/**
 * Starts the background on `canvas`.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ maxPixelRatio?: number, reducedMotion?: boolean, settings?: object }} [options]
 * @returns {object | null} `null` when the device cannot run the simulation, so
 *   the caller can fall back gracefully.
 */
export function createTwistedBackground(canvas, options = {}) {
  const contextOptions = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  };

  const gl =
    canvas.getContext('webgl2', contextOptions) ||
    canvas.getContext('webgl', contextOptions);

  if (!gl) return null;

  const isWebGL2 =
    typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

  // The particle vertex shader samples a texture, which not every driver allows.
  if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 1) return null;

  const floatFormat = resolveFloatFormat(gl, isWebGL2);
  if (!floatFormat) return null;

  const maxPixelRatio = options.maxPixelRatio ?? 1.5;

  let reducedMotion = options.reducedMotion ?? false;
  let palette = { ...PALETTE_DEFAULTS };
  let settings = { ...defaultSettings(), ...options.settings };

  /* ---- programs -------------------------------------------------------- */

  let forcePass;
  let simulationPass;
  let particlePass;
  try {
    forcePass = createProgram(gl, QUAD_VERTEX_SHADER, FORCE_FRAGMENT_SHADER);
    simulationPass = createProgram(gl, QUAD_VERTEX_SHADER, SIMULATION_FRAGMENT_SHADER);
    particlePass = createProgram(gl, PARTICLE_VERTEX_SHADER, PARTICLE_FRAGMENT_SHADER);
  } catch (error) {
    console.warn('[twisted-background] disabled:', error.message);
    return null;
  }

  const quadBuffer = createStaticBuffer(gl, new Float32Array([-1, -1, 3, -1, -1, 3]));

  const forceMap = createRenderTarget(gl, FORCE_MAP_SIZE, FORCE_MAP_SIZE, {
    internalFormat: isWebGL2 ? gl.RGBA8 : gl.RGBA,
    format: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
  });
  if (!forceMap) return null;

  /* ---- simulation resources -------------------------------------------- */

  let simulationSize = 0;
  let stateWidth = 0;
  let particleCount = 0;
  let lookupBuffer = null;
  let seedBuffer = null;
  let front = null;
  let back = null;

  function disposeSimulation() {
    if (lookupBuffer) gl.deleteBuffer(lookupBuffer);
    if (seedBuffer) gl.deleteBuffer(seedBuffer);
    disposeRenderTarget(gl, front);
    disposeRenderTarget(gl, back);
    lookupBuffer = seedBuffer = front = back = null;
  }

  /** Seeds the stream: positions spread along x, velocities all pointing at -x. */
  function seedState(target) {
    const pixels = new Float32Array(stateWidth * simulationSize * 4);
    for (let row = 0; row < simulationSize; row++) {
      for (let column = 0; column < simulationSize; column++) {
        const positionIndex = (row * stateWidth + column) * 4;
        pixels[positionIndex] = Math.random();
        pixels[positionIndex + 1] = 0.4 + Math.random() * 0.2;
        pixels[positionIndex + 2] = 0.4 + Math.random() * 0.2;
        pixels[positionIndex + 3] = 1;

        const velocityIndex = (row * stateWidth + simulationSize + column) * 4;
        pixels[velocityIndex] = 0.35;
        pixels[velocityIndex + 1] = 0.5;
        pixels[velocityIndex + 2] = 0.5;
        pixels[velocityIndex + 3] = 1;
      }
    }

    const data = floatFormat.type === gl.FLOAT ? pixels : toHalfFloat(pixels);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, floatFormat.internalFormat, stateWidth, simulationSize, 0,
      floatFormat.format, floatFormat.type, data,
    );
  }

  /** (Re)allocates everything that depends on the particle grid size. */
  function buildSimulation(size) {
    disposeSimulation();

    simulationSize = size;
    stateWidth = size * 2;
    particleCount = size * size;

    const lookups = new Float32Array(particleCount * 2);
    const seeds = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      const column = i % size;
      const row = Math.floor(i / size);
      // Texel centre inside the position (left) half of the state texture.
      lookups[i * 2] = (column + 0.5) / stateWidth;
      lookups[i * 2 + 1] = (row + 0.5) / size;
      seeds[i] = Math.random() * 0.9 + 0.1;
    }

    lookupBuffer = createStaticBuffer(gl, lookups);
    seedBuffer = createStaticBuffer(gl, seeds);

    front = createRenderTarget(gl, stateWidth, size, floatFormat);
    back = createRenderTarget(gl, stateWidth, size, floatFormat);
    if (!front || !back) return false;

    seedState(front);
    return true;
  }

  if (!buildSimulation(settings.simulationSize)) return null;

  /* ---- camera ---------------------------------------------------------- */

  let streamSpreadX = 1000;
  let streamSpreadYZ = 1000;
  let streamOffsetX = 0;
  let visibleHalfWidth = 1;
  let visibleHalfHeight = 1;
  let projectionView = new Float32Array(16);
  let yaw = 0;
  let pitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  let pixelRatio = 1;

  function resize() {
    pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
    const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const aspect = width / height;
    const tanHalfFov = Math.tan((FIELD_OF_VIEW * Math.PI) / 360);
    visibleHalfHeight = CAMERA_DISTANCE * tanHalfFov;
    visibleHalfWidth = visibleHalfHeight * aspect;

    // Length: the two ends land where HEAD_EDGE and TAIL_EDGE ask for them, at
    // any aspect ratio. Zoom scales that framing — above 1 the ends run off the
    // sides, below 1 the whole stream shrinks into the middle of the viewport.
    // position.x spans [-0.5, 0.5], hence the doubling of the half-span.
    const zoom = settings.zoom;
    streamSpreadX = visibleHalfWidth * (HEAD_EDGE + TAIL_EDGE) * zoom;
    streamOffsetX = visibleHalfWidth * ((HEAD_EDGE - TAIL_EDGE) / 2) * zoom;

    // Thickness follows the length rather than staying at a fixed world size,
    // otherwise a narrow viewport shrinks the stream lengthways while the tube
    // keeps its girth and the whole thing collapses into a blob.
    streamSpreadYZ = (streamSpreadX * TUBE_THICKNESS) / (2 * TUBE_HALF_EXTENT);
  }

  function updateCamera() {
    const aspect = canvas.width / canvas.height;
    const projection = perspective(FIELD_OF_VIEW, aspect, NEAR_PLANE, FAR_PLANE);
    const view = multiply(projection, streamView(CAMERA_DISTANCE));
    projectionView = multiply(view, rotationYX(yaw, pitch));
  }

  /* ---- pointer force --------------------------------------------------- */

  const pointer = { x: -1, y: -1, speed: 0, active: false };
  const force = { radius: 0, strength: 0 };
  let lastPointer = null;

  function updatePointer(clientX, clientY) {
    const viewportWidth = canvas.clientWidth;
    const viewportHeight = canvas.clientHeight;
    if (!viewportWidth || !viewportHeight) return;

    // Screen -> world (at z = 0) -> normalised simulation space, inverting the
    // same stretch and offset the particle shader applies.
    const worldX = -((2 * clientX) / viewportWidth - 1) * visibleHalfWidth;
    const worldY = ((2 * clientY) / viewportHeight - 1) * visibleHalfHeight;
    const next = {
      x: (worldX - streamOffsetX) / streamSpreadX + 0.5,
      y: worldY / streamSpreadYZ + 0.5,
    };

    if (lastPointer) {
      pointer.speed = Math.min(
        1,
        Math.hypot(next.x - lastPointer.x, next.y - lastPointer.y) * 6,
      );
    }

    lastPointer = next;
    pointer.x = next.x;
    pointer.y = next.y;
    pointer.active = true;
  }

  function onPointerMove(event) {
    if (settings.pointerForce) updatePointer(event.clientX, event.clientY);
  }

  function onPointerLeave() {
    pointer.active = false;
    lastPointer = null;
  }

  /* ---- passes ---------------------------------------------------------- */

  function drawFullscreenQuad(pass) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(pass.attributes.aPosition);
    gl.vertexAttribPointer(pass.attributes.aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(pass.attributes.aPosition);
  }

  function renderForceMap() {
    const idleStrength = pointer.active ? 0.1 : 0;
    const targetStrength = Math.min(0.55, idleStrength + pointer.speed * 0.45);
    const targetRadius = pointer.active ? 0.08 + targetStrength * 0.35 : 0;

    force.strength += (targetStrength - force.strength) * 0.12;
    force.radius += (targetRadius - force.radius) * 0.12;
    pointer.speed *= 0.9;

    gl.bindFramebuffer(gl.FRAMEBUFFER, forceMap.framebuffer);
    gl.viewport(0, 0, forceMap.width, forceMap.height);
    gl.useProgram(forcePass.program);
    gl.uniform2f(forcePass.uniforms.uPointer, pointer.x, pointer.y);
    gl.uniform1f(forcePass.uniforms.uRadius, force.radius);
    gl.uniform1f(forcePass.uniforms.uStrength, force.strength);
    gl.disable(gl.BLEND);
    drawFullscreenQuad(forcePass);
  }

  function stepSimulation(time) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, back.framebuffer);
    gl.viewport(0, 0, back.width, back.height);
    gl.useProgram(simulationPass.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, front.texture);
    gl.uniform1i(simulationPass.uniforms.uState, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, forceMap.texture);
    gl.uniform1i(simulationPass.uniforms.uForce, 1);

    gl.uniform1f(simulationPass.uniforms.uTime, time);
    gl.uniform1f(simulationPass.uniforms.uVelocityScale, VELOCITY_SCALE * settings.speed);
    gl.uniform1f(simulationPass.uniforms.uAccelerationScale, ACCELERATION_SCALE);
    gl.uniform1f(simulationPass.uniforms.uNoiseScale, NOISE_SCALE);
    gl.uniform1f(simulationPass.uniforms.uForceInfluence, settings.pointerForce ? 0.5 : 0);

    gl.disable(gl.BLEND);
    drawFullscreenQuad(simulationPass);

    const swap = front;
    front = back;
    back = swap;
  }

  function renderParticles() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(palette.background[0], palette.background[1], palette.background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(particlePass.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, front.texture);
    gl.uniform1i(particlePass.uniforms.uState, 0);
    gl.uniformMatrix4fv(particlePass.uniforms.uProjectionView, false, projectionView);
    gl.uniform3f(particlePass.uniforms.uSpread, streamSpreadX, streamSpreadYZ, streamSpreadYZ);
    gl.uniform1f(particlePass.uniforms.uOffsetX, streamOffsetX);
    gl.uniform1f(particlePass.uniforms.uPointSize, Math.max(1, pixelRatio));
    gl.uniform1f(particlePass.uniforms.uFadeWidth, FADE_WIDTH);
    gl.uniform3fv(particlePass.uniforms.uColor, palette.color);
    gl.uniform1f(particlePass.uniforms.uOpacity, palette.opacity);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, palette.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);

    gl.bindBuffer(gl.ARRAY_BUFFER, lookupBuffer);
    gl.enableVertexAttribArray(particlePass.attributes.aLookup);
    gl.vertexAttribPointer(particlePass.attributes.aLookup, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, seedBuffer);
    gl.enableVertexAttribArray(particlePass.attributes.aSeed);
    gl.vertexAttribPointer(particlePass.attributes.aSeed, 1, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, particleCount);

    gl.disableVertexAttribArray(particlePass.attributes.aLookup);
    gl.disableVertexAttribArray(particlePass.attributes.aSeed);
  }

  /** Draws one frame without advancing the simulation. */
  function repaint() {
    if (destroyed) return;
    updateCamera();
    renderParticles();
  }

  /* ---- loop ------------------------------------------------------------ */

  let frame = 0;
  // Accumulated rather than derived from the frame count, so changing the speed
  // never makes the noise field jump.
  let simulationTime = 0;
  let animationId = null;
  let running = false;
  let destroyed = false;

  function tick() {
    if (destroyed) return;

    // Under reduced-motion we let the stream form, then hold a still frame.
    if (reducedMotion && frame > REDUCED_MOTION_FRAMES) {
      running = false;
      animationId = null;
      return;
    }

    animationId = requestAnimationFrame(tick);

    if (settings.autoRotate && !reducedMotion) {
      const drift = frame * 0.0015;
      targetYaw = Math.sin(drift) * 0.16;
      targetPitch = Math.cos(drift * 0.7) * 0.07;
    } else {
      targetYaw = settings.yaw;
      targetPitch = settings.pitch;
    }

    yaw += (targetYaw - yaw) * 0.03;
    pitch += (targetPitch - pitch) * 0.03;

    updateCamera();
    if (settings.pointerForce) renderForceMap();
    simulationTime += TIME_STEP * settings.speed;
    stepSimulation(simulationTime);
    renderParticles();

    frame++;
  }

  function start() {
    if (running || destroyed) return;
    running = true;
    animationId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (animationId !== null) cancelAnimationFrame(animationId);
    animationId = null;
  }

  /* ---- events ---------------------------------------------------------- */

  const onResize = () => {
    resize();
    if (!running) repaint();
  };

  const onVisibilityChange = () => {
    if (document.hidden) stop();
    else if (!reducedMotion || frame <= REDUCED_MOTION_FRAMES) start();
  };

  const onContextLost = (event) => {
    event.preventDefault();
    stop();
  };

  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', onPointerLeave, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  canvas.addEventListener('webglcontextlost', onContextLost, false);

  resize();
  start();

  return {
    /**
     * @param {{ color?: number[], background?: number[], additive?: boolean, opacity?: number }} next
     */
    setPalette(next) {
      palette = { ...palette, ...next };
      if (!running) repaint();
    },

    setReducedMotion(value) {
      reducedMotion = value;
      if (!value) {
        frame = 0;
        start();
      }
    },

    /**
     * Applies a partial settings update. Changing the grid size reallocates the
     * simulation, so it is only done when the value actually differs.
     *
     * @returns {boolean} false if a grid resize failed and the previous size was
     *   restored — the caller can surface that rather than silently ignoring it.
     */
    configure(next) {
      const previousSize = settings.simulationSize;
      settings = { ...settings, ...next };

      let ok = true;
      if (settings.simulationSize !== previousSize) {
        if (!buildSimulation(settings.simulationSize)) {
          settings.simulationSize = previousSize;
          buildSimulation(previousSize);
          ok = false;
        }
      }

      if (!settings.autoRotate) {
        // Jump straight there rather than easing from wherever the drift left off.
        targetYaw = settings.yaw;
        targetPitch = settings.pitch;
      }

      resize();
      if (!running) repaint();
      return ok;
    },

    getSettings() {
      return { ...settings };
    },

    getParticleCount() {
      return particleCount;
    },

    destroy() {
      destroyed = true;
      stop();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      disposeSimulation();
      disposeRenderTarget(gl, forceMap);
      gl.deleteBuffer(quadBuffer);
    },
  };
}
