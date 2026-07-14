// DEBUG overlay: paints a small green quad on every WALKABLE grid cell at the
// exact surface height the server stands entities on. Toggle with the "G" key.
// Use it to see whether the game's walkable area lines up with the intended
// floor (green) or is landing on the wrong surface (water/pillars). Remove once
// the map physics is confirmed.

import { useEffect, useMemo, useRef, useState } from "react";
import { DoubleSide, InstancedMesh, Object3D } from "three";
import { buildDungeon, groundHeightAt, isDungeonWalkable, type DungeonMapDefinition } from "@depthbreaker/protocol";
import { useZoneState } from "../../net/useZone";

function extent(d: DungeonMapDefinition) {
  const minX = Math.min(...d.walkable.map((r) => r.minX));
  const maxX = Math.max(...d.walkable.map((r) => r.maxX));
  const minZ = Math.min(...d.walkable.map((r) => r.minZ));
  const maxZ = Math.max(...d.walkable.map((r) => r.maxZ));
  return { minX, maxX, minZ, maxZ };
}

export function DebugWalkGrid() {
  const snap = useZoneState();
  const dungeon = useMemo(() => buildDungeon(snap.seed, snap.depth), [snap.seed, snap.depth]);
  const [on, setOn] = useState(false);
  const ref = useRef<InstancedMesh>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "g" || e.key === "G") setOn((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cells = useMemo(() => {
    if (!on) return [];
    const { minX, maxX, minZ, maxZ } = extent(dungeon);
    const out: [number, number, number][] = [];
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
      for (let z = Math.floor(minZ); z <= Math.ceil(maxZ); z++) {
        if (isDungeonWalkable(x, z, 0.1, dungeon)) out.push([x, groundHeightAt(x, z, dungeon), z]);
      }
    }
    return out;
  }, [on, dungeon]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh || cells.length === 0) return;
    const dummy = new Object3D();
    cells.forEach((c, i) => {
      dummy.position.set(c[0], c[1] + 0.15, c[2]);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = cells.length;
  }, [cells]);

  if (!on || cells.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, cells.length]}>
      <planeGeometry args={[0.9, 0.9]} />
      <meshBasicMaterial color="#22ff44" transparent opacity={0.5} side={DoubleSide} depthWrite={false} />
    </instancedMesh>
  );
}
