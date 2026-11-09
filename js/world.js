// World storage, terrain generation and chunk meshing.
import { BLOCKS, BLOCK, tileUV } from './blocks.js';

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 64;
export const SEA_LEVEL = 22;

// --- Seeded noise -------------------------------------------------------------

function hash2(x, z, seed) {
    let h = (x | 0) * 374761393 + (z | 0) * 668265263 + (seed | 0) * 1274126177;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function smooth(t) { return t * t * (3 - 2 * t); }

// Two-dimensional value noise in the range 0..1.
function valueNoise(x, z, seed) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
    const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
    const u = smooth(xf), v = smooth(zf);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, z, seed, octaves, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
        sum += valueNoise(x * freq, z * freq, seed + i * 101) * amp;
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
    }
    return sum / norm;
}

export function seedFromString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

// --- Terrain -------------------------------------------------------------------

export class Terrain {
    constructor(seed) {
        this.seed = seed >>> 0;
        this.heightCache = new Map();
    }

    // Surface height for a column. Flat plains, rolling hills and the odd steep peak.
    height(x, z) {
        const key = x * 100003 + z;
        const cached = this.heightCache.get(key);
        if (cached !== undefined) return cached;
        const s = this.seed;
        const continent = fbm(x / 180, z / 180, s + 11, 3);        // broad land/sea shape
        const hills = fbm(x / 48, z / 48, s + 23, 4);               // rolling hills
        const ridge = Math.pow(fbm(x / 90, z / 90, s + 37, 3), 3);  // occasional peaks
        const roughness = smooth(Math.max(0, (continent - 0.35) / 0.65));
        let h = 14 + continent * 16 + (hills - 0.5) * 18 * roughness + ridge * 34 * roughness;
        h = Math.round(h);
        h = Math.max(4, Math.min(WORLD_HEIGHT - 6, h));
        this.heightCache.set(key, h);
        return h;
    }

    // Trees sit on grass away from water; the height is chosen from the same hash.
    treeAt(x, z) {
        const r = hash2(x, z, this.seed + 77);
        const h = this.height(x, z);
        if (h <= SEA_LEVEL + 1 || h >= 44) return 0;
        const forest = fbm(x / 70, z / 70, this.seed + 91, 2);
        const density = forest > 0.58 ? 0.045 : 0.006;
        if (r >= density) return 0;
        // keep trees a little apart
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                if ((dx || dz) && hash2(x + dx, z + dz, this.seed + 77) < r) return 0;
            }
        }
        return 4 + Math.floor(hash2(x, z, this.seed + 78) * 3); // trunk height 4..6
    }

    blockAt(x, y, z, h) {
        if (y > h) return y <= SEA_LEVEL ? BLOCK.WATER : BLOCK.AIR;
        if (y === h) {
            if (h >= 46) return BLOCK.SNOW;
            if (h >= 38) return BLOCK.STONE;
            if (h <= SEA_LEVEL + 1) return BLOCK.SAND;
            return BLOCK.GRASS;
        }
        if (y > h - 4) {
            if (h <= SEA_LEVEL + 1) return y > h - 2 ? BLOCK.SAND : BLOCK.GRAVEL;
            if (h >= 38) return BLOCK.STONE;
            return BLOCK.DIRT;
        }
        if (y < 40 && this.oreAt(x, y, z)) return BLOCK.IRON_ORE;
        return BLOCK.STONE;
    }

    // Iron ore sits in small clusters inside the stone; a hashed cell test keeps it deterministic.
    oreAt(x, y, z) {
        const cell = hash2(Math.floor(x / 3) * 7919 + Math.floor(y / 3), Math.floor(z / 3), this.seed + 503);
        if (cell > 0.09) return false;
        return hash2(x * 31 + y, z, this.seed + 509) < 0.55;
    }

    // Berry bushes grow on open grass away from trees.
    bushAt(x, z) {
        if (hash2(x, z, this.seed + 601) >= 0.016) return false;
        const h = this.height(x, z);
        if (h <= SEA_LEVEL + 1 || h >= 38) return false;
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                if (this.treeAt(x + dx, z + dz)) return false;
            }
        }
        return true;
    }

    // Fill a chunk's block array with generated terrain and trees.
    generateChunk(cx, cz, data) {
        const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            for (let lz = 0; lz < CHUNK_SIZE; lz++) {
                const h = this.height(ox + lx, oz + lz);
                const top = Math.max(h, SEA_LEVEL);
                for (let y = 0; y <= top; y++) {
                    data[blockIndex(lx, y, lz)] = this.blockAt(ox + lx, y, oz + lz, h);
                }
                if (h + 1 < WORLD_HEIGHT && this.bushAt(ox + lx, oz + lz)) data[blockIndex(lx, h + 1, lz)] = BLOCK.BERRY_BUSH;
            }
        }
        // trees may spill over from neighbouring columns, so scan a margin around the chunk
        for (let x = ox - 3; x < ox + CHUNK_SIZE + 3; x++) {
            for (let z = oz - 3; z < oz + CHUNK_SIZE + 3; z++) {
                const trunk = this.treeAt(x, z);
                if (!trunk) continue;
                const base = this.height(x, z) + 1;
                const set = (wx, wy, wz, id, keepSolid) => {
                    const lx = wx - ox, lz = wz - oz;
                    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || wy < 0 || wy >= WORLD_HEIGHT) return;
                    const i = blockIndex(lx, wy, lz);
                    if (keepSolid && data[i] !== BLOCK.AIR) return;
                    data[i] = id;
                };
                for (let i = 0; i < trunk; i++) set(x, base + i, z, BLOCK.OAK_LOG, false);
                const canopyBase = base + trunk - 2;
                for (let dy = 0; dy <= 3; dy++) {
                    const radius = dy < 2 ? 2 : 1;
                    for (let dx = -radius; dx <= radius; dx++) {
                        for (let dz = -radius; dz <= radius; dz++) {
                            if (Math.abs(dx) === radius && Math.abs(dz) === radius && (dy >= 2 || hash2(x + dx, z + dz + dy * 31, this.seed) < 0.5)) continue;
                            set(x + dx, canopyBase + dy, z + dz, BLOCK.LEAVES, true);
                        }
                    }
                }
                set(x, canopyBase + 4, z, BLOCK.LEAVES, true);
            }
        }
    }
}

export function blockIndex(lx, y, lz) {
    return (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
}

export function chunkKey(cx, cz) { return `${cx},${cz}`; }

// --- World ---------------------------------------------------------------------

export class World {
    constructor(seedString) {
        this.seedString = seedString;
        this.terrain = new Terrain(seedFromString(seedString));
        this.chunks = new Map();          // key -> { cx, cz, data, dirty }
        this.edits = new Map();           // "x,y,z" -> id, every player change relative to the generated world
        this.editsByChunk = new Map();    // chunk key -> Map(index -> id)
        this.listeners = [];
    }

    onChunkChanged(fn) { this.listeners.push(fn); }

    getChunk(cx, cz, create = true) {
        const key = chunkKey(cx, cz);
        let chunk = this.chunks.get(key);
        if (!chunk && create) {
            const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
            this.terrain.generateChunk(cx, cz, data);
            const edits = this.editsByChunk.get(key);
            if (edits) for (const [i, id] of edits) data[i] = id;
            chunk = { cx, cz, data, key };
            this.chunks.set(key, chunk);
        }
        return chunk;
    }

    getBlock(x, y, z) {
        if (y < 0 || y >= WORLD_HEIGHT) return BLOCK.AIR;
        const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
        const chunk = this.getChunk(cx, cz);
        return chunk.data[blockIndex(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)];
    }

    // Looks at a block without generating a chunk; used by the mesher at chunk borders.
    peekBlock(x, y, z) {
        if (y < 0) return BLOCK.STONE;
        if (y >= WORLD_HEIGHT) return BLOCK.AIR;
        const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
        const chunk = this.chunks.get(chunkKey(cx, cz)) || this.getChunk(cx, cz);
        return chunk.data[blockIndex(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)];
    }

    setBlock(x, y, z, id, record = true) {
        if (y < 0 || y >= WORLD_HEIGHT) return false;
        const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
        const chunk = this.getChunk(cx, cz);
        const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
        const i = blockIndex(lx, y, lz);
        if (chunk.data[i] === id) return false;
        chunk.data[i] = id;
        if (record) {
            this.edits.set(`${x},${y},${z}`, id);
            let bucket = this.editsByChunk.get(chunk.key);
            if (!bucket) { bucket = new Map(); this.editsByChunk.set(chunk.key, bucket); }
            bucket.set(i, id);
        }
        this.notify(cx, cz);
        if (lx === 0) this.notify(cx - 1, cz);
        if (lx === CHUNK_SIZE - 1) this.notify(cx + 1, cz);
        if (lz === 0) this.notify(cx, cz - 1);
        if (lz === CHUNK_SIZE - 1) this.notify(cx, cz + 1);
        return true;
    }

    notify(cx, cz) { for (const fn of this.listeners) fn(cx, cz); }

    // Drops generated chunk data far from the player; edits live in editsByChunk, so a chunk
    // regenerates identically when it is needed again.
    unloadDistant(pcx, pcz, radius) {
        for (const [key, chunk] of this.chunks) {
            if (Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz)) > radius) this.chunks.delete(key);
        }
    }

    isSolid(x, y, z) {
        return BLOCKS[this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))].solid;
    }

    isLiquid(x, y, z) {
        return !!BLOCKS[this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))].liquid;
    }

    surfaceHeight(x, z) {
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
            if (BLOCKS[this.getBlock(x, y, z)].solid) return y;
        }
        return 0;
    }

    // Serialise the world as the seed plus the list of player edits.
    serialiseEdits() {
        const out = [];
        for (const [key, id] of this.edits) {
            const [x, y, z] = key.split(',').map(Number);
            out.push([x, y, z, id]);
        }
        return out;
    }

    loadEdits(list) {
        this.edits.clear();
        this.editsByChunk.clear();
        this.chunks.clear();
        for (const [x, y, z, id] of list) {
            if (y < 0 || y >= WORLD_HEIGHT || !BLOCKS[id]) continue;
            const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
            const key = chunkKey(cx, cz);
            this.edits.set(`${x},${y},${z}`, id);
            let bucket = this.editsByChunk.get(key);
            if (!bucket) { bucket = new Map(); this.editsByChunk.set(key, bucket); }
            bucket.set(blockIndex(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE), id);
        }
    }
}

// --- Meshing -------------------------------------------------------------------

// Face definitions: direction, the four corners (counter-clockwise seen from outside)
// and the three neighbour offsets used by the ambient occlusion test for each corner.
const FACES = [
    { dir: [1, 0, 0], tile: 2, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.8 },
    { dir: [-1, 0, 0], tile: 2, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.8 },
    { dir: [0, 1, 0], tile: 0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
    { dir: [0, -1, 0], tile: 1, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.55 },
    { dir: [0, 0, 1], tile: 2, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.7 },
    { dir: [0, 0, -1], tile: 2, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.7 }
];
const UV_CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

function occludes(id) {
    const b = BLOCKS[id];
    return b.solid && !b.transparent && !b.cutout;
}

// Decide whether a face between `self` and `other` should be drawn.
function faceVisible(self, other) {
    if (other === BLOCK.AIR) return true;
    const o = BLOCKS[other];
    if (self === other) return false;                     // same material: hidden interior face
    if (!o.transparent && !o.cutout) return false;        // fully covered by an opaque block
    return true;
}

// Vertex ambient occlusion in the style described by Mikola Lysenko (0fps).
function vertexAO(side1, side2, corner) {
    if (side1 && side2) return 0;
    return 3 - (side1 + side2 + corner);
}

// Build geometry for a box region. `getBlock(x, y, z)` returns block ids in world space.
// Returns three buffers (opaque, transparent, glow) ready for BufferGeometry.
export function meshRegion(getBlock, x0, y0, z0, sx, sy, sz, options = {}) {
    const ao = options.ao !== false;
    const passes = { opaque: newBuffers(), transparent: newBuffers(), glow: newBuffers() };
    for (let y = y0; y < y0 + sy; y++) {
        for (let z = z0; z < z0 + sz; z++) {
            for (let x = x0; x < x0 + sx; x++) {
                const id = getBlock(x, y, z);
                if (id === BLOCK.AIR) continue;
                const block = BLOCKS[id];
                const pass = block.glow ? passes.glow : (block.transparent ? passes.transparent : passes.opaque);
                for (const face of FACES) {
                    const nx = x + face.dir[0], ny = y + face.dir[1], nz = z + face.dir[2];
                    const other = getBlock(nx, ny, nz);
                    if (!faceVisible(id, other)) continue;
                    // water sits a little lower than a full block when open to the air
                    const lowerTop = block.liquid && getBlock(x, y + 1, z) !== id;
                    const [u0, v0, u1, v1] = tileUV(block.tiles[face.tile]);
                    const base = pass.positions.length / 3;
                    for (let c = 0; c < 4; c++) {
                        const corner = face.corners[c];
                        let px = x + corner[0], py = y + corner[1], pz = z + corner[2];
                        if (lowerTop && corner[1] === 1) py -= 0.15;
                        pass.positions.push(px, py, pz);
                        pass.normals.push(face.dir[0], face.dir[1], face.dir[2]);
                        const uv = UV_CORNERS[c];
                        pass.uvs.push(uv[0] ? u1 : u0, uv[1] ? v1 : v0);
                        let light = face.shade;
                        if (ao && !block.glow) {
                            // the two edge neighbours and the diagonal neighbour of this corner on the face plane
                            const d = face.dir;
                            const cx = corner[0] * 2 - 1, cy = corner[1] * 2 - 1, cz = corner[2] * 2 - 1;
                            let s1, s2, cn;
                            if (d[0] !== 0) {
                                s1 = occludes(getBlock(nx, ny + cy, nz));
                                s2 = occludes(getBlock(nx, ny, nz + cz));
                                cn = occludes(getBlock(nx, ny + cy, nz + cz));
                            } else if (d[1] !== 0) {
                                s1 = occludes(getBlock(nx + cx, ny, nz));
                                s2 = occludes(getBlock(nx, ny, nz + cz));
                                cn = occludes(getBlock(nx + cx, ny, nz + cz));
                            } else {
                                s1 = occludes(getBlock(nx + cx, ny, nz));
                                s2 = occludes(getBlock(nx, ny + cy, nz));
                                cn = occludes(getBlock(nx + cx, ny + cy, nz));
                            }
                            const aoLevel = vertexAO(s1 ? 1 : 0, s2 ? 1 : 0, cn ? 1 : 0);
                            light *= 0.55 + 0.15 * aoLevel;
                        }
                        pass.colours.push(light, light, light);
                    }
                    pass.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
                }
            }
        }
    }
    return passes;
}

function newBuffers() {
    return { positions: [], normals: [], uvs: [], colours: [], indices: [] };
}

// Mesh a whole chunk, reading neighbours through the world so border faces are culled correctly.
export function meshChunk(world, chunk) {
    const ox = chunk.cx * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;
    const data = chunk.data;
    const getBlock = (x, y, z) => {
        const lx = x - ox, lz = z - oz;
        if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
            if (y < 0) return BLOCK.STONE;
            if (y >= WORLD_HEIGHT) return BLOCK.AIR;
            return data[blockIndex(lx, y, lz)];
        }
        return world.peekBlock(x, y, z);
    };
    // skip empty air above the tallest column to save time
    let maxY = 0;
    for (let y = WORLD_HEIGHT - 1; y >= 0 && maxY === 0; y--) {
        for (let i = y * CHUNK_SIZE * CHUNK_SIZE, end = i + CHUNK_SIZE * CHUNK_SIZE; i < end; i++) {
            if (data[i] !== 0) { maxY = y; break; }
        }
    }
    return meshRegion(getBlock, ox, 0, oz, CHUNK_SIZE, Math.min(WORLD_HEIGHT, maxY + 2), CHUNK_SIZE);
}

// Voxel ray march (Amanatides & Woo). Returns { x, y, z, nx, ny, nz, id } or null.
export function raycast(world, origin, direction, maxDistance, hitLiquids = false) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const stepX = Math.sign(direction.x), stepY = Math.sign(direction.y), stepZ = Math.sign(direction.z);
    const tDeltaX = stepX ? Math.abs(1 / direction.x) : Infinity;
    const tDeltaY = stepY ? Math.abs(1 / direction.y) : Infinity;
    const tDeltaZ = stepZ ? Math.abs(1 / direction.z) : Infinity;
    let tMaxX = stepX > 0 ? (x + 1 - origin.x) * tDeltaX : stepX < 0 ? (origin.x - x) * tDeltaX : Infinity;
    let tMaxY = stepY > 0 ? (y + 1 - origin.y) * tDeltaY : stepY < 0 ? (origin.y - y) * tDeltaY : Infinity;
    let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) * tDeltaZ : stepZ < 0 ? (origin.z - z) * tDeltaZ : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    while (t <= maxDistance) {
        const id = world.getBlock(x, y, z);
        if (id !== BLOCK.AIR && (hitLiquids || !BLOCKS[id].liquid)) {
            return { x, y, z, nx, ny, nz, id, distance: t };
        }
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
            x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
        } else if (tMaxY < tMaxZ) {
            y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
        } else {
            z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
        }
        if (y < 0 || y >= WORLD_HEIGHT) return null;
    }
    return null;
}
