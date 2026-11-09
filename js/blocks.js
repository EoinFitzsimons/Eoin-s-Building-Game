// Block definitions and procedurally drawn textures.
// Every texture is painted onto a canvas at start-up; the repository holds no image files.

export const TILE = 32;          // pixels per texture tile
const ATLAS_COLUMNS = 8;

// Small deterministic random number generator so textures look the same on every load.
function makeRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function shade([r, g, b], amount) {
    return `rgb(${clamp(Math.round(r * amount), 0, 255)},${clamp(Math.round(g * amount), 0, 255)},${clamp(Math.round(b * amount), 0, 255)})`;
}

// Fill a tile with a base colour and speckled noise.
function speckle(ctx, base, rnd, variance = 0.12, density = 1) {
    for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
            if (rnd() > density) continue;
            ctx.fillStyle = shade(base, 1 + (rnd() - 0.5) * 2 * variance);
            ctx.fillRect(x, y, 1, 1);
        }
    }
}

function fill(ctx, colour) {
    ctx.fillStyle = shade(colour, 1);
    ctx.fillRect(0, 0, TILE, TILE);
}

// Mortar grid used by bricks, stone bricks and sandstone.
function courses(ctx, base, mortar, rows, cols, rnd, variance = 0.1, offsetAlternate = true) {
    fill(ctx, mortar);
    const rowH = TILE / rows;
    const colW = TILE / cols;
    for (let r = 0; r < rows; r++) {
        const offset = offsetAlternate && r % 2 === 1 ? colW / 2 : 0;
        for (let c = -1; c <= cols; c++) {
            const x = Math.round(c * colW + offset);
            const y = Math.round(r * rowH);
            const tone = 1 + (rnd() - 0.5) * 2 * variance;
            ctx.fillStyle = shade(base, tone);
            ctx.fillRect(x + 1, y + 1, Math.round(colW) - 2, Math.round(rowH) - 2);
            // a little grain on each brick
            for (let i = 0; i < 6; i++) {
                ctx.fillStyle = shade(base, tone * (1 + (rnd() - 0.5) * 0.2));
                ctx.fillRect(x + 1 + Math.floor(rnd() * (colW - 2)), y + 1 + Math.floor(rnd() * (rowH - 2)), 1, 1);
            }
        }
    }
}

// Wood grain: vertical streaks with occasional knots.
function grain(ctx, base, rnd, dark = 0.78, planks = 0) {
    fill(ctx, base);
    for (let x = 0; x < TILE; x++) {
        const streak = 1 + Math.sin(x * 1.7 + rnd() * 0.4) * 0.07 + (rnd() - 0.5) * 0.08;
        ctx.fillStyle = shade(base, streak);
        ctx.fillRect(x, 0, 1, TILE);
        if (rnd() < 0.18) {
            ctx.fillStyle = shade(base, dark);
            const y = Math.floor(rnd() * TILE);
            ctx.fillRect(x, y, 1, 3 + Math.floor(rnd() * 6));
        }
    }
    if (planks > 0) {
        const h = TILE / planks;
        for (let p = 0; p < planks; p++) {
            const y = Math.round(p * h);
            ctx.fillStyle = shade(base, 0.55);
            ctx.fillRect(0, y, TILE, 1);
            ctx.fillStyle = shade(base, 1.15);
            ctx.fillRect(0, y + 1, TILE, 1);
            // nail heads
            ctx.fillStyle = shade(base, 0.5);
            const nx = (p % 2 === 0 ? 4 : TILE / 2 + 4);
            ctx.fillRect(nx, y + Math.round(h / 2), 1, 1);
            ctx.fillRect(nx + TILE / 2 - 1, y + Math.round(h / 2), 1, 1);
        }
    }
}

const painters = {
    grassTop(ctx, rnd) {
        fill(ctx, [86, 158, 58]);
        speckle(ctx, [86, 158, 58], rnd, 0.14);
        for (let i = 0; i < 40; i++) {
            ctx.fillStyle = shade([120, 190, 70], 1 + (rnd() - 0.5) * 0.3);
            ctx.fillRect(Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), 1, 2);
        }
    },
    grassSide(ctx, rnd) {
        painters.dirt(ctx, rnd);
        for (let x = 0; x < TILE; x++) {
            const depth = 4 + Math.floor(rnd() * 4);
            for (let y = 0; y < depth; y++) {
                ctx.fillStyle = shade([86, 158, 58], 1 + (rnd() - 0.5) * 0.25 - y * 0.03);
                ctx.fillRect(x, y, 1, 1);
            }
        }
    },
    dirt(ctx, rnd) {
        fill(ctx, [121, 85, 58]);
        speckle(ctx, [121, 85, 58], rnd, 0.16);
        for (let i = 0; i < 18; i++) {
            ctx.fillStyle = shade([90, 60, 40], 1 + (rnd() - 0.5) * 0.3);
            ctx.fillRect(Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), 2, 1);
        }
    },
    stone(ctx, rnd) {
        fill(ctx, [128, 128, 132]);
        speckle(ctx, [128, 128, 132], rnd, 0.1);
        for (let i = 0; i < 14; i++) {
            const x = Math.floor(rnd() * TILE), y = Math.floor(rnd() * TILE);
            ctx.fillStyle = shade([128, 128, 132], 0.8);
            ctx.fillRect(x, y, 2 + Math.floor(rnd() * 4), 1);
            ctx.fillStyle = shade([128, 128, 132], 1.15);
            ctx.fillRect(x, y + 1, 2 + Math.floor(rnd() * 3), 1);
        }
    },
    cobble(ctx, rnd) {
        fill(ctx, [84, 84, 88]);
        const stones = [];
        for (let i = 0; i < 26; i++) {
            const r = 3 + rnd() * 3;
            stones.push({ x: rnd() * TILE, y: rnd() * TILE, r, tone: 1 + (rnd() - 0.5) * 0.3 });
        }
        for (const s of stones) {
            ctx.fillStyle = shade([136, 136, 140], s.tone);
            ctx.beginPath();
            ctx.ellipse(s.x, s.y, s.r, s.r * 0.8, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = shade([136, 136, 140], s.tone * 1.18);
            ctx.beginPath();
            ctx.ellipse(s.x - s.r * 0.25, s.y - s.r * 0.3, s.r * 0.4, s.r * 0.3, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    },
    stoneBricks(ctx, rnd) {
        courses(ctx, [142, 142, 146], [84, 84, 90], 4, 2, rnd, 0.1);
    },
    mossyStone(ctx, rnd) {
        painters.cobble(ctx, rnd);
        for (let i = 0; i < 90; i++) {
            ctx.fillStyle = shade([92, 140, 60], 1 + (rnd() - 0.5) * 0.4);
            ctx.fillRect(Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), 1 + Math.floor(rnd() * 2), 1);
        }
    },
    sand(ctx, rnd) {
        fill(ctx, [226, 208, 150]);
        speckle(ctx, [226, 208, 150], rnd, 0.08);
        for (let i = 0; i < 30; i++) {
            ctx.fillStyle = shade([200, 180, 120], 1);
            ctx.fillRect(Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), 1, 1);
        }
    },
    sandstone(ctx, rnd) {
        courses(ctx, [222, 200, 140], [180, 158, 104], 2, 2, rnd, 0.06);
    },
    gravel(ctx, rnd) {
        fill(ctx, [120, 116, 110]);
        for (let i = 0; i < 160; i++) {
            ctx.fillStyle = shade([150, 146, 140], 1 + (rnd() - 0.5) * 0.7);
            ctx.fillRect(Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), 1 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 2));
        }
    },
    snow(ctx, rnd) {
        fill(ctx, [240, 245, 250]);
        speckle(ctx, [240, 245, 250], rnd, 0.04);
        for (let i = 0; i < 20; i++) {
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), 1, 1);
        }
    },
    snowSide(ctx, rnd) {
        painters.dirt(ctx, rnd);
        for (let x = 0; x < TILE; x++) {
            const depth = 5 + Math.floor(rnd() * 4);
            for (let y = 0; y < depth; y++) {
                ctx.fillStyle = shade([240, 245, 250], 1 - y * 0.02);
                ctx.fillRect(x, y, 1, 1);
            }
        }
    },
    logSide(ctx, rnd) {
        grain(ctx, [104, 78, 46], rnd, 0.7);
    },
    logTop(ctx, rnd) {
        fill(ctx, [104, 78, 46]);
        ctx.fillStyle = shade([186, 150, 100], 1);
        ctx.fillRect(3, 3, TILE - 6, TILE - 6);
        const cx = TILE / 2, cy = TILE / 2;
        for (let r = TILE / 2 - 4; r > 1; r -= 2.2) {
            ctx.strokeStyle = shade([150, 115, 70], 1 + (rnd() - 0.5) * 0.3);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(cx, cy, r, r * (0.9 + rnd() * 0.1), 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    },
    leaves(ctx, rnd) {
        ctx.clearRect(0, 0, TILE, TILE);
        for (let y = 0; y < TILE; y++) {
            for (let x = 0; x < TILE; x++) {
                if (rnd() < 0.07) continue; // small gaps let light through
                ctx.fillStyle = shade([52, 120, 40], 1 + (rnd() - 0.5) * 0.5);
                ctx.fillRect(x, y, 1, 1);
            }
        }
    },
    planks(ctx, rnd) {
        grain(ctx, [178, 138, 86], rnd, 0.75, 4);
    },
    brick(ctx, rnd) {
        courses(ctx, [160, 70, 54], [190, 180, 170], 4, 2, rnd, 0.12);
    },
    roofTile(ctx, rnd) {
        fill(ctx, [70, 52, 60]);
        const rows = 4, cols = 4;
        const h = TILE / rows, w = TILE / cols;
        for (let r = 0; r < rows; r++) {
            const offset = r % 2 ? w / 2 : 0;
            for (let c = -1; c <= cols; c++) {
                const x = c * w + offset, y = r * h;
                const tone = 1 + (rnd() - 0.5) * 0.25;
                ctx.fillStyle = shade([122, 60, 70], tone);
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x + w - 1, y);
                ctx.lineTo(x + w - 1, y + h - 2);
                ctx.arc(x + w / 2 - 0.5, y + h - 2, w / 2 - 0.5, 0, Math.PI);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = shade([122, 60, 70], tone * 1.2);
                ctx.fillRect(x + 1, y + 1, w - 3, 1);
            }
        }
    },
    glass(ctx, rnd) {
        ctx.clearRect(0, 0, TILE, TILE);
        ctx.fillStyle = 'rgba(200,230,255,0.28)';
        ctx.fillRect(0, 0, TILE, TILE);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(0, 0, TILE, 1);
        ctx.fillRect(0, TILE - 1, TILE, 1);
        ctx.fillRect(0, 0, 1, TILE);
        ctx.fillRect(TILE - 1, 0, 1, TILE);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (let i = 0; i < 10; i++) {
            ctx.fillRect(4 + i, 12 - i, 1, 1);
            ctx.fillRect(8 + i, 20 - i, 1, 1);
        }
        void rnd;
    },
    lantern(ctx, rnd) {
        fill(ctx, [60, 48, 40]);
        ctx.fillStyle = shade([255, 206, 110], 1);
        ctx.fillRect(4, 4, TILE - 8, TILE - 8);
        for (let i = 0; i < 60; i++) {
            ctx.fillStyle = shade([255, 230, 160], 1 + (rnd() - 0.5) * 0.2);
            ctx.fillRect(4 + Math.floor(rnd() * (TILE - 8)), 4 + Math.floor(rnd() * (TILE - 8)), 1, 1);
        }
        ctx.fillStyle = shade([60, 48, 40], 1);
        ctx.fillRect(TILE / 2 - 1, 4, 2, TILE - 8);
        ctx.fillRect(4, TILE / 2 - 1, TILE - 8, 2);
    },
    torch(ctx, rnd) {
        ctx.clearRect(0, 0, TILE, TILE);
        // stick
        ctx.fillStyle = shade([120, 86, 48], 1);
        ctx.fillRect(13, 12, 6, 20);
        ctx.fillStyle = shade([120, 86, 48], 0.75);
        ctx.fillRect(17, 12, 2, 20);
        // flame
        ctx.fillStyle = 'rgb(255,120,30)';
        ctx.fillRect(12, 6, 8, 7);
        ctx.fillStyle = 'rgb(255,200,60)';
        ctx.fillRect(13, 4, 6, 7);
        ctx.fillStyle = 'rgb(255,250,200)';
        ctx.fillRect(14, 6, 4, 4);
        for (let i = 0; i < 6; i++) {
            ctx.fillStyle = `rgba(255,${160 + Math.floor(rnd() * 80)},40,0.9)`;
            ctx.fillRect(11 + Math.floor(rnd() * 10), 2 + Math.floor(rnd() * 4), 1, 1);
        }
    },
    torchTop(ctx, rnd) {
        ctx.clearRect(0, 0, TILE, TILE);
        ctx.fillStyle = 'rgb(255,200,60)';
        ctx.fillRect(13, 13, 6, 6);
        ctx.fillStyle = 'rgb(255,250,200)';
        ctx.fillRect(14, 14, 4, 4);
        void rnd;
    },
    ironOre(ctx, rnd) {
        painters.stone(ctx, rnd);
        for (let i = 0; i < 9; i++) {
            const x = 2 + Math.floor(rnd() * (TILE - 6)), y = 2 + Math.floor(rnd() * (TILE - 6));
            ctx.fillStyle = shade([196, 140, 96], 1 + (rnd() - 0.5) * 0.3);
            ctx.fillRect(x, y, 3, 2);
            ctx.fillRect(x + 1, y - 1, 1, 4);
            ctx.fillStyle = shade([232, 190, 150], 1);
            ctx.fillRect(x + 1, y, 1, 1);
        }
    },
    berryBush(ctx, rnd) {
        ctx.clearRect(0, 0, TILE, TILE);
        for (let y = 0; y < TILE; y++) {
            for (let x = 0; x < TILE; x++) {
                const dx = x - TILE / 2, dy = y - TILE / 2;
                if (dx * dx + dy * dy > 210 || rnd() < 0.12) continue;
                ctx.fillStyle = shade([44, 104, 40], 1 + (rnd() - 0.5) * 0.5);
                ctx.fillRect(x, y, 1, 1);
            }
        }
        for (let i = 0; i < 9; i++) {
            const x = 4 + Math.floor(rnd() * (TILE - 8)), y = 4 + Math.floor(rnd() * (TILE - 8));
            ctx.fillStyle = shade([190, 40, 70], 1 + (rnd() - 0.5) * 0.3);
            ctx.fillRect(x, y, 2, 2);
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillRect(x, y, 1, 1);
        }
    },
    water(ctx, rnd) {
        ctx.clearRect(0, 0, TILE, TILE);
        ctx.fillStyle = 'rgba(40,110,200,0.62)';
        ctx.fillRect(0, 0, TILE, TILE);
        for (let i = 0; i < 24; i++) {
            ctx.fillStyle = `rgba(150,210,255,${0.25 + rnd() * 0.3})`;
            ctx.fillRect(Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), 2 + Math.floor(rnd() * 5), 1);
        }
    }
};

const TILE_NAMES = Object.keys(painters);
export const TILE_INDEX = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i]));

// Block table. `faces` lists the tile for [top, bottom, side].
// `solid` controls collision, `transparent` controls render pass and face culling, `glow` renders unlit.
export const BLOCKS = [
    { id: 0, name: 'Air', faces: null, solid: false, transparent: true },
    { id: 1, name: 'Grass', faces: ['grassTop', 'dirt', 'grassSide'], sound: 'soft', tool: 'shovel', hardness: 1.0 },
    { id: 2, name: 'Dirt', faces: ['dirt', 'dirt', 'dirt'], sound: 'soft', tool: 'shovel', hardness: 0.9 },
    { id: 3, name: 'Stone', faces: ['stone', 'stone', 'stone'], sound: 'stone', tool: 'pickaxe', hardness: 3.0, tier: 1 },
    { id: 4, name: 'Cobblestone', faces: ['cobble', 'cobble', 'cobble'], sound: 'stone', tool: 'pickaxe', hardness: 3.4, tier: 1 },
    { id: 5, name: 'Stone bricks', faces: ['stoneBricks', 'stoneBricks', 'stoneBricks'], sound: 'stone', tool: 'pickaxe', hardness: 3.4, tier: 1 },
    { id: 6, name: 'Mossy stone', faces: ['mossyStone', 'mossyStone', 'mossyStone'], sound: 'stone', tool: 'pickaxe', hardness: 3.4, tier: 1 },
    { id: 7, name: 'Sand', faces: ['sand', 'sand', 'sand'], sound: 'sand', tool: 'shovel', hardness: 0.9 },
    { id: 8, name: 'Sandstone', faces: ['sandstone', 'sandstone', 'sandstone'], sound: 'stone', tool: 'pickaxe', hardness: 2.2, tier: 1 },
    { id: 9, name: 'Gravel', faces: ['gravel', 'gravel', 'gravel'], sound: 'sand', tool: 'shovel', hardness: 1.1 },
    { id: 10, name: 'Snow', faces: ['snow', 'dirt', 'snowSide'], sound: 'soft', tool: 'shovel', hardness: 0.6 },
    { id: 11, name: 'Oak log', faces: ['logTop', 'logTop', 'logSide'], sound: 'wood', tool: 'axe', hardness: 2.6 },
    { id: 12, name: 'Leaves', faces: ['leaves', 'leaves', 'leaves'], cutout: true, sound: 'leaves', hardness: 0.45 },
    { id: 13, name: 'Planks', faces: ['planks', 'planks', 'planks'], sound: 'wood', tool: 'axe', hardness: 2.2 },
    { id: 14, name: 'Brick', faces: ['brick', 'brick', 'brick'], sound: 'stone', tool: 'pickaxe', hardness: 3.4, tier: 1 },
    { id: 15, name: 'Roof tiles', faces: ['roofTile', 'roofTile', 'roofTile'], sound: 'stone', tool: 'pickaxe', hardness: 2.8, tier: 1 },
    { id: 16, name: 'Glass', faces: ['glass', 'glass', 'glass'], transparent: true, sound: 'glass', hardness: 0.5 },
    { id: 17, name: 'Lantern', faces: ['lantern', 'lantern', 'lantern'], glow: true, sound: 'glass', hardness: 0.6 },
    { id: 18, name: 'Water', faces: ['water', 'water', 'water'], transparent: true, solid: false, liquid: true, sound: 'water' },
    { id: 19, name: 'Torch', faces: ['torchTop', 'torchTop', 'torch'], glow: true, cutout: true, solid: false, sound: 'wood', hardness: 0.15 },
    { id: 20, name: 'Iron ore', faces: ['ironOre', 'ironOre', 'ironOre'], sound: 'stone', tool: 'pickaxe', hardness: 5.0, tier: 2 },
    { id: 21, name: 'Berry bush', faces: ['berryBush', 'berryBush', 'berryBush'], cutout: true, solid: false, sound: 'leaves', hardness: 0.35 }
];
for (const b of BLOCKS) {
    if (b.solid === undefined) b.solid = true;
    if (b.transparent === undefined) b.transparent = false;
    if (b.tool === undefined) b.tool = null;
    if (b.tier === undefined) b.tier = 0;          // minimum tool tier needed to collect the block in Survival
    if (b.faces) b.tiles = b.faces.map(f => TILE_INDEX[f]);
}

export const BLOCK = Object.fromEntries(BLOCKS.map(b => [b.name.replace(/\s+/g, '_').toUpperCase(), b.id]));
export const PLACEABLE = BLOCKS.filter(b => b.id !== 0).map(b => b.id);

export const ATLAS_ROWS = Math.ceil(TILE_NAMES.length / ATLAS_COLUMNS);
export { ATLAS_COLUMNS };

// Paint every tile into one atlas canvas. Returns the canvas and per-tile canvases for the HUD.
export function buildAtlas() {
    const atlas = document.createElement('canvas');
    atlas.width = ATLAS_COLUMNS * TILE;
    atlas.height = ATLAS_ROWS * TILE;
    const actx = atlas.getContext('2d');
    const tiles = [];
    TILE_NAMES.forEach((name, i) => {
        const tile = document.createElement('canvas');
        tile.width = TILE;
        tile.height = TILE;
        const ctx = tile.getContext('2d');
        painters[name](ctx, makeRandom(1000 + i * 7919));
        actx.drawImage(tile, (i % ATLAS_COLUMNS) * TILE, Math.floor(i / ATLAS_COLUMNS) * TILE);
        tiles.push(tile);
    });
    return { atlas, tiles };
}

// UV rectangle for a tile index: [u0, v0, u1, v1] with v flipped for WebGL.
export function tileUV(index) {
    const col = index % ATLAS_COLUMNS;
    const row = Math.floor(index / ATLAS_COLUMNS);
    const u0 = col / ATLAS_COLUMNS;
    const u1 = (col + 1) / ATLAS_COLUMNS;
    const v1 = 1 - row / ATLAS_ROWS;
    const v0 = 1 - (row + 1) / ATLAS_ROWS;
    const pad = 0.002;
    return [u0 + pad, v0 + pad, u1 - pad, v1 - pad];
}

// Draw a small isometric cube icon of a block for the hotbar.
export function drawBlockIcon(canvas, block, tiles) {
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    if (!block.tiles) return;
    const [topT, , sideT] = block.tiles;
    const top = tiles[topT], side = tiles[sideT];
    const s = size * 0.46;
    const cx = size / 2, cy = size / 2;
    ctx.imageSmoothingEnabled = false;
    // top face: a diamond whose top point is at (cx, cy - s) and whose front point is at (cx, cy),
    // so it sits on the two side faces rather than sinking between them
    ctx.save();
    ctx.setTransform(s / TILE, (s / TILE) * 0.5, -(s / TILE), (s / TILE) * 0.5, cx, cy - s);
    ctx.drawImage(top, 0, 0);
    ctx.restore();
    // left face
    ctx.save();
    ctx.setTransform(s / TILE, (s / TILE) * 0.5, 0, s / TILE, cx - s, cy - s * 0.5);
    ctx.drawImage(side, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.restore();
    // right face
    ctx.save();
    ctx.setTransform(s / TILE, -(s / TILE) * 0.5, 0, s / TILE, cx, cy);
    ctx.drawImage(side, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.restore();
}
