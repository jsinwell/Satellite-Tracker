import {
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector2,
  type WebGLRenderer,
} from 'three';

/**
 * WebGL draws `gl.LINES` one pixel wide on every platform that matters, which
 * is too thin to read over the Earth's imagery. This draws a polyline as a
 * strip of quads instead, a set number of CSS pixels wide however far away it
 * is, with an antialiased edge and an opacity per vertex.
 *
 * Each segment is one instance of a two-triangle quad. The vertex shader puts
 * the quad's corners either side of the segment's projected ends, so the width
 * is exact on screen. The segments overlap a little on the outside of a bend,
 * which only shows on sharp corners; the curves drawn here have none.
 */
const vertexShader = /* glsl */ `
  uniform vec2 uResolution;
  uniform float uWidth;

  attribute vec3 instanceStart;
  attribute vec3 instanceEnd;
  attribute float alphaStart;
  attribute float alphaEnd;

  varying float vAlpha;
  varying float vAcross;

  // Moves \`end\` along the segment onto the near plane.
  void trim(vec4 start, inout vec4 end) {
    float near = -0.5 * projectionMatrix[3][2] / projectionMatrix[2][2];
    end.xyz = mix(start.xyz, end.xyz, (near - start.z) / (end.z - start.z));
  }

  void main() {
    vec4 start = modelViewMatrix * vec4(instanceStart, 1.0);
    vec4 end = modelViewMatrix * vec4(instanceEnd, 1.0);
    // A segment that runs behind the camera would project inside out.
    if (start.z < 0.0 && end.z >= 0.0) trim(start, end);
    else if (end.z < 0.0 && start.z >= 0.0) trim(end, start);

    vec4 clipStart = projectionMatrix * start;
    vec4 clipEnd = projectionMatrix * end;
    vec2 along = (clipEnd.xy / clipEnd.w - clipStart.xy / clipStart.w) * uResolution;
    vec2 direction = dot(along, along) > 0.0 ? normalize(along) : vec2(1.0, 0.0);
    vec2 normal = vec2(-direction.y, direction.x);

    // Half the width, plus a pixel for the antialiased edge to fade over.
    float halfWidth = 0.5 * uWidth + 1.0;
    bool atEnd = position.y > 0.5;
    vec4 clip = atEnd ? clipEnd : clipStart;
    clip.xy += normal * (position.x * halfWidth * 2.0 / uResolution) * clip.w;
    gl_Position = clip;

    vAlpha = atEnd ? alphaEnd : alphaStart;
    vAcross = position.x * halfWidth;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uWidth;

  varying float vAlpha;
  varying float vAcross;

  void main() {
    float coverage = clamp(0.5 * uWidth + 0.5 - abs(vAcross), 0.0, 1.0);
    gl_FragColor = vec4(uColor, uOpacity * vAlpha * coverage);
    #include <colorspace_fragment>
  }
`;

/** One corner per vertex: x is the side of the line, y is which end. */
const QUAD = new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]);
/**
 * Counterclockwise on screen whichever way the segment runs, since the shader
 * always puts side −1 on its right, so that neither triangle is culled.
 */
const QUAD_INDEX = [0, 2, 1, 2, 3, 1];

const drawingBuffer = new Vector2();

interface ScreenLineOptions {
  /** How many points the line can hold. */
  capacity: number;
  /** CSS pixels. */
  width: number;
  color?: string;
  opacity?: number;
}

/**
 * A polyline drawn a fixed number of pixels wide. Write its points into
 * `positions` and their opacities into `alphas`, then call `update` with how
 * many points to draw.
 */
export class ScreenLine extends Mesh<InstancedBufferGeometry, ShaderMaterial> {
  readonly positions: Float32Array;
  readonly alphas: Float32Array;
  private readonly width: number;

  constructor({ capacity, width, color = '#ffffff', opacity = 1 }: ScreenLineOptions) {
    const positions = new Float32Array(capacity * 3);
    const alphas = new Float32Array(capacity).fill(1);
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(QUAD, 3));
    geometry.setIndex(QUAD_INDEX);

    // Each instance reads two consecutive points out of the same buffer, so a
    // polyline of n points is n − 1 segments without copying any of them.
    const points = new InstancedInterleavedBuffer(positions, 3, 1).setUsage(DynamicDrawUsage);
    geometry.setAttribute('instanceStart', new InterleavedBufferAttribute(points, 3, 0));
    geometry.setAttribute('instanceEnd', new InterleavedBufferAttribute(points, 3, 3));
    const fades = new InstancedInterleavedBuffer(alphas, 1, 1).setUsage(DynamicDrawUsage);
    geometry.setAttribute('alphaStart', new InterleavedBufferAttribute(fades, 1, 0));
    geometry.setAttribute('alphaEnd', new InterleavedBufferAttribute(fades, 1, 1));
    geometry.instanceCount = 0;

    const material = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(color) },
        uOpacity: { value: opacity },
        uWidth: { value: width },
        uResolution: { value: new Vector2(1, 1) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });

    super(geometry, material);
    this.positions = positions;
    this.alphas = alphas;
    this.width = width;
    // The points change every frame; a stale bounding sphere would cull them.
    this.frustumCulled = false;
  }

  get color(): Color {
    return this.material.uniforms.uColor.value;
  }

  /** Uploads the points and draws the first `count` of them. */
  update(count: number): void {
    this.geometry.instanceCount = Math.max(0, count - 1);
    (this.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute).data.needsUpdate =
      true;
    (this.geometry.getAttribute('alphaStart') as InterleavedBufferAttribute).data.needsUpdate =
      true;
  }

  override onBeforeRender(renderer: WebGLRenderer): void {
    const { uniforms } = this.material;
    uniforms.uResolution.value.copy(renderer.getDrawingBufferSize(drawingBuffer));
    uniforms.uWidth.value = this.width * renderer.getPixelRatio();
  }

  /** Also frees the geometry and material, which belong to this object alone. */
  override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    super.dispose();
  }
}
