// Eoin's Building Game: a first-person voxel sandbox.
// Rendering uses Three.js (loaded from a CDN as an ES module); everything else is in this repository.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import { BLOCKS, BLOCK, PLACEABLE, buildAtlas, drawBlockIcon } from './js/blocks.js';
import { World, meshChunk, meshRegion, raycast, CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, chunkKey } from './js/world.js';
import { BLUEPRINTS, blueprintCells, blueprintBaseOffset } from './js/blueprints.js';
import { GameAudio } from './js/audio.js';

const SAVE_KEY = 'eoins-building-game.world.v2';
const SETTINGS_KEY = 'eoins-building-game.settings';
const DAY_LENGTH = 480;           // seconds of real time per in-game day
const REACH = 6;                  // how far the player can place or break
const PLAYER = { width: 0.6, height: 1.8, eye: 1.62 };
const GRAVITY = 28;
const JUMP_SPEED = 8.6;
const HOTBAR_SLOTS = 9;

const params = new URLSearchParams(location.search);
const thumbnailMode = params.has('thumbnail');

// --- DOM -------------------------------------------------------------------------
const $ = id => document.getElementById(id);
const canvas = $('game-canvas');
const ui = {
    hud: $('hud'), clock: $('clock'), modeBadge: $('mode-badge'), muteBadge: $('mute-badge'),
    blueprintPanel: $('blueprint-panel'), blueprintList: $('blueprint-list'),
    blockName: $('block-name'), hotbar: $('hotbar'), hintBar: $('hint-bar'), toast: $('toast'),
    loading: $('loading-screen'), loadingText: $('loading-text'),
    startMenu: $('start-menu'), pauseMenu: $('pause-menu'),
    btnContinue: $('btn-continue'), saveSummary: $('save-summary'), seedInput: $('seed-input'),
    btnRandomSeed: $('btn-random-seed'), btnNew: $('btn-new'), btnImportStart: $('btn-import-start'),
    btnResume: $('btn-resume'), btnSave: $('btn-save'), btnExport: $('btn-export'), btnImport: $('btn-import'),
    btnSound: $('btn-sound'), renderDistance: $('render-distance'), btnQuit: $('btn-quit'),
    pauseSummary: $('pause-summary'), importFile: $('import-file'), underwater: $('underwater-tint')
};

// --- Game state --------------------------------------------------------------------
const settings = loadSettings();
const audio = new GameAudio();
let state = 'loading';            // loading | menu | playing | paused
let world = null;
let worldName = '';
let dirty = false;                // unsaved changes
let lastAutosave = 0;

const player = {
    pos: new THREE.Vector3(0, 40, 0),
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    onGround: false, flying: false, inWater: false, sprinting: false
};
const keys = new Set();
const time = { t: 0.3, day: 1 };
let selected = 0;                 // index into PLACEABLE
let blueprint = { active: false, index: 0, rotation: 0, ghost: null, cells: null, anchor: null };
let hitInfo = null;
let hintsHidden = false;
let menuAngle = 0;
let spawn = new THREE.Vector3();

// --- Three.js setup -----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);

const { atlas, tiles } = buildAtlas();
const atlasTexture = new THREE.CanvasTexture(atlas);
atlasTexture.magFilter = THREE.NearestFilter;
atlasTexture.minFilter = THREE.NearestFilter;
atlasTexture.generateMipmaps = false;
atlasTexture.colorSpace = THREE.SRGBColorSpace;

const materials = {
    opaque: new THREE.MeshLambertMaterial({ map: atlasTexture, vertexColors: true, alphaTest: 0.5 }),
    transparent: new THREE.MeshLambertMaterial({ map: atlasTexture, vertexColors: true, transparent: true, depthWrite: false }),
    glow: new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true }),
    ghost: new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, color: 0xbfe3ff })
};

const sun = new THREE.DirectionalLight(0xffffff, 1);
const ambient = new THREE.AmbientLight(0xffffff, 0.4);
const hemisphere = new THREE.HemisphereLight(0xbfdfff, 0x6b5a3a, 0.5);
scene.add(sun, sun.target, ambient, hemisphere);
scene.fog = new THREE.Fog(0x87ceeb, 60, 140);

// Sun, moon and stars follow the camera so they always sit on the horizon.
const sky = new THREE.Group();
const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(22, 32), new THREE.MeshBasicMaterial({ color: 0xfff1b0, fog: false }));
const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(14, 32), new THREE.MeshBasicMaterial({ color: 0xe8ecff, fog: false }));
const starGeometry = new THREE.BufferGeometry();
{
    const positions = [];
    for (let i = 0; i < 900; i++) {
        const u = Math.random() * 2 - 1, phi = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u) * 420;
        positions.push(r * Math.cos(phi), Math.abs(u) * 420 + 10, r * Math.sin(phi));
    }
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
}
const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
sky.add(sunDisc, moonDisc, stars);
scene.add(sky);

// Outline for the targeted block.
const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
    new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 })
);
outline.visible = false;
scene.add(outline);

const chunkMeshes = new Map();    // chunk key -> { group, meshes }
const dirtyChunks = new Set();
let buildQueue = [];
let lastChunkX = null, lastChunkZ = null;

// --- Settings --------------------------------------------------------------------------
function loadSettings() {
    try {
        return Object.assign({ renderDistance: 6, hintsHidden: false }, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
    } catch (err) {
        return { renderDistance: 6, hintsHidden: false };
    }
}
function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (err) { /* storage unavailable */ }
}

// --- Chunk meshing -----------------------------------------------------------------------
function geometryFrom(buffers) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colours, 3));
    geometry.setIndex(buffers.indices);
    geometry.computeBoundingSphere();
    return geometry;
}

function disposeChunkMesh(key) {
    const entry = chunkMeshes.get(key);
    if (!entry) return;
    for (const mesh of entry.meshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
    }
    chunkMeshes.delete(key);
}

function buildChunkMesh(cx, cz) {
    const key = chunkKey(cx, cz);
    disposeChunkMesh(key);
    const chunk = world.getChunk(cx, cz);
    const passes = meshChunk(world, chunk);
    const meshes = [];
    for (const pass of ['opaque', 'transparent', 'glow']) {
        if (!passes[pass].indices.length) continue;
        const mesh = new THREE.Mesh(geometryFrom(passes[pass]), materials[pass]);
        mesh.renderOrder = pass === 'transparent' ? 2 : 0;
        mesh.matrixAutoUpdate = false;
        scene.add(mesh);
        meshes.push(mesh);
    }
    chunkMeshes.set(key, { meshes, cx, cz });
    dirtyChunks.delete(key);
}

function chunkDistance(cx, cz) {
    const pcx = Math.floor(player.pos.x / CHUNK_SIZE), pcz = Math.floor(player.pos.z / CHUNK_SIZE);
    return Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
}

function refreshChunkQueue(force = false) {
    const pcx = Math.floor(player.pos.x / CHUNK_SIZE), pcz = Math.floor(player.pos.z / CHUNK_SIZE);
    if (!force && pcx === lastChunkX && pcz === lastChunkZ) return;
    lastChunkX = pcx; lastChunkZ = pcz;
    const r = settings.renderDistance;
    const wanted = [];
    for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
            if (dx * dx + dz * dz > r * r + r) continue;
            const cx = pcx + dx, cz = pcz + dz;
            if (!chunkMeshes.has(chunkKey(cx, cz))) wanted.push({ cx, cz, d: dx * dx + dz * dz });
        }
    }
    wanted.sort((a, b) => a.d - b.d);
    buildQueue = wanted;
    for (const [key, entry] of chunkMeshes) {
        if (chunkDistance(entry.cx, entry.cz) > r + 1) disposeChunkMesh(key);
    }
}

function updateChunks(budgetMs) {
    refreshChunkQueue();
    for (const key of Array.from(dirtyChunks)) {
        const [cx, cz] = key.split(',').map(Number);
        if (chunkMeshes.has(key)) buildChunkMesh(cx, cz); else dirtyChunks.delete(key);
    }
    const start = performance.now();
    while (buildQueue.length && performance.now() - start < budgetMs) {
        const next = buildQueue.shift();
        if (!chunkMeshes.has(chunkKey(next.cx, next.cz))) buildChunkMesh(next.cx, next.cz);
    }
}

function rebuildAllChunks() {
    for (const key of Array.from(chunkMeshes.keys())) disposeChunkMesh(key);
    dirtyChunks.clear();
    lastChunkX = null;
    refreshChunkQueue(true);
}

// --- World lifecycle --------------------------------------------------------------------
function createWorld(seedString) {
    world = new World(seedString);
    world.onChunkChanged((cx, cz) => dirtyChunks.add(chunkKey(cx, cz)));
    window.__game.world = world;
}

// Pick a dry, grassy spot near the origin for the player to start on.
function findSpawn() {
    for (let radius = 0; radius < 200; radius += 4) {
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
            const x = Math.round(Math.cos(angle) * radius), z = Math.round(Math.sin(angle) * radius);
            const h = world.terrain.height(x, z);
            if (h > SEA_LEVEL + 1 && h < 36 && !world.terrain.treeAt(x, z)) {
                const top = world.surfaceHeight(x, z);
                return new THREE.Vector3(x + 0.5, top + 1, z + 0.5);
            }
        }
    }
    return new THREE.Vector3(0.5, world.surfaceHeight(0, 0) + 1, 0.5);
}

function startNewWorld(seedString) {
    createWorld(seedString || randomSeed());
    worldName = world.seedString;
    time.t = 0.3; time.day = 1;
    spawn = findSpawn();
    player.pos.copy(spawn);
    player.vel.set(0, 0, 0);
    player.yaw = Math.PI * 0.25; player.pitch = -0.1; player.flying = false;
    dirty = true;
    rebuildAllChunks();
    beginPlaying();
}

function beginPlaying() {
    blueprint.active = false;
    updateBlueprintGhost();
    setState('playing');
    audio.ensure();
    audio.startWind();
    renderHotbar();
    updateModeBadge();
    lastAutosave = performance.now();
    requestPointerLock();
}

function setState(next) {
    state = next;
    ui.hud.hidden = !(state === 'playing' || state === 'paused');
    ui.startMenu.hidden = state !== 'menu';
    ui.pauseMenu.hidden = state !== 'paused';
    ui.loading.hidden = state !== 'loading';
    if (thumbnailMode) ui.hud.hidden = true;
    if (state !== 'playing' && document.pointerLockElement === canvas) document.exitPointerLock();
    keys.clear();
}

function randomSeed() {
    const words = ['oak', 'fen', 'moor', 'glen', 'burn', 'tor', 'cairn', 'dale', 'heath', 'loch', 'ridge', 'brae'];
    return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

// --- Saving and loading --------------------------------------------------------------
function snapshot() {
    return {
        game: 'eoins-building-game',
        version: 2,
        savedAt: new Date().toISOString(),
        seed: world.seedString,
        name: worldName,
        time: { t: time.t, day: time.day },
        player: { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch, flying: player.flying },
        selected,
        edits: world.serialiseEdits()
    };
}

function saveToLocal(quiet = false) {
    if (!world) return false;
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot()));
        dirty = false;
        lastAutosave = performance.now();
        if (!quiet) toast('World saved');
        return true;
    } catch (err) {
        toast('Could not save: ' + (err && err.name === 'QuotaExceededError' ? 'storage is full' : 'storage unavailable'));
        return false;
    }
}

function readLocalSave() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        return null;
    }
}

function loadSave(data) {
    if (!data || data.game !== 'eoins-building-game' || typeof data.seed !== 'string' || !Array.isArray(data.edits)) {
        throw new Error('This file is not a saved world from Eoin\'s Building Game.');
    }
    // Validate every edit before touching the current world so a bad file cannot discard it.
    const validEdit = (e) => Array.isArray(e) && e.length >= 4 && e.slice(0, 4).every(Number.isInteger);
    if (!data.edits.every(validEdit)) throw new Error('This saved world contains invalid block edits.');
    createWorld(data.seed);
    worldName = data.name || data.seed;
    world.loadEdits(data.edits);
    time.t = typeof data.time?.t === 'number' ? data.time.t : 0.3;
    time.day = data.time?.day || 1;
    spawn = findSpawn();
    if (data.player && Number.isFinite(data.player.x)) {
        player.pos.set(data.player.x, data.player.y, data.player.z);
        player.yaw = data.player.yaw || 0;
        player.pitch = data.player.pitch || 0;
        player.flying = !!data.player.flying;
    } else {
        player.pos.copy(spawn);
    }
    player.vel.set(0, 0, 0);
    selected = Math.min(PLACEABLE.length - 1, Math.max(0, data.selected | 0));
    dirty = false;
    rebuildAllChunks();
    beginPlaying();
    toast(`Loaded "${worldName}" with ${data.edits.length} changes`);
}

function exportWorld() {
    if (!world) return;
    const blob = new Blob([JSON.stringify(snapshot())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eoins-building-game-${world.seedString}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('World exported');
}

function importWorldFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            loadSave(JSON.parse(reader.result));
        } catch (err) {
            alert('Import failed: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function refreshContinueButton() {
    const save = readLocalSave();
    ui.btnContinue.hidden = !save;
    ui.saveSummary.hidden = !save;
    if (save) {
        const when = save.savedAt ? new Date(save.savedAt).toLocaleString('en-GB') : 'earlier';
        ui.saveSummary.textContent = `Seed "${save.seed}" · day ${save.time?.day || 1} · ${save.edits.length} changes · saved ${when}`;
    }
}

// --- Time of day -----------------------------------------------------------------------
const palette = {
    night: new THREE.Color(0x0a1026), dusk: new THREE.Color(0xd9814c), day: new THREE.Color(0x7fbdee),
    sunDay: new THREE.Color(0xfff2d0), sunDusk: new THREE.Color(0xffa060), moon: new THREE.Color(0x7d90c8),
    water: new THREE.Color(0x1f4f8a)
};
const skyColour = new THREE.Color();
const sunColour = new THREE.Color();

function sunElevation() { return Math.sin((time.t - 0.25) * Math.PI * 2); }

function lerpColour(out, a, b, k) { return out.copy(a).lerp(b, Math.max(0, Math.min(1, k))); }

function updateSky() {
    const e = sunElevation();
    if (e < -0.12) skyColour.copy(palette.night);
    else if (e < 0.06) lerpColour(skyColour, palette.night, palette.dusk, (e + 0.12) / 0.18);
    else if (e < 0.4) lerpColour(skyColour, palette.dusk, palette.day, (e - 0.06) / 0.34);
    else skyColour.copy(palette.day);

    const daylight = Math.max(0, Math.min(1, (e + 0.05) / 0.5));
    const underwater = world && world.isLiquid(camera.position.x, camera.position.y, camera.position.z);
    const far = settings.renderDistance * CHUNK_SIZE - 10;
    if (underwater) {
        scene.fog.color.copy(palette.water).multiplyScalar(0.4 + daylight * 0.6);
        scene.fog.near = 1; scene.fog.far = 22;
    } else {
        scene.fog.color.copy(skyColour);
        scene.fog.near = far * 0.55; scene.fog.far = far;
    }
    scene.background = scene.fog.color;
    ui.underwater.hidden = !underwater;

    const angle = (time.t - 0.25) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(angle) * 0.6, Math.sin(angle), Math.cos(angle) * 0.4).normalize();
    sun.position.copy(camera.position).addScaledVector(dir, 120);
    sun.target.position.copy(camera.position);
    if (e > 0) {
        lerpColour(sunColour, palette.sunDusk, palette.sunDay, e / 0.4);
        sun.color.copy(sunColour);
        sun.intensity = 0.25 + e * 1.1;
    } else {
        sun.position.copy(camera.position).addScaledVector(dir, -120);
        sun.color.copy(palette.moon);
        sun.intensity = 0.18;
    }
    ambient.intensity = 0.18 + daylight * 0.35;
    hemisphere.intensity = 0.15 + daylight * 0.45;
    hemisphere.color.copy(skyColour);

    sky.position.copy(camera.position);
    sunDisc.position.copy(dir).multiplyScalar(380);
    sunDisc.lookAt(camera.position);
    moonDisc.position.copy(dir).multiplyScalar(-380);
    moonDisc.lookAt(camera.position);
    sunDisc.visible = !underwater && e > -0.1;
    moonDisc.visible = !underwater && e < 0.1;
    stars.material.opacity = underwater ? 0 : Math.max(0, Math.min(1, -e * 3));
}

function formatClock() {
    const minutes = Math.round(time.t * 24 * 60) % (24 * 60);
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return `Day ${time.day} · ${hh}:${mm}`;
}

function skipTime() {
    const e = sunElevation();
    if (e > 0) { time.t = 0.78; }
    else { if (time.t > 0.5) time.day += 1; time.t = 0.27; }
    toast(e > 0 ? 'Evening draws in' : 'A new day dawns');
}

// --- Player movement ---------------------------------------------------------------
function playerBox(pos) {
    const hw = PLAYER.width / 2;
    return { minX: pos.x - hw, maxX: pos.x + hw, minY: pos.y, maxY: pos.y + PLAYER.height, minZ: pos.z - hw, maxZ: pos.z + hw };
}

function boxHitsSolid(box) {
    for (let x = Math.floor(box.minX); x <= Math.floor(box.maxX - 1e-6); x++) {
        for (let y = Math.floor(box.minY); y <= Math.floor(box.maxY - 1e-6); y++) {
            for (let z = Math.floor(box.minZ); z <= Math.floor(box.maxZ - 1e-6); z++) {
                if (y < 0) return true;
                if (y >= WORLD_HEIGHT) continue;
                if (BLOCKS[world.getBlock(x, y, z)].solid) return true;
            }
        }
    }
    return false;
}

// Move along one axis at a time, in short steps so fast falls cannot pass through blocks,
// and slide against whatever we hit.
function moveAxis(axis, amount) {
    if (amount === 0) return false;
    const steps = Math.max(1, Math.ceil(Math.abs(amount) / 0.5));
    const step = amount / steps;
    const hw = axis === 'y' ? 0 : PLAYER.width / 2;
    const size = axis === 'y' ? PLAYER.height : 0;
    for (let i = 0; i < steps; i++) {
        const next = player.pos.clone();
        next[axis] += step;
        if (!boxHitsSolid(playerBox(next))) {
            player.pos.copy(next);
            continue;
        }
        if (step > 0) {
            player.pos[axis] = Math.floor(next[axis] + hw + size) - hw - size - 1e-4;
        } else {
            player.pos[axis] = Math.ceil(next[axis] - hw) + hw + 1e-4;
        }
        player.vel[axis] = 0;
        return true;
    }
    return false;
}

function updatePlayer(dt) {
    const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    const wish = new THREE.Vector3();
    if (keys.has('KeyW')) wish.add(forward);
    if (keys.has('KeyS')) wish.sub(forward);
    if (keys.has('KeyD')) wish.add(right);
    if (keys.has('KeyA')) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();

    const feet = world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y + 0.4), Math.floor(player.pos.z));
    player.inWater = !!BLOCKS[feet].liquid;
    player.sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');

    let speed = player.flying ? 11 : player.inWater ? 2.6 : player.sprinting ? 6.8 : 4.3;
    const accel = player.onGround || player.flying ? 14 : player.inWater ? 6 : 4;
    player.vel.x += (wish.x * speed - player.vel.x) * Math.min(1, accel * dt);
    player.vel.z += (wish.z * speed - player.vel.z) * Math.min(1, accel * dt);

    if (player.flying) {
        let vy = 0;
        if (keys.has('Space')) vy += speed * 0.8;
        if (player.sprinting) vy -= speed * 0.8;
        player.vel.y += (vy - player.vel.y) * Math.min(1, 10 * dt);
    } else if (player.inWater) {
        player.vel.y -= 6 * dt;
        if (keys.has('Space')) player.vel.y += 16 * dt;
        player.vel.y = Math.max(-3, Math.min(3, player.vel.y));
    } else {
        player.vel.y -= GRAVITY * dt;
        player.vel.y = Math.max(-40, player.vel.y);
        if (keys.has('Space') && player.onGround) {
            player.vel.y = JUMP_SPEED;
            player.onGround = false;
        }
    }

    moveAxis('x', player.vel.x * dt);
    moveAxis('z', player.vel.z * dt);
    const falling = player.vel.y <= 0;
    const hitY = moveAxis('y', player.vel.y * dt);
    player.onGround = !player.flying && hitY && falling;

    if (player.onGround && wish.lengthSq() > 0 && !player.inWater) {
        const under = world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y - 0.1), Math.floor(player.pos.z));
        audio.footstep(under, player.sprinting ? 1.5 : 1);
    }

    if (player.pos.y < -20) { player.pos.copy(spawn); player.vel.set(0, 0, 0); toast('You fell out of the world and were returned to the start'); }

    syncCamera();
    audio.updateWind(player.pos.y);
}

// --- Targeting, placing and breaking ---------------------------------------------------------
function cameraDirection() {
    return new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation).normalize();
}

function syncCamera() {
    camera.position.set(player.pos.x, player.pos.y + PLAYER.eye, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
}

function updateTarget() {
    if (state === 'playing') syncCamera();
    hitInfo = world ? raycast(world, camera.position, cameraDirection(), REACH) : null;
    outline.visible = !!hitInfo && !blueprint.active && state === 'playing';
    if (hitInfo) outline.position.set(hitInfo.x + 0.5, hitInfo.y + 0.5, hitInfo.z + 0.5);
    if (blueprint.active) updateBlueprintAnchor();
}

function placementIntersectsPlayer(x, y, z) {
    const box = playerBox(player.pos);
    return x + 1 > box.minX && x < box.maxX && y + 1 > box.minY && y < box.maxY && z + 1 > box.minZ && z < box.maxZ;
}

function placeBlock() {
    if (!hitInfo) return false;
    const x = hitInfo.x + hitInfo.nx, y = hitInfo.y + hitInfo.ny, z = hitInfo.z + hitInfo.nz;
    const id = PLACEABLE[selected];
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    if (BLOCKS[id].solid && placementIntersectsPlayer(x, y, z)) return false;
    const existing = world.getBlock(x, y, z);
    if (existing !== BLOCK.AIR && !BLOCKS[existing].liquid) return false;
    world.setBlock(x, y, z, id);
    audio.place(id);
    dirty = true;
    return true;
}

function breakBlock() {
    if (!hitInfo) return false;
    if (hitInfo.y === 0) { toast('The bedrock here is too hard to break'); return false; }
    const id = hitInfo.id;
    world.setBlock(hitInfo.x, hitInfo.y, hitInfo.z, BLOCK.AIR);
    audio.break(id);
    dirty = true;
    return true;
}

function pickBlock() {
    if (!hitInfo) return;
    const idx = PLACEABLE.indexOf(hitInfo.id);
    if (idx >= 0) { selected = idx; renderHotbar(); audio.click(); }
}

// --- Blueprints --------------------------------------------------------------------------------
function currentBlueprint() { return BLUEPRINTS[blueprint.index]; }

function updateBlueprintGhost() {
    if (blueprint.ghost) {
        scene.remove(blueprint.ghost);
        blueprint.ghost.geometry.dispose();
        blueprint.ghost = null;
    }
    ui.blueprintPanel.hidden = !blueprint.active || thumbnailMode;
    if (!blueprint.active) { blueprint.cells = null; return; }
    const cells = blueprintCells(currentBlueprint(), blueprint.rotation);
    blueprint.cells = cells;
    const lookup = new Map(cells.filter(c => c.id !== BLOCK.AIR).map(c => [`${c.x},${c.y},${c.z}`, c.id]));
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const c of cells) {
        minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
        minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
        minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
    }
    const getBlock = (x, y, z) => lookup.get(`${x},${y},${z}`) ?? BLOCK.AIR;
    const passes = meshRegion(getBlock, minX, minY, minZ, maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1, { ao: false });
    const merged = { positions: [], normals: [], uvs: [], colours: [], indices: [] };
    for (const pass of ['opaque', 'transparent', 'glow']) {
        const p = passes[pass];
        const offset = merged.positions.length / 3;
        merged.positions.push(...p.positions); merged.normals.push(...p.normals);
        merged.uvs.push(...p.uvs); merged.colours.push(...p.colours);
        for (const i of p.indices) merged.indices.push(i + offset);
    }
    blueprint.ghost = new THREE.Mesh(geometryFrom(merged), materials.ghost);
    blueprint.ghost.renderOrder = 3;
    scene.add(blueprint.ghost);
    renderBlueprintList();
    updateBlueprintAnchor();
}

function updateBlueprintAnchor() {
    if (!blueprint.ghost) return;
    if (!hitInfo) { blueprint.ghost.visible = false; blueprint.anchor = null; return; }
    const y = hitInfo.y + 1 + blueprintBaseOffset(currentBlueprint());
    blueprint.anchor = { x: hitInfo.x, y, z: hitInfo.z };
    blueprint.ghost.visible = true;
    blueprint.ghost.position.set(hitInfo.x, y, hitInfo.z);
}

function stampBlueprint() {
    if (!blueprint.anchor || !blueprint.cells) return false;
    let placed = 0;
    for (const c of blueprint.cells) {
        const x = blueprint.anchor.x + c.x, y = blueprint.anchor.y + c.y, z = blueprint.anchor.z + c.z;
        if (y <= 0 || y >= WORLD_HEIGHT) continue;
        if (BLOCKS[c.id].solid && placementIntersectsPlayer(x, y, z)) continue;
        if (world.setBlock(x, y, z, c.id)) placed++;
    }
    if (placed) { audio.stamp(); dirty = true; toast(`${currentBlueprint().name} placed`); }
    return placed > 0;
}

function renderBlueprintList() {
    ui.blueprintList.innerHTML = '';
    BLUEPRINTS.forEach((bp, i) => {
        const li = document.createElement('li');
        li.className = i === blueprint.index ? 'selected' : '';
        li.innerHTML = `${bp.name}<span class="desc">${bp.description}</span>`;
        ui.blueprintList.appendChild(li);
    });
    updateModeBadge();
}

function toggleBlueprintMode(force) {
    blueprint.active = force === undefined ? !blueprint.active : force;
    audio.click();
    updateBlueprintGhost();
    updateModeBadge();
}

function cycleBlueprint(delta) {
    blueprint.index = (blueprint.index + delta + BLUEPRINTS.length) % BLUEPRINTS.length;
    updateBlueprintGhost();
}

// --- HUD -----------------------------------------------------------------------------------------
const hotbarCanvases = [];
function renderHotbar() {
    const page = Math.floor(selected / HOTBAR_SLOTS);
    const pages = Math.ceil(PLACEABLE.length / HOTBAR_SLOTS);
    if (!hotbarCanvases.length) {
        ui.hotbar.innerHTML = '';
        for (let i = 0; i < HOTBAR_SLOTS; i++) {
            const slot = document.createElement('div');
            slot.className = 'slot';
            const c = document.createElement('canvas');
            c.width = 64; c.height = 64;
            const key = document.createElement('span');
            key.className = 'key';
            key.textContent = String(i + 1);
            slot.append(c, key);
            ui.hotbar.appendChild(slot);
            hotbarCanvases.push({ slot, canvas: c });
        }
        const indicator = document.createElement('div');
        indicator.id = 'page-indicator';
        ui.hotbar.appendChild(indicator);
    }
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
        const idx = page * HOTBAR_SLOTS + i;
        const { slot, canvas: c } = hotbarCanvases[i];
        const id = PLACEABLE[idx];
        slot.classList.toggle('selected', idx === selected);
        slot.style.visibility = id === undefined ? 'hidden' : 'visible';
        if (id !== undefined) drawBlockIcon(c, BLOCKS[id], tiles);
    }
    $('page-indicator').textContent = `${page + 1}/${pages}`;
    ui.blockName.textContent = BLOCKS[PLACEABLE[selected]].name;
}

function updateModeBadge() {
    if (blueprint.active) {
        ui.modeBadge.textContent = `Blueprint: ${currentBlueprint().name} · ${blueprint.rotation * 90}°`;
        ui.modeBadge.className = 'badge blueprint';
    } else if (player.flying) {
        ui.modeBadge.textContent = 'Flying';
        ui.modeBadge.className = 'badge flying';
    } else {
        ui.modeBadge.textContent = 'Build mode';
        ui.modeBadge.className = 'badge';
    }
    ui.muteBadge.hidden = !audio.muted;
    ui.btnSound.textContent = `Sound: ${audio.muted ? 'off' : 'on'}`;
}

let toastTimer = null;
function toast(message) {
    ui.toast.textContent = message;
    ui.toast.hidden = false;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
}

// --- Input ---------------------------------------------------------------------------------------
function requestPointerLock() {
    if (thumbnailMode || document.pointerLockElement === canvas) return;
    try {
        const result = canvas.requestPointerLock();
        if (result && result.catch) result.catch(() => {});
    } catch (err) { /* pointer lock refused; mouse look is unavailable until the next click */ }
}

canvas.addEventListener('click', () => {
    if (state === 'playing') requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && state === 'playing' && !thumbnailMode) pause();
});

document.addEventListener('mousemove', e => {
    if (state !== 'playing' || document.pointerLockElement !== canvas) return;
    player.yaw -= e.movementX * 0.0022;
    player.pitch -= e.movementY * 0.0022;
    player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch));
});

canvas.addEventListener('mousedown', e => {
    if (state !== 'playing') return;
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) blueprint.active ? stampBlueprint() : placeBlock();
    else if (e.button === 2) breakBlock();
    else if (e.button === 1) { e.preventDefault(); pickBlock(); }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('wheel', e => {
    if (state !== 'playing') return;
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    if (!delta) return;
    if (blueprint.active) cycleBlueprint(delta);
    else { selected = (selected + delta + PLACEABLE.length) % PLACEABLE.length; renderHotbar(); }
}, { passive: false });

window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
        if (e.code === 'Enter' && e.target === ui.seedInput) ui.btnNew.click();
        return;
    }
    if (e.code === 'Escape') {
        if (state === 'playing') pause();
        else if (state === 'paused') resume();
        return;
    }
    if (state !== 'playing') return;
    keys.add(e.code);
    if (e.code === 'Tab') e.preventDefault();
    if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= HOTBAR_SLOTS) {
            const idx = Math.floor(selected / HOTBAR_SLOTS) * HOTBAR_SLOTS + n - 1;
            if (idx < PLACEABLE.length) { selected = idx; renderHotbar(); }
        }
    }
    switch (e.code) {
        case 'Tab': {
            const pages = Math.ceil(PLACEABLE.length / HOTBAR_SLOTS);
            const page = (Math.floor(selected / HOTBAR_SLOTS) + 1) % pages;
            selected = Math.min(PLACEABLE.length - 1, page * HOTBAR_SLOTS + (selected % HOTBAR_SLOTS));
            renderHotbar();
            break;
        }
        case 'KeyF':
            player.flying = !player.flying;
            player.vel.y = 0;
            updateModeBadge();
            toast(player.flying ? 'Flying: Space to rise, Shift to descend' : 'Walking');
            break;
        case 'KeyB': toggleBlueprintMode(); break;
        case 'KeyR': if (blueprint.active) { blueprint.rotation = (blueprint.rotation + 1) & 3; updateBlueprintGhost(); } break;
        case 'BracketLeft': if (blueprint.active) cycleBlueprint(-1); break;
        case 'BracketRight': if (blueprint.active) cycleBlueprint(1); break;
        case 'KeyN': skipTime(); break;
        case 'KeyM': audio.toggleMuted(); updateModeBadge(); toast(audio.muted ? 'Sound off' : 'Sound on'); break;
        case 'KeyH':
            hintsHidden = !hintsHidden;
            settings.hintsHidden = hintsHidden;
            saveSettings();
            ui.hintBar.classList.toggle('hidden-hints', hintsHidden);
            break;
        default: break;
    }
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Menus -----------------------------------------------------------------------------------------
function pause() {
    if (state !== 'playing') return;
    setState('paused');
    ui.pauseSummary.textContent = `Seed "${world.seedString}" · ${formatClock()} · ${world.edits.size} changes${dirty ? ' (unsaved)' : ''}`;
    if (dirty) saveToLocal(true);
    updateModeBadge();
}

function resume() {
    if (state !== 'paused') return;
    setState('playing');
    requestPointerLock();
}

function showMenu() {
    refreshContinueButton();
    ui.seedInput.value = randomSeed();
    if (!world) {
        createWorld(randomSeed());
        spawn = findSpawn();
        player.pos.copy(spawn);
        rebuildAllChunks();
    }
    setState('menu');
}

ui.btnNew.addEventListener('click', () => { audio.click(); startNewWorld(ui.seedInput.value.trim()); });
ui.btnRandomSeed.addEventListener('click', () => { audio.click(); ui.seedInput.value = randomSeed(); });
ui.btnContinue.addEventListener('click', () => {
    audio.click();
    try { loadSave(readLocalSave()); } catch (err) { alert(err.message); }
});
ui.btnResume.addEventListener('click', () => { audio.click(); resume(); });
ui.btnSave.addEventListener('click', () => { audio.click(); saveToLocal(); pause(); ui.pauseSummary.textContent = `Seed "${world.seedString}" · ${formatClock()} · ${world.edits.size} changes`; });
ui.btnExport.addEventListener('click', () => { audio.click(); exportWorld(); });
ui.btnImport.addEventListener('click', () => { audio.click(); ui.importFile.click(); });
ui.btnImportStart.addEventListener('click', () => { audio.click(); ui.importFile.click(); });
ui.importFile.addEventListener('change', () => {
    const file = ui.importFile.files && ui.importFile.files[0];
    if (file) importWorldFromFile(file);
    ui.importFile.value = '';
});
ui.btnSound.addEventListener('click', () => { audio.toggleMuted(); audio.click(); updateModeBadge(); });
ui.renderDistance.addEventListener('change', () => {
    settings.renderDistance = parseInt(ui.renderDistance.value, 10);
    saveSettings();
    lastChunkX = null;
    refreshChunkQueue(true);
});
ui.btnQuit.addEventListener('click', () => {
    audio.click();
    saveToLocal(true);
    showMenu();
});

window.addEventListener('beforeunload', () => { if (dirty && state !== 'menu') saveToLocal(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && dirty && state !== 'menu') saveToLocal(true); });

// --- Main loop -------------------------------------------------------------------------------------
let lastFrame = performance.now();
function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    if (state === 'playing') {
        time.t += dt / DAY_LENGTH;
        if (time.t >= 1) { time.t -= 1; time.day += 1; }
        updatePlayer(dt);
        updateTarget();
        ui.clock.textContent = formatClock();
        if (dirty && now - lastAutosave > 30000) saveToLocal(true);
    } else if (state === 'menu') {
        // slow orbit around the spawn point behind the title screen
        menuAngle += dt * 0.08;
        time.t += dt / (DAY_LENGTH * 0.5);
        if (time.t >= 1) time.t -= 1;
        const radius = 34;
        camera.position.set(spawn.x + Math.cos(menuAngle) * radius, spawn.y + 16, spawn.z + Math.sin(menuAngle) * radius);
        camera.lookAt(spawn.x, spawn.y + 2, spawn.z);
        player.pos.set(camera.position.x, camera.position.y, camera.position.z);
        outline.visible = false;
    } else if (state === 'paused') {
        updateTarget();
    }

    if (world) {
        updateChunks(state === 'loading' ? 30 : 7);
        updateSky();
        renderer.render(scene, camera);
    }
}

// --- Boot -------------------------------------------------------------------------------------------
window.__game = {
    get state() { return state; }, world: null, player, time, PLACEABLE, BLOCKS,
    startNewWorld, loadSave, saveToLocal, readLocalSave, snapshot, placeBlock, breakBlock, pickBlock, skipTime,
    toggleBlueprintMode, stampBlueprint, cycleBlueprint, pause, resume, showMenu, setTime: (t) => { time.t = t; },
    select: (i) => { selected = i; renderHotbar(); }, updateTarget, pendingChunks: () => buildQueue.length,
    look: (yaw, pitch) => { player.yaw = yaw; player.pitch = pitch; }
};

function boot() {
    hintsHidden = !!settings.hintsHidden;
    ui.hintBar.classList.toggle('hidden-hints', hintsHidden);
    ui.renderDistance.value = String(settings.renderDistance);
    updateModeBadge();
    renderHotbar();
    requestAnimationFrame(frame);

    if (thumbnailMode) {
        document.body.classList.add('thumbnail-mode');
        const overlay = document.createElement('div');
        overlay.id = 'thumbnail-overlay';
        overlay.innerHTML = '<h1>Eoin\'s Building Game</h1><p>Voxel sandbox · procedural terrain · day and night · blueprints</p>';
        document.body.appendChild(overlay);
    }

    if (params.has('seed') || thumbnailMode) {
        startNewWorld(params.get('seed') || 'portfolio');
        if (params.has('t')) time.t = parseFloat(params.get('t'));
        if (params.has('yaw')) player.yaw = parseFloat(params.get('yaw'));
        if (params.has('pitch')) player.pitch = parseFloat(params.get('pitch'));
        if (params.has('fly')) player.flying = true;
        if (params.has('x')) player.pos.set(parseFloat(params.get('x')), parseFloat(params.get('y')), parseFloat(params.get('z')));
        updateModeBadge();
        if (thumbnailMode) document.exitPointerLock();
    } else {
        showMenu();
    }
}

boot();
