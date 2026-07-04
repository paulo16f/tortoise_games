import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { SkeletonUtils } from "three-stdlib";
import { CanvasTexture, RepeatWrapping } from "three";
import type { Group } from "three";
import { DEPTHBREAKER_DUNGEON } from "@depthbreaker/protocol";
import { zoneStore } from "../../net/room";
import { localPlayerPos } from "../entityRefs";
import { DUNGEON_ASSETS, DUNGEON_ASSET_META, type DungeonAssetKey } from "./syntyDungeonAssets";

interface ModelPieceProps {
  asset: DungeonAssetKey;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  hideWhenBlocking?: boolean;
}

interface WallSegment {
  x: number;
  z: number;
  yaw: number;
  variant: "wall" | "wall_arch" | "wall_broken";
}

const TILE = DEPTHBREAKER_DUNGEON.tileSize;

function distanceToCameraRay2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const abLenSq = abx * abx + abz * abz;
  if (abLenSq < 0.0001) return { distance: Math.hypot(apx, apz), t: 0 };
  const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / abLenSq));
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return { distance: Math.hypot(px - cx, pz - cz), t };
}

function ModelPiece({ asset, position = [0, 0, 0], hideWhenBlocking = false, ...props }: ModelPieceProps) {
  const { scene } = useGLTF(DUNGEON_ASSETS[asset]);
  const camera = useThree((s) => s.camera);
  const meta = DUNGEON_ASSET_META[asset];
  const clone = useMemo(() => {
    const root = SkeletonUtils.clone(scene) as Group;
    root.traverse((obj) => {
      obj.castShadow = true;
      obj.receiveShadow = true;
    });
    return root;
  }, [scene]);

  useFrame(() => {
    if (!hideWhenBlocking) {
      clone.visible = true;
      return;
    }
    const p = localPlayerPos;
    const hit = distanceToCameraRay2D(position[0], position[2], camera.position.x, camera.position.z, p.x, p.z);
    clone.visible = !(hit.t > 0.08 && hit.t < 0.92 && hit.distance < 3.2);
  });

  return (
    <primitive
      object={clone}
      position={[position[0], position[1] + meta.yOffset, position[2]]}
      scale={props.scale ?? meta.visualScale}
      rotation={props.rotation}
    />
  );
}

function WallBlock({ wall }: { wall: WallSegment }) {
  const longOnX = Math.abs(Math.sin(wall.yaw)) < 0.5;
  return (
    <group position={[wall.x + (longOnX ? TILE / 2 : 0), 0.35, wall.z + (longOnX ? 0 : TILE / 2)]} rotation={[0, wall.yaw, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[TILE, 0.7, 0.28]} />
        <meshStandardMaterial color={wall.variant === "wall_broken" ? "#3f3a33" : "#50483c"} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.42, 0]} receiveShadow>
        <boxGeometry args={[TILE, 0.08, 0.34]} />
        <meshStandardMaterial color="#6b5f4e" roughness={0.9} />
      </mesh>
    </group>
  );
}

function createFloorTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#8b8378";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(52,46,40,0.5)";
  ctx.lineWidth = 4;
  const step = 64;
  for (let y = -step; y < canvas.height + step; y += step) {
    for (let x = -step; x < canvas.width + step; x += step) {
      ctx.beginPath();
      ctx.moveTo(x + 16, y);
      ctx.lineTo(x + 48, y);
      ctx.lineTo(x + 64, y + 28);
      ctx.lineTo(x + 48, y + 56);
      ctx.lineTo(x + 16, y + 56);
      ctx.lineTo(x, y + 28);
      ctx.closePath();
      ctx.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function CombatFloor({ rect, index }: { rect: { minX: number; maxX: number; minZ: number; maxZ: number }; index: number }) {
  const texture = useMemo(createFloorTexture, []);
  return (
    <mesh
      key={`base-floor-${index}`}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[(rect.minX + rect.maxX) / 2, -0.015, (rect.minZ + rect.maxZ) / 2]}
      receiveShadow
    >
      <planeGeometry args={[rect.maxX - rect.minX, rect.maxZ - rect.minZ]} />
      <meshStandardMaterial color="#8b8378" map={texture ?? undefined} roughness={0.85} />
    </mesh>
  );
}

function tileKey(x: number, z: number): string {
  return `${x}:${z}`;
}

function buildWalls(): WallSegment[] {
  const occupied = new Set(DEPTHBREAKER_DUNGEON.floorTiles.map((tile) => tileKey(tile.x, tile.z)));
  const walls: WallSegment[] = [];
  for (const tile of DEPTHBREAKER_DUNGEON.floorTiles) {
    const { x, z } = tile;
    if (!occupied.has(tileKey(x, z - TILE))) walls.push({ x, z, yaw: 0, variant: "wall" });
    if (!occupied.has(tileKey(x, z + TILE))) walls.push({ x, z: z + TILE, yaw: Math.PI, variant: z > 20 ? "wall_arch" : "wall" });
    if (!occupied.has(tileKey(x - TILE, z))) walls.push({ x, z, yaw: Math.PI / 2, variant: "wall" });
    if (!occupied.has(tileKey(x + TILE, z))) walls.push({ x: x + TILE, z, yaw: -Math.PI / 2, variant: "wall_broken" });
  }
  return walls;
}

export function Dungeon() {
  const walls = useMemo(buildWalls, []);

  const handleGroundClick = (ev: ThreeEvent<PointerEvent>) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    const targetId = zoneStore.state?.players.get(zoneStore.selfId)?.targetId ?? "";
    if (targetId) zoneStore.sendTarget("");
  };

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 14]} onPointerDown={handleGroundClick}>
        <planeGeometry args={[36, 54]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {DEPTHBREAKER_DUNGEON.walkable.map((rect, index) => <CombatFloor key={index} rect={rect} index={index} />)}

      {walls.map((wall, index) => (
        <WallBlock key={`wall-${index}`} wall={wall} />
      ))}

      {DEPTHBREAKER_DUNGEON.props.map((prop, index) => (
        <ModelPiece key={`prop-${index}`} asset={prop.asset} position={[prop.x, 0, prop.z]} rotation={[0, prop.yaw ?? 0, 0]} />
      ))}

      {/* Bridge/stairs GLBs are intentionally held back until their vertical bounds are normalized. */}
    </group>
  );
}
