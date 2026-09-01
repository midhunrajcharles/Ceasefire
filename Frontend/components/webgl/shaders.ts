// GLSL Shaders — ambient background field

export const backgroundVertexShader = `
  varying vec2 vUv;
  varying vec3 vPosition;
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uScrollVelocity;

  void main() {
    vUv = uv;
    vPosition = position;

    vec3 pos = position;

    // Wave distortion influenced by mouse & scroll velocity
    float dist = distance(uv, uMouse);
    float wave = sin(dist * 12.0 - uTime * 2.0) * 0.03 * exp(-dist * 2.5);
    float scrollWave = sin(pos.y * 3.0 + uTime) * uScrollVelocity * 0.05;

    pos.z += wave + scrollWave;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const backgroundFragmentShader = `
  varying vec2 vUv;
  varying vec3 vPosition;
  uniform float uTime;
  uniform vec2 uMouse;
  uniform vec2 uResolution;
  uniform float uScrollVelocity;
  uniform vec3 uColorBg;
  uniform vec3 uColorAccent1;
  uniform vec3 uColorAccent2;

  // Simplex-like noise helper
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vec2 st = gl_FragCoord.xy / uResolution.xy;
    st.x *= uResolution.x / uResolution.y;

    // Organic fluid movement
    vec2 mouseNorm = uMouse;
    float distMouse = length(vUv - mouseNorm);
    float mouseInfluence = smoothstep(0.6, 0.0, distMouse);

    float n1 = snoise(vUv * 2.0 + vec2(uTime * 0.08, uTime * 0.05));
    float n2 = snoise(vUv * 4.0 - vec2(uTime * 0.12, -uTime * 0.07) + n1 * 0.6);

    // Parallax & fluid swirl around cursor
    float swirl = sin(distMouse * 10.0 - uTime) * mouseInfluence * 0.15;
    float finalNoise = n2 + swirl + (uScrollVelocity * 0.2);

    // Pure ethereal colors — minimal ambient backdrop
    vec3 baseColor = vec3(0.985, 0.985, 0.99);
    vec3 gradient1 = vec3(0.93, 0.94, 0.97);
    vec3 gradient2 = vec3(0.89, 0.91, 0.95);

    vec3 col = mix(baseColor, gradient1, smoothstep(-0.5, 0.5, finalNoise));
    col = mix(col, gradient2, smoothstep(0.2, 0.9, finalNoise) * (0.35 + mouseInfluence * 0.3));

    // Subtle grain texture
    float grain = fract(sin(dot(vUv.xy + vec2(uTime * 0.01), vec2(12.9898,78.233))) * 43758.5453) * 0.025;
    col += grain;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const mediaVertexShader = `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uHover;
  uniform vec2 uMouse;
  uniform float uScrollVelocity;

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Kinetic bend on scroll
    float bend = sin(uv.y * 3.14159) * uScrollVelocity * 0.08;
    // Hover ripple
    float d = distance(uv, uMouse);
    float ripple = sin(d * 15.0 - uTime * 3.0) * 0.02 * uHover;

    pos.z += bend + ripple;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const mediaFragmentShader = `
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float uTime;
  uniform float uHover;
  uniform float uScrollVelocity;
  uniform float uOpacity;

  void main() {
    vec2 uv = vUv;

    // Chromatic aberration on hover or fast scroll
    float offset = (uHover * 0.008) + (abs(uScrollVelocity) * 0.005);

    float r = texture2D(uTexture, uv + vec2(offset, 0.0)).r;
    float g = texture2D(uTexture, uv).g;
    float b = texture2D(uTexture, uv - vec2(offset, 0.0)).b;
    float a = texture2D(uTexture, uv).a;

    vec4 finalColor = vec4(r, g, b, a * uOpacity);
    gl_FragColor = finalColor;
  }
`;
