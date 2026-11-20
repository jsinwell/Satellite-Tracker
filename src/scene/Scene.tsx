import { addAfterEffect, addEffect, Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useState } from 'react';
import { MARK_COLOR } from '../app/palette';
import { holdSimTime, releaseSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { Atmosphere } from './Atmosphere';
import { CameraRig } from './CameraRig';
import { Coverage } from './Coverage';
import { Earth, EarthPlaceholder } from './Earth';
import { CAMERA_FOV, TEME_GROUP_ROTATION, TEME_GROUP_SCALE } from './frame';
import { GroundTrack } from './GroundTrack';
import { Marker } from './Marker';
import { ObserverMarker } from './ObserverMarker';
import { OrbitPath } from './OrbitPath';
import { Picker } from './Picker';
import { PlanetDiscs } from './PlanetDiscs';
import { Planets } from './Planets';
import { SatelliteNames } from './SatelliteNames';
import { Satellites } from './Satellites';
import { SelectedName } from './SelectedName';
import { Sky } from './Sky';
import { SkyCompass } from './SkyCompass';
import { SunAndMoon } from './SunAndMoon';

const UnsupportedNotice = (
  <p className="p-6 text-center text-chalk/80">
    This browser cannot display the 3D view because WebGL is unavailable.
  </p>
);

/**
 * Whether a planet has been looked at closely yet. Their maps are a couple
 * of megabytes that most visits never need, so they wait for the first time.
 */
function useDiscsWanted(): boolean {
  const watchingPlanet = useApp((state) => state.watching !== null && state.watching !== 'moon');
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (watchingPlanet) setWanted(true);
  }, [watchingPlanet]);
  return wanted;
}

export function Scene({ world }: { world: World }) {
  const discsWanted = useDiscsWanted();
  // Everything in a frame is drawn for one instant: see `holdSimTime`.
  useEffect(() => {
    const stopHolding = addEffect(holdSimTime);
    const stopReleasing = addAfterEffect(releaseSimTime);
    return () => {
      stopHolding();
      stopReleasing();
      releaseSimTime();
    };
  }, []);

  return (
    <Canvas
      // `flat` disables tone mapping: colors here encode data and must not shift.
      flat
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: CAMERA_FOV, near: 0.05, far: 2000 }}
      fallback={UnsupportedNotice}
      aria-label="3D view of the Earth and the satellites orbiting it"
    >
      <color attach="background" args={['#05070d']} />
      <CameraRig world={world} />
      <Picker world={world} />
      <SkyCompass />
      <SatelliteNames world={world} />
      <SelectedName world={world} />
      <Atmosphere />

      <group rotation={[...TEME_GROUP_ROTATION]} scale={TEME_GROUP_SCALE}>
        {/* Loads after everything else; the plain background stands in until then. */}
        <Suspense fallback={null}>
          <Sky />
        </Suspense>
        <Suspense fallback={null}>
          <SunAndMoon />
        </Suspense>
        <Planets />
        {discsWanted && (
          <Suspense fallback={null}>
            <PlanetDiscs />
          </Suspense>
        )}
        <Suspense fallback={<EarthPlaceholder />}>
          <Earth />
        </Suspense>
        <Satellites world={world} />
        <OrbitPath world={world} />
        <Coverage world={world} />
        <GroundTrack world={world} />
        <ObserverMarker />
        <Marker world={world} target="hovered" color="#ffffff" size={18} />
        <Marker world={world} target="selected" color={MARK_COLOR} size={26} />
      </group>
    </Canvas>
  );
}
