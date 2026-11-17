import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  type WebGLRenderer,
} from 'three';

const vertexShader = /* glsl */ `
  uniform float uPixelRatio;

  attribute float size;
  attribute float alpha;

  varying float vAlpha;
  varying float vSize;

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vSize = size * uPixelRatio;
    gl_PointSize = vSize;
    vAlpha = alpha;
  }
`;

// A dot with a dark rim, so it stands out over bright desert and cloud as well
// as over the night side.
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;

  varying float vAlpha;
  varying float vSize;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float pixel = 2.0 / vSize;
    float disc = 1.0 - smoothstep(1.0 - pixel, 1.0, d);
    float core = 1.0 - smoothstep(0.6 - pixel, 0.6, d);
    if (disc <= 0.0) discard;
    vec3 rim = vec3(0.02, 0.03, 0.05);
    gl_FragColor = vec4(mix(rim, uColor, core), vAlpha * disc * mix(0.7, 1.0, core));
    #include <colorspace_fragment>
  }
`;

/**
 * Markers on the ground, a set number of CSS pixels across. Write their
 * positions, sizes (CSS px) and opacities, then call `update` with how many
 * to draw.
 */
export class GroundDots extends Points<BufferGeometry, ShaderMaterial> {
  readonly positions: Float32Array;
  readonly sizes: Float32Array;
  readonly alphas: Float32Array;

  constructor(capacity: number, color: string) {
    const positions = new Float32Array(capacity * 3);
    const sizes = new Float32Array(capacity);
    const alphas = new Float32Array(capacity).fill(1);
    const geometry = new BufferGeometry();
    for (const [name, array, itemSize] of [
      ['position', positions, 3],
      ['size', sizes, 1],
      ['alpha', alphas, 1],
    ] as const) {
      geometry.setAttribute(name, new BufferAttribute(array, itemSize).setUsage(DynamicDrawUsage));
    }
    geometry.setDrawRange(0, 0);

    super(
      geometry,
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color(color) }, uPixelRatio: { value: 1 } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.positions = positions;
    this.sizes = sizes;
    this.alphas = alphas;
    this.frustumCulled = false;
  }

  /** Uploads the dots and draws the first `count` of them. */
  update(count: number): void {
    this.geometry.setDrawRange(0, count);
    for (const name of ['position', 'size', 'alpha']) {
      this.geometry.getAttribute(name).needsUpdate = true;
    }
  }

  override onBeforeRender(renderer: WebGLRenderer): void {
    this.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  }

  /** Also frees the geometry and material, which belong to this object alone. */
  override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    super.dispose();
  }
}
