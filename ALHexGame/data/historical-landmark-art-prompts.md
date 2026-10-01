# Pacific campaign landmark art

The earlier landmark scenes used a low three-quarter camera and a sharper, more realistic render style than the watercolor map. These replacements keep a high overhead plan view and borrow the softer paint texture, muted palette, and light linework of the existing map art. Their flat magenta key background is removed with `tools/prepare_landmark_art.py`.

- Generator: OpenAI built-in image generation tool.
- Keyed source files: `data/landmark-art-source/`.
- Final runtime files: `assets/terrain/landmarks/wwii-*.png`.
- Output: four standalone RGBA PNGs with transparent backgrounds; source dimensions are recorded in `data/campaign-landmark-art.json`.
- Art direction: compact WWII Pacific fixed facilities in the game's hand-painted watercolor style: soft pigment washes, subtle paper grain, muted olive, sage, faded ochre and warm grey, softened edges, and restrained sepia outlines. Keep the high overhead plan view; aircraft and other moving vehicles are separate sprites loaded from existing game assets.
- The original combined sheet at `assets/terrain/source-sheets/wwii-pacific-landmarks.png` is retained for comparison and is no longer used at runtime.

## Shared prompt direction

Create a standalone WWII fixed-facility cluster as a game-map sprite. Preserve the high overhead plan view: show roofs, decks, and static equipment footprints clearly. Match the hand-painted watercolor style of `assets/terrain/directional/watercolor-harbor-0-east.png` and `assets/terrain/land-details/watercolor-land-detail-2-rocky-grassland.png`: translucent pigment washes, subtle cold-press paper grain, softly varied color, gently irregular painted edges, muted sage, olive, faded ochre, warm grey, and restrained thin sepia contours. Simplify material details to broad painterly marks. Avoid photorealism, metallic shine, precise wood grain, dense panel lines, thick black outlines, hard shadows, and a 3D-render appearance. Objects only, no aircraft, boats, trucks, other vehicles, ground plate, island, water plane, drop shadow, or lighting halo. Center a compact composition and keep every object fully inside frame. Set the background to perfectly flat chroma-key magenta #FF00FF. No labels, flags, text, border, or people.

## Airfield

Airfield: compact top-down plan with one large corrugated hangar roof, two small shed roofs, a mast footprint, crates, and fuel drums. Leave aircraft and vehicles out; the renderer places existing aircraft sprites from `assets/combat/` as a separate layer. No runway plate or continuous terrain.

## Seaplane station

Seaplane station: top-down plan view of a timber pier with two shed roofs, fuel drums and crates. Leave floatplanes and service boats out; the renderer places an existing aircraft sprite from `assets/combat/` as a separate layer. No visible building facades, no water, no shoreline.

## Naval yard

Naval repair yard: overhead layout with a wooden repair pier, straight rail track, one corrugated workshop roof, a compact crane base and boom footprint seen directly from above, timber, barrels, and crates. Keep the crane low and flat in the plan view; no upright tower or side elevation, no basin, ship, or water. Muted olive, sand, weathered metal and timber on a perfectly uniform flat chroma-key magenta #FF00FF background.

## Field headquarters

Field headquarters: overhead layout of one timber command hut roof, one canvas tent seen from above, a radio mast footprint with radial guy lines, a short sandbag line, and field supplies. No visible hut walls, no ground patch. Muted olive and canvas tan on a perfectly uniform flat chroma-key magenta #FF00FF background.
