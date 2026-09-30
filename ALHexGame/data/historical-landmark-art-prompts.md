# Pacific campaign landmark atlas

- Generator: OpenAI built-in image generation.
- Source: `assets/terrain/source-sheets/wwii-pacific-landmarks.png`.
- Canvas: 1536 × 1024 RGBA; four 768 × 512 atlas frames, loaded at runtime in row-major order.
- Runtime frames: tropical runway and hangars; seaplane station and pier; naval yard and breakwater; island field headquarters.
- Art direction: watercolor historical map vignette, muted olive foliage, pale coral/sand, teal water, modest 1940s Pacific construction.
- Transparent-background edit: the source generation returned a visible checkerboard; the image was edited with transparent output, preserving the four scenes. The PNG was checked locally and its four outer corner alpha values are 0.
- SHA-256: `8f3afe8aff08b25ce2f2b82d2dcc903a18f28f81e4b542dd5f3c085379d444c3`.

The sheet is sliced into four canvases by `loadWatercolorTextures()` in `src/watercolor-textures.ts`. No existing source asset was overwritten.
