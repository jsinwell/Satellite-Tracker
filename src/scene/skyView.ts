import {
  BufferGeometry,
  Camera,
  Float32BufferAttribute,
  HalfFloatType,
  Mesh,
  NoBlending,
  Scene,
  ShaderMaterial,
  type WebGLRenderer,
} from 'three';
import { ATMOSPHERE_MARCH_GLSL, atmosphereUniforms, skyViewTarget } from './atmosphereGlsl';

const vertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  ${ATMOSPHERE_MARCH_GLSL}

  void main() {
    // Which row of the map this is, and which half of it: the light of the
    // air, or what gets through it.
    float rows = SKY_VIEW_ABOVE + SKY_VIEW_BELOW;
    float line = floor(gl_FragCoord.y);
    bool wantThrough = line >= rows;
    float row = wantThrough ? line - rows : line;
    bool ground = row < SKY_VIEW_BELOW;

    float angle = skyViewAngle(row);
    float turn = (gl_FragCoord.x / SKY_VIEW_WIDTH - 0.5) * 2.0 * SKY_PI;
    float r = SKY_BOTTOM + uSkyEyeHeight;
    vec3 direction = cos(angle) * uSkyEye / r
      + sin(angle) * (cos(turn) * uSkyViewAhead + sin(turn) * uSkyViewSide);

    // As skySpan, but a row's lines of sight end on the ground or do not by
    // which side of the horizon the row is for, however close to it they run.
    vec3 light = vec3(0.0);
    vec3 through = vec3(1.0);
    float b = dot(uSkyEye, direction);
    float top = b * b - (r - SKY_TOP) * (r + SKY_TOP);
    if (top > 0.0) {
      float end = -b + sqrt(top);
      if (end > 0.0) {
        float start = max(0.0, -b - sqrt(top));
        if (ground) {
          float low = b * b - uSkyEyeHeight * (r + SKY_BOTTOM);
          end = max(start, -b - sqrt(max(low, 0.0)));
        }
        skyMarch(direction, start, end, uSkySun, true, SKY_STEPS, light, through);
        // By night, the Moon's light in the air as well: the same blue sky
        // as by day, a few hundred thousand times fainter, and seen with
        // little of its color.
        if (!wantThrough && uSkyMoonlight.g > 0.0) {
          vec3 byMoon;
          vec3 unused;
          skyMarch(direction, start, end, uSkyMoon, false, MOON_SKY_STEPS, byMoon, unused);
          light += skyByNight(byMoon * uSkyMoonlight);
        }
      }
    }

    // Kept as square roots, as a picture's levels are: evenly spaced to the
    // eye, so that few of them go a long way.
    gl_FragColor = vec4(sqrt(wantThrough ? through : skyTone(light)), 1.0);
  }
`;

let scene: Scene | undefined;
const camera = new Camera();
const prepared = new WeakSet<WebGLRenderer>();

function createScene(): Scene {
  // One triangle that covers the map.
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new Mesh(
    geometry,
    new ShaderMaterial({
      uniforms: atmosphereUniforms(),
      vertexShader,
      fragmentShader,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    }),
  );
  mesh.frustumCulled = false;
  const made = new Scene();
  made.add(mesh);
  return made;
}

/**
 * Draws the map of the sky for where the camera is now: see `SKY_VIEW`. Once
 * a frame, after the atmosphere's uniforms are set and before anything that
 * reads the map is drawn.
 *
 * This is where the stepping through the air is done, some eighty thousand
 * lines of sight rather than one for each of the screen's million or more
 * pixels.
 */
export function renderSkyView(gl: WebGLRenderer): void {
  const target = skyViewTarget();
  if (!prepared.has(gl)) {
    prepared.add(gl);
    // Finer levels where the graphics card can draw to them. Asked for before
    // the first drawing, which is when the map's memory is set aside.
    if (
      gl.extensions.has('EXT_color_buffer_float') ||
      gl.extensions.has('EXT_color_buffer_half_float')
    ) {
      target.texture.type = HalfFloatType;
    }
  }
  scene ??= createScene();
  const previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  gl.render(scene, camera);
  gl.setRenderTarget(previous);
}
