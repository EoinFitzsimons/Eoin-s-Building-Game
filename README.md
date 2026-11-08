# Eoin's Building Game

A first-person voxel building sandbox that runs entirely in the browser. Wander procedurally generated hills, forests and lakes, dig and build with eighteen kinds of block, stamp whole structures from a blueprint library, and watch the sun set over your work. Everything you see and hear is generated in code: there are no image or audio files in this repository.

**Play it:** https://eoinfitzsimons.github.io/Eoin-s-Building-Game/

![Eoin's Building Game](thumbnail.png)

## How to play

Click **New world** on the start menu (or **Continue saved world** if you have one), then click the game to capture the mouse pointer.

| Action | Control |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Jump | `Space` |
| Sprint | hold `Shift` |
| Toggle flying | `F` (hold `Space` to rise, `Shift` to descend) |
| Look | move the mouse |
| Place the selected block | left click |
| Break a block | right click |
| Pick the block you are looking at | middle click |
| Choose a block | mouse wheel or keys `1` to `9` |
| Show the second page of blocks | `Tab` |
| Open or close blueprint mode | `B` |
| Choose a blueprint | mouse wheel or `[` and `]` |
| Rotate the blueprint | `R` |
| Stamp the blueprint | left click (in blueprint mode) |
| Skip time to dusk or dawn | `N` |
| Mute or unmute sound | `M` |
| Hide or show the control hints | `H` |
| Pause menu | `Esc` |

A full day lasts eight minutes. The world saves itself automatically every half minute and whenever you pause or leave the page.

## Features

- **Procedural terrain** – a seeded world of rolling hills, stone peaks capped with snow, sandy shores, gravel beds, oak forests and still water. Type any word into the seed box to get a different landscape; the same seed always produces the same world.
- **Eighteen blocks with hand-drawn textures** – grass, dirt, stone, cobblestone, stone bricks, mossy stone, sand, sandstone, gravel, snow, oak logs, leaves, planks, brick, roof tiles, glass, lanterns and water. Every texture is painted onto a canvas at start-up, so the game ships with no image files.
- **Day and night cycle** – the sun and moon track across the sky, the light and fog colours shift through dawn, noon, dusk and night, stars come out and lanterns glow once it is dark.
- **Blueprint mode** – a creative tool that places a translucent preview of a prebuilt structure where you are looking and stamps it into the world with one click. Nine blueprints are included: a cottage, a watchtower, a bridge, a well, an oak tree, a stone arch, a garden wall, a lamp post and a pond. Blueprints can be rotated in quarter turns.
- **Save, load, export and import** – your world is saved to `localStorage` as a seed plus the list of blocks you have changed, so even large builds stay small. The pause menu can export the world as a JSON file and import one back, which makes it easy to share builds or move them between browsers.
- **Synthesised sound** – place and break clicks tuned to the material (wooden knocks, stony thuds, glassy chimes), soft footsteps, menu clicks and an ambient wind bed that grows stronger as you climb. All of it is generated with the Web Audio API; there are no audio files. `M` mutes everything and the preference is remembered.
- **Smooth performance** – the world is split into 16 × 16 × 64 chunks that are meshed on demand with hidden faces culled and simple ambient occlusion baked into the vertex colours. Only chunks within the render distance (adjustable from the pause menu) are built, and editing a block rebuilds just the chunk it belongs to.
- **Start and pause menus** – a start screen with the controls, seed entry and a summary of your saved world, plus a pause menu with save, export, import, sound and render-distance options.

## Running locally

The game is a static site with no build step. It uses ES modules, so it needs to be served over HTTP rather than opened from the file system:

```bash
git clone https://github.com/EoinFitzsimons/Eoin-s-Building-Game.git
cd Eoin-s-Building-Game
python3 -m http.server 8000
```

Then open http://localhost:8000/ in a modern browser (Chrome, Edge, Firefox or Safari). Three.js is loaded from the jsDelivr CDN, so an internet connection is required the first time.

Handy URL parameters for testing: `?seed=<word>` skips the menu and starts a new world straight away, and `?thumbnail` hides the HUD for taking screenshots.

## Technical notes

| File | Purpose |
| --- | --- |
| `index.html` | Page structure: canvas, HUD, hotbar, blueprint panel, start and pause menus. |
| `style.css` | All styling, including the menus and the responsive hotbar. |
| `game.js` | Game controller: Three.js scene, player physics, input, targeting, building, blueprints, day/night sky, saving and the menus. |
| `js/world.js` | Seeded value-noise terrain, chunk storage, sparse edit tracking, greedy-free face meshing with ambient occlusion, and a voxel raycaster. |
| `js/blocks.js` | Block definitions and the procedural texture painters that build the 32 px texture atlas on a canvas at start-up. |
| `js/blueprints.js` | Structure definitions written as text layers, with rotation support. |
| `js/audio.js` | Web Audio synthesiser for clicks, footsteps and wind. |

- **Rendering** – Three.js (0.154) with a single `MeshLambertMaterial` atlas for opaque blocks, a separate transparent pass for glass, leaves and water, and an emissive pass for lanterns. Chunk meshes are rebuilt through a small queue so that generation never blocks a frame for long.
- **Terrain** – fractal Brownian motion over a hashed value-noise function gives continents, hills and ridges; a second noise layer picks biomes (sand near the water line, gravel in low ground, snow on peaks) and a hashed per-column check plants trees on open grass.
- **Persistence** – saves are `{ version, seed, time, player, edits: [[x, y, z, blockId], ...] }`. The same shape is used for the JSON export, so an exported file can be imported anywhere.
- **No dependencies beyond Three.js** – there is no bundler, package manager or framework; the repository can be served as-is from GitHub Pages.

## Licence

MIT – see [LICENSE](LICENSE).
