// Shared mutable position of the local player, written by the local Player mesh
// every frame and read by the CameraRig. A plain object avoids routing per-frame
// positions through React state.

import { Vector3 } from "three";

export const localPlayerPos = new Vector3(0, 0, 0);
