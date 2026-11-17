import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
} from 'three';
import { satelliteColor } from '../app/palette';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { soleEnabled } from '../core/constellation';
import { footprintCircle } from '../core/ground';
import { extrapolatePosition, hasState, type Vec3 } from '../core/kinematics';
import { GROUND_LINE_RADIUS_KM } from './frame';

const SEGMENTS = 128;
const scratch: Vec3 = { x: 0, y: 0, z: 0 };

function dynamicAttribute(vertices: number): BufferAttribute {
  const attribute = new BufferAttribute(new Float32Array(vertices * 3), 3);
  attribute.setUsage(DynamicDrawUsage);
  return attribute;
}

/**
 * The selected satellite's footprint: a circle on the ground around everywhere
 * that has the satellite above its horizon right now, and a line dropped from
 * the satellite to the point directly beneath it.
 */
export function Footprint({ world }: { world: World }) {
  const { group, circle, drop } = useMemo(() => {
    const circle = new LineLoop(
      new BufferGeometry().setAttribute('position', dynamicAttribute(SEGMENTS)),
      new LineBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false }),
    );
    const drop = new Line(
      new BufferGeometry().setAttribute('position', dynamicAttribute(2)),
      new LineBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }),
    );
    circle.frustumCulled = false;
    drop.frustumCulled = false;
    const group = new Group().add(circle, drop);
    group.visible = false;
    return { group, circle, drop };
  }, []);

  useEffect(
    () => () => {
      for (const line of [circle, drop]) {
        line.geometry.dispose();
        line.material.dispose();
      }
    },
    [circle, drop],
  );

  useFrame(() => {
    const { selected, colorBy, filters } = useApp.getState();
    const { simulation } = world;
    group.visible = selected !== null && hasState(simulation.state, selected);
    if (selected === null || !group.visible) return;

    const color = satelliteColor(world, selected, colorBy, soleEnabled(filters.constellations));
    circle.material.color.set(color);
    drop.material.color.set(color);

    const dt = simulation.dtSeconds(currentSimTime());
    const p = extrapolatePosition(simulation.state, selected, dt, scratch);
    const edge = circle.geometry.getAttribute('position') as BufferAttribute;
    footprintCircle(p, SEGMENTS, GROUND_LINE_RADIUS_KM, edge.array as Float32Array);
    edge.needsUpdate = true;

    const toGround = GROUND_LINE_RADIUS_KM / Math.hypot(p.x, p.y, p.z);
    const ends = drop.geometry.getAttribute('position') as BufferAttribute;
    ends.setXYZ(0, p.x, p.y, p.z);
    ends.setXYZ(1, p.x * toGround, p.y * toGround, p.z * toGround);
    ends.needsUpdate = true;
  });

  return <primitive object={group} />;
}
