import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { ACCENT_COLOR } from '../app/palette';
import type { World } from '../app/world';
import { CameraRig } from './CameraRig';
import { Coverage } from './Coverage';
import { Earth, EarthPlaceholder } from './Earth';
import { TEME_GROUP_ROTATION, TEME_GROUP_SCALE } from './frame';
import { GroundTrack } from './GroundTrack';
import { Marker } from './Marker';
import { OrbitPath } from './OrbitPath';
import { Picker } from './Picker';
import { Satellites } from './Satellites';
import { Sky } from './Sky';
import { SunAndMoon } from './SunAndMoon';

const UnsupportedNotice = (
  <p className="p-6 text-center text-slate-300">
    This browser cannot display the 3D view because WebGL is unavailable.
  </p>
);

export function Scene({ world }: { world: World }) {
  return (
    <Canvas
      // `flat` disables tone mapping: colors here encode data and must not shift.
      flat
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 35, near: 0.05, far: 2000 }}
      fallback={UnsupportedNotice}
      aria-label="3D view of the Earth and the satellites orbiting it"
    >
      <color attach="background" args={['#05070d']} />
      <CameraRig world={world} />
      <Picker world={world} />

      <group rotation={[...TEME_GROUP_ROTATION]} scale={TEME_GROUP_SCALE}>
        {/* Loads after everything else; the plain background stands in until then. */}
        <Suspense fallback={null}>
          <Sky />
        </Suspense>
        <Suspense fallback={null}>
          <SunAndMoon />
        </Suspense>
        <Suspense fallback={<EarthPlaceholder />}>
          <Earth />
        </Suspense>
        <Satellites world={world} />
        <OrbitPath world={world} />
        <Coverage world={world} />
        <GroundTrack world={world} />
        <Marker world={world} target="hovered" color="#ffffff" size={18} />
        <Marker world={world} target="selected" color={ACCENT_COLOR} size={26} />
      </group>
    </Canvas>
  );
}
