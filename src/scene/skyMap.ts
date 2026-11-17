import { LinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * Sets up NASA's star map to wrap a sphere whose poles are on the celestial
 * poles and whose +x axis is RA 0h, with RA increasing toward +y.
 *
 * The map is an equirectangular image in celestial coordinates, with RA 0h at
 * its center and RA increasing to the *left*, as the sky looks from inside.
 * SphereGeometry lays `u` out the other way round, so the image is mirrored.
 * `skyMap.test.ts` checks the result against the positions of known stars.
 */
export function configureSkyMap(texture: Texture): void {
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.repeat.x = -1;
  // The sky is never drawn much smaller than its native resolution, so mipmaps
  // would only cost memory: a third more on a texture that is already large.
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
}
