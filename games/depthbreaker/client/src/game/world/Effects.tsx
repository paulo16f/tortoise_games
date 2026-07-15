import { EffectComposer, N8AO, Bloom, HueSaturation, BrightnessContrast, Vignette, SMAA } from "@react-three/postprocessing";

// Post chain emulating world-of-claudecraft's look: ambient occlusion to ground
// objects and shade corners, a subtle bloom on emissives (crystals, portal,
// combat FX), a saturation/contrast/vignette grade, and SMAA edge AA. AO renders
// half-res so it stays cheap.
export function Effects() {
  return (
    <EffectComposer multisampling={0} enableNormalPass>
      <N8AO aoRadius={1.6} distanceFalloff={3.6} intensity={2.6} quality="low" halfRes />
      <Bloom luminanceThreshold={0.85} intensity={0.35} radius={0.6} mipmapBlur />
      <HueSaturation saturation={0.04} />
      <BrightnessContrast brightness={-0.01} contrast={0.12} />
      <Vignette offset={0.28} darkness={0.42} />
      <SMAA />
    </EffectComposer>
  );
}
