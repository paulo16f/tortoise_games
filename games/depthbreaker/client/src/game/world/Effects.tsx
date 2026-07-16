import { EffectComposer, N8AO, Bloom, HueSaturation, BrightnessContrast, Vignette, SMAA } from "@react-three/postprocessing";

// Post chain: subtle bloom on emissives (crystals, portal, combat FX), a
// saturation/contrast/vignette grade, and SMAA edge AA.
//
// N8AO is OFF by default: with `enableNormalPass` it forces a full second render
// of the whole 366-mesh island every frame for the normal buffer, which was a
// top GPU cost. Add `?ao=1` to the URL to A/B the old look.
const AO_ENABLED = new URLSearchParams(window.location.search).has("ao");

export function Effects() {
  return (
    <EffectComposer multisampling={0} enableNormalPass={AO_ENABLED}>
      {AO_ENABLED ? <N8AO aoRadius={1.6} distanceFalloff={3.6} intensity={2.6} quality="low" halfRes /> : <></>}
      <Bloom luminanceThreshold={0.85} intensity={0.35} radius={0.6} mipmapBlur />
      <HueSaturation saturation={0.04} />
      <BrightnessContrast brightness={-0.01} contrast={0.12} />
      <Vignette offset={0.28} darkness={0.42} />
      <SMAA />
    </EffectComposer>
  );
}
