# Depthbreaker Unity Project Setup

Companion to `docs/DEPTHBREAKER_TECHNICAL_DESIGN.md`. This directory ships the **scripts and manifest only** — Unity project files (`ProjectSettings/`, `Library/`, scenes, prefabs, `.meta` files) are created by following these steps on a Unity-capable machine. Everything here is **delivered unverified** until it compiles (design doc Appendix B #3).

## 1. Create the project

1. Install **Unity 6 LTS** via Unity Hub (6000.0.x). Include modules: **WebGL Build Support**, **Linux Dedicated Server Build Support**.
2. Create a new project from the **Universal 3D (URP)** template.
3. Close the editor. Copy this directory's `Assets/Scripts/` into the project's `Assets/`, and merge `Packages/manifest.json` into the project's `Packages/manifest.json` (or replace it — the shipped manifest lists URP, Input System, Addressables, uGUI, and the standard implicit modules; JSON forbids comments, so this file is the manifest's documentation).
4. Reopen the project. Unity resolves packages, including FishNet.

### Manifest notes

- **FishNet** installs via UPM git URL: `https://github.com/FirstGearGames/FishNet.git?path=Assets/FishNet` (already in the shipped manifest). Pin to a tag (append `#4.x.y`) once you pick a version.
- **Bayou (WebSocket transport) is NOT a UPM package.** Import it into `Assets/` from https://github.com/FirstGearGames/Bayou (download the release `.unitypackage` or copy the repo folder); it lands at `Assets/FishNet/Plugins/Bayou`.
- Version numbers in the manifest are current-at-writing; let Unity's Package Manager bump patch versions if resolution fails.
- Project Settings → Player → **Active Input Handling = Input System Package (New)** (the `ENABLE_INPUT_SYSTEM` guard in `PlayerInput.cs`/`CameraRig.cs` depends on it).

## 2. Assembly layout (already in Assets/Scripts)

| asmdef | References | Notes |
|---|---|---|
| `Depthbreaker.Shared` | none, `noEngineReferences: true` | Pure C# math contract — a future plain .NET test runner can execute the golden vectors from `../shared-spec/vectors/` without Unity. |
| `Depthbreaker.Data` | Shared | ScriptableObjects. |
| `Depthbreaker.Net` | Shared, Data, FishNet.Runtime | NetworkBehaviours. |
| `Depthbreaker.Client` | Shared, Data, Net, FishNet.Runtime, Unity.InputSystem | Input/camera/HUD/REST. |
| `Depthbreaker.Server` | Shared, Data, Net, FishNet.Runtime | Bootstrap + backend reporting (HttpClient — never ships to WebGL). |

## 3. NetworkManager prefab

1. Create an empty GameObject `NetworkManager`; add FishNet's **NetworkManager** component (auto-adds TimeManager, ServerManager, ClientManager, TransportManager, ObserverManager, SceneManager).
2. **TimeManager → Tick Rate = 30** (design doc D4; `ZoneServerBootstrap` logs an error if this drifts).
3. Add the **Bayou** component (after importing it, §1) and assign it as the transport on **TransportManager**:
   - **Port = 7770**
   - **Use WSS = false** — TLS terminates at nginx (design doc D3); Bayou speaks plain `ws://` behind the proxy. Local dev also runs plain ws.
4. **ObserverManager + GridCondition** (design doc §4.3): interest-management conditions are ScriptableObject assets and cannot be faked in code:
   - `Assets → Create → FishNet → Observers → Grid Condition` (menu path per FishNet version; see https://fish-networking.gitbook.io/docs/guides/features/observers).
   - Assign the GridCondition asset to the **ObserverManager**'s default conditions so every spawned object inherits it. Keep the default grid size until profiling says otherwise.
5. Add `NetworkLauncher` (from `Depthbreaker.Net`) to the same GameObject; assign the NetworkManager, the player prefab (§6), and the three ClassDefinition assets (§5).
6. Save as a prefab; place it in both scenes (§7) or in a persistent boot scene.

## 4. Verify at first compile

The following files use FishNet APIs written from documentation without a compiler present. Open each and resolve any signature drift **before doing anything else**:

| File | What to check | Doc |
|---|---|---|
| `Assets/Scripts/Net/PlayerMotor.cs` | `IReplicateData`/`IReconcileData` shape, `[Replicate]`/`[Reconcile]` signatures, `CreateReconcile()` override, `TimeManager.OnTick`/`OnPostTick` | https://fish-networking.gitbook.io/docs/guides/features/prediction/creating-code/controlling-an-object |
| `Assets/Scripts/Net/EnemyAI.cs` | `NetworkObject.Observers` access for AOI gating | https://fish-networking.gitbook.io/docs/guides/features/observers |
| `Assets/Scripts/Net/NetworkLauncher.cs` | `ServerManager.RegisterBroadcast<T>` handler signature, `ClientManager.Broadcast`, `Transport.SetPort`, dedicated-server flow | https://fish-networking.gitbook.io/docs/tutorials/simple/building-a-dedicated-server and https://fish-networking.gitbook.io/docs/fishnet-building-blocks/transports/bayou |

Also grep for `VERIFY-AT-COMPILE` across `Assets/Scripts/` — each marks a specific API assumption (SyncVar/SyncList declaration style, `ServerManager.Objects.Spawned`, `TimeManager.TickRate`).

## 5. Data assets

### ClassDefinition assets (design doc §5.1)

`Assets → Create → Depthbreaker → Skill Definition` (6×), then `Class Definition` (3×), under `Assets/Data/Classes/`:

| Class | classId | Skill 1 | Skill 2 |
|---|---|---|---|
| **Bruiser** (melee, attackRange ≈ 2.5) | Bruiser | **Cleave** — Damage, cooldown 6 s, small `aoeRadius` (frontal arc approximated as AoE in Phase 0) | **Bulwark** — Buff (self-shield), cooldown 12 s, range 0 (self) |
| **Mage** (ranged, attackRange ≈ 20) | Mage | **Fireball** — Damage, cooldown 4 s, single target | **Frost Nova** — Root, cooldown 14 s, `aoeRadius` > 0 |
| **Warden** (hybrid, attackRange ≈ 15) | Warden | **Mend** — Heal (self/ally), cooldown 8 s | **Empower** — Buff (ally damage), cooldown 16 s |

Cooldowns are normative (design doc §5.1); base stats / perLevel / powerRatio are tuning values — start anywhere sane (e.g. HP 100 + 10/level, Attack 10 + 1/level) and balance later. Assign all three assets to `NetworkLauncher`.

### Enemy + loot + room assets

- `Depthbreaker → Loot Table`: keep the default 60/25/10/4/1 rarity weights (spec §5); author item entries with stat keys `attack`, `armor`, `hp`, `critChance` (mapping in `Shared/StatBlock.cs`). **Entry order is normative RNG order — don't reorder authored lists.**
- `Depthbreaker → Enemy Definition`: leashDistance stays 40 (design doc §5.3).
- `Depthbreaker → Room Template`: one template per door-mask combination you build prefabs for; `DungeonBuilder` needs a template whose mask covers each generated room's doors or the cell stays empty.

## 6. Prefabs

**Player prefab** (`Assets/Prefabs/Player.prefab`) — components:

1. `NetworkObject` (FishNet)
2. `CharacterController` (radius ≈ 0.4, height ≈ 1.8)
3. `PlayerMotor` (Net)
4. `TargetableEntity` (Net)
5. `PlayerStats` (Net) — class assigned at spawn by NetworkLauncher
6. `PlayerCombat` (Net)
7. `PlayerRunInventory` (Net)
8. `PlayerInput` (Client)
9. `ClickTargeting` (Client)
10. Child mesh + collider on a targetable layer

Register the prefab with FishNet's spawnable prefabs (default: it's auto-added to the `DefaultPrefabObjects` collection on save).

**Enemy prefab** (`Assets/Prefabs/Enemy.prefab`) — components:

1. `NetworkObject`
2. `TargetableEntity`
3. `EnemyAI` — assign an EnemyDefinition
4. Child mesh + collider on the targetable layer

**Room prefabs**: modular geometry + `NetworkObject` + optional `EnemySpawner` (enemy prefab + definition assigned, respawn OFF for dungeon rooms).

## 7. Scenes

- **`Assets/Scenes/Hub.unity`** — persistent shared hub: ground plane, spawn point, `HubPortal` on an interactable object, NetworkManager (or boot-scene reference), `HudController` + uGUI canvas (HP/XP sliders, level/target texts, 2 cooldown images), `CameraRig` on a camera pivot, `BackendApiClient` on a bootstrap object.
- **`Assets/Scenes/Dungeon.unity`** — instanced run: NetworkManager reference, `RunManager` + `DungeonBuilder` + `LootDropper` on a scene object with a `NetworkObject`, plus `ZoneServerBootstrap` + `BackendReporter` on a plain GameObject. Server flow: ticket verified → `RunManager.ServerBeginRun(runId, seed, depth)` → `DungeonBuilder.ServerBuild(seed, depth)`.
- Add both scenes to Build Settings. Phase 0 runs one zone process per scene role (design doc §4.4).

## 8. WebGL player settings (design doc §8)

- **Publishing Settings → Compression Format = Brotli**; enable Decompression Fallback if your host can't serve `Content-Encoding: br` (itch.io). Serve over https — pages on https can only open `wss://`.
- **Memory:** set an explicit initial heap (e.g. 256 MB) and keep growth bounded; avoid relying on automatic heap growth (contiguous-allocation crashes).
- Graphics: WebGL2, URP **Forward** (Deferred unsupported on WebGL). Strip unused shader variants.
- No C# threads on WebGL — nothing in `Depthbreaker.Client` uses them; keep it that way (`System.Net.Http` is server-assembly-only).
- CORS/TLS: serve client + `/api` + `/game` behind one nginx origin (design doc §3) so cookies and CORS are non-issues.

## 9. Dedicated server build & run (design doc §9)

1. Build target: **Linux Dedicated Server** (`UNITY_SERVER` define set automatically).
2. Scenes: boot with the Dungeon (or Hub) scene first.
3. Run:

```sh
ZONE_PORT=7770 \
BACKEND_URL=http://backend:3000 \
ZONE_SHARED_SECRET=<same secret the backend signs tickets with> \
ZONE_ID=dungeon-1 \
./depthbreaker-server -batchmode -nographics
```

CLI fallbacks are also accepted: `-ZONE_PORT 7770 -BACKEND_URL ... -ZONE_SHARED_SECRET ... -ZONE_ID ...`.

Missing `ZONE_SHARED_SECRET` fails closed: `NetworkLauncher` refuses to start the server and `ZoneServerBootstrap`/`BackendReporter` log errors and drop nothing silently.

## 10. Local dev loop (Windows)

1. Backend: `games/depthbreaker/backend` → `npm run dev` (Postgres via Docker).
2. Server: second Unity editor instance (ParrelSync) or a server build with the env vars above; Bayou plain ws, no TLS locally.
3. Client: play mode in the editor → guest login → create character → start run → connect with the join ticket.
4. Watch the zone log for `Spawned character ... for account ...` and the backend log for the `/internal/runs/:id/finish` POST when you die.
