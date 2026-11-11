// Eoin's Building Game: a first-person voxel sandbox.
// Rendering uses Three.js (loaded from a CDN as an ES module); everything else is in this repository.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import { BLOCKS, BLOCK, PLACEABLE, buildAtlas, drawBlockIcon } from './js/blocks.js';
import { World, meshChunk, meshRegion, raycast, CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, chunkKey } from './js/world.js';
import { BLUEPRINTS, blueprintCells, blueprintBaseOffset } from './js/blueprints.js';
import { GameAudio } from './js/audio.js';
import { ITEMS, RECIPES, HAND, dropsFor, breakPlan, newInventory, starterInventory, addToInventory, canCraft, craft, serialiseInventory, deserialiseInventory, drawItemIcon } from './js/items.js';
import { ENEMY_TYPES, createEnemy, updateEnemy, hurtEnemy, rollDrops, rayHitsEnemy, disposeEnemy, enemyBox } from './js/enemies.js';

const SAVE_KEY = 'eoins-building-game.world.v2';
const SETTINGS_KEY = 'eoins-building-game.settings';
const DAY_LENGTH = 240;           // seconds of real time per in-game day (four minutes)
const MAX_VITAL = 20;             // health and hunger both run from 0 to 20
const MAX_ENEMIES = 8;
const ATTACK_REACH = 4;
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
    pauseSummary: $('pause-summary'), importFile: $('import-file'), underwater: $('underwater-tint'),
    skyArc: $('sky-arc'), clockPhase: $('clock-phase'), mineProgress: $('mine-progress'), targetLabel: $('target-label'),
    vitals: $('vitals'), healthBar: $('health-bar'), hungerBar: $('hunger-bar'), damageFlash: $('damage-flash'),
    craftMenu: $('craft-menu'), recipeList: $('recipe-list'), btnCraftClose: $('btn-craft-close'),
    deathMenu: $('death-menu'), deathSummary: $('death-summary'), btnRespawn: $('btn-respawn'), btnDeathQuit: $('btn-death-quit'),
    modeOptions: Array.from(document.querySelectorAll('.mode-option'))
};

// --- Game state --------------------------------------------------------------------
const settings = loadSettings();
const audio = new GameAudio();
let state = 'loading';            // loading | menu | playing | paused | crafting | dead
let mode = 'creative';            // creative | survival
let chosenMode = 'creative';      // the start-menu selection
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

// Survival state: vitals, the inventory that backs the hotbar, timed mining and the creatures.
const survival = {
    health: MAX_VITAL, hunger: MAX_VITAL, inventory: newInventory(),
    hungerClock: 0, regenClock: 0, starveClock: 0, hurtCooldown: 0, deaths: 0, kills: 0,
    fallStart: null
};
const mining = { active: false, x: 0, y: 0, z: 0, progress: 0, seconds: 1, tickClock: 0 };
const mouse = { left: false, right: false };
const enemies = [];
let spawnClock = 0;
const heldLight = new THREE.PointLight(0xffb060, 0, 11, 1.6);

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
    glow: new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true, alphaTest: 0.5 }),
    ghost: new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, color: 0xbfe3ff })
};

const sun = new THREE.DirectionalLight(0xffffff, 1);
const ambient = new THREE.AmbientLight(0xffffff, 0.4);
const hemisphere = new THREE.HemisphereLight(0xbfdfff, 0x6b5a3a, 0.5);
scene.add(sun, sun.target, ambient, hemisphere);
scene.fog = new THREE.Fog(0x87ceeb, 60, 140);

// Sun, moon and stars follow the camera so they always sit on the horizon.
const sky = new THREE.Group();
// A gradient dome: horizon colour at the bottom blending to the zenith colour overhead.
const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(450, 24, 12),
    new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { horizon: { value: new THREE.Color(0x87ceeb) }, zenith: { value: new THREE.Color(0x3f7fd0) }, glowDir: { value: new THREE.Vector3(0, 1, 0) }, glowColour: { value: new THREE.Color(0xffa060) }, glowStrength: { value: 0 } },
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 glowDir; uniform vec3 glowColour; uniform float glowStrength; varying vec3 vDir;
            void main() {
                float h = clamp(vDir.y, 0.0, 1.0);
                vec3 c = mix(horizon, zenith, pow(h, 0.55));
                float g = pow(max(dot(normalize(vDir), glowDir), 0.0), 6.0) * glowStrength * (1.0 - h);
                c = mix(c, glowColour, clamp(g, 0.0, 0.85));
                gl_FragColor = vec4(c, 1.0);
            }`
    })
);
skyDome.renderOrder = -10;
const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(22, 32), new THREE.MeshBasicMaterial({ color: 0xfff1b0, fog: false }));
const sunHalo = new THREE.Mesh(new THREE.CircleGeometry(48, 32), new THREE.MeshBasicMaterial({ color: 0xffd080, fog: false, transparent: true, opacity: 0.25, depthWrite: false }));
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
sky.add(skyDome, sunHalo, sunDisc, moonDisc, stars);
scene.add(sky);
heldLight.visible = false;
scene.add(heldLight);

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
    world.unloadDistant(pcx, pcz, r + 3);
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

function startNewWorld(seedString, newMode = chosenMode) {
    createWorld(seedString || randomSeed());
    worldName = world.seedString;
    mode = newMode === 'survival' ? 'survival' : 'creative';
    time.t = 0.3; time.day = 1;
    spawn = findSpawn();
    player.pos.copy(spawn);
    player.vel.set(0, 0, 0);
    player.yaw = Math.PI * 0.25; player.pitch = -0.1; player.flying = false;
    resetSurvival(true);
    selected = 0;
    dirty = true;
    rebuildAllChunks();
    beginPlaying();
    if (mode === 'survival') toast('Survival: gather wood, craft tools (C) and light torches before dark');
}

function resetSurvival(fresh) {
    survival.health = MAX_VITAL;
    survival.hunger = MAX_VITAL;
    survival.hungerClock = 0; survival.regenClock = 0; survival.starveClock = 0; survival.hurtCooldown = 0;
    survival.fallStart = null;
    if (fresh) { survival.inventory = mode === 'survival' ? starterInventory() : newInventory(); survival.deaths = 0; survival.kills = 0; }
    mining.active = false;
    clearEnemies();
}

function beginPlaying() {
    blueprint.active = false;
    updateBlueprintGhost();
    setState('playing');
    audio.ensure();
    audio.startWind();
    renderHotbar();
    updateModeBadge();
    renderVitals();
    lastAutosave = performance.now();
    requestPointerLock();
}

function setState(next) {
    state = next;
    ui.hud.hidden = !(state === 'playing' || state === 'paused' || state === 'crafting');
    ui.startMenu.hidden = state !== 'menu';
    ui.pauseMenu.hidden = state !== 'paused';
    ui.craftMenu.hidden = state !== 'crafting';
    ui.deathMenu.hidden = state !== 'dead';
    ui.loading.hidden = state !== 'loading';
    ui.vitals.hidden = mode !== 'survival';
    if (thumbnailMode) ui.hud.hidden = true;
    if (state !== 'playing' && document.pointerLockElement === canvas) document.exitPointerLock();
    keys.clear();
    mouse.left = mouse.right = false;
    mining.active = false;
    updateMiningIndicator();
}

function randomSeed() {
    const words = ['oak', 'fen', 'moor', 'glen', 'burn', 'tor', 'cairn', 'dale', 'heath', 'loch', 'ridge', 'brae'];
    return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

// --- Saving and loading --------------------------------------------------------------
function snapshot() {
    return {
        game: 'eoins-building-game',
        version: 3,
        savedAt: new Date().toISOString(),
        seed: world.seedString,
        name: worldName,
        mode,
        time: { t: time.t, day: time.day },
        // a save written while dead records the respawn, not the corpse
        player: state === 'dead'
            ? { x: spawn.x, y: spawn.y, z: spawn.z, yaw: Math.PI * 0.25, pitch: -0.1, flying: false }
            : { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch, flying: player.flying },
        selected,
        survival: mode === 'survival' ? {
            health: state === 'dead' ? MAX_VITAL : survival.health, hunger: state === 'dead' ? MAX_VITAL : survival.hunger,
            deaths: survival.deaths, kills: survival.kills,
            inventory: serialiseInventory(survival.inventory)
        } : null,
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
    mode = data.mode === 'survival' ? 'survival' : 'creative';
    world.loadEdits(data.edits);
    time.t = typeof data.time?.t === 'number' ? data.time.t : 0.3;
    time.day = data.time?.day || 1;
    spawn = findSpawn();
    if (data.player && Number.isFinite(data.player.x)) {
        player.pos.set(data.player.x, data.player.y, data.player.z);
        player.yaw = data.player.yaw || 0;
        player.pitch = data.player.pitch || 0;
        player.flying = mode === 'creative' && !!data.player.flying;
    } else {
        player.pos.copy(spawn);
    }
    player.vel.set(0, 0, 0);
    resetSurvival(true);
    if (mode === 'survival') {
        const sv = data.survival || {};
        survival.health = clampVital(sv.health, MAX_VITAL);
        survival.hunger = clampVital(sv.hunger, MAX_VITAL);
        survival.deaths = sv.deaths | 0;
        survival.kills = sv.kills | 0;
        survival.inventory = sv.inventory ? deserialiseInventory(sv.inventory) : starterInventory();
        if (survival.health <= 0) survival.health = MAX_VITAL;
    }
    selected = Math.min(hotbarLength() - 1, Math.max(0, data.selected | 0));
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
        ui.saveSummary.textContent = `${save.mode === 'survival' ? 'Survival' : 'Creative'} · seed "${save.seed}" · day ${save.time?.day || 1} · ${save.edits.length} changes · saved ${when}`;
    }
}

// --- Time of day -----------------------------------------------------------------------
// Key colours for the sky, sampled by time of day (0 = midnight, 0.5 = noon). Each stop holds the
// horizon and zenith colours, the sunlight colour and the fog tint, so dawn and dusk are unmistakable.
const SKY_STOPS = [
    { t: 0.00, horizon: 0x0b1230, zenith: 0x02040c, sun: 0x8090c0 },   // midnight
    { t: 0.19, horizon: 0x1a1a3a, zenith: 0x05071a, sun: 0x8090c0 },   // deep night ending
    { t: 0.23, horizon: 0xd8785a, zenith: 0x33386a, sun: 0xff9a5a },   // dawn glow
    { t: 0.27, horizon: 0xf2bc8a, zenith: 0x5a8ed8, sun: 0xffc890 },   // sunrise
    { t: 0.35, horizon: 0x9fd0f5, zenith: 0x3f84dc, sun: 0xfff0d0 },   // morning
    { t: 0.50, horizon: 0xa8dcff, zenith: 0x3b7fe0, sun: 0xffffff },   // noon
    { t: 0.66, horizon: 0x9fcdf0, zenith: 0x3d7ed6, sun: 0xfff0d0 },   // afternoon
    { t: 0.73, horizon: 0xf2ab6a, zenith: 0x4a74c4, sun: 0xffb070 },   // golden hour
    { t: 0.77, horizon: 0xd8704a, zenith: 0x34306a, sun: 0xff8050 },   // sunset
    { t: 0.81, horizon: 0x3a2040, zenith: 0x080a20, sun: 0x8090c0 },   // dusk fades
    { t: 1.00, horizon: 0x0b1230, zenith: 0x02040c, sun: 0x8090c0 }    // midnight again
];
const stopColours = SKY_STOPS.map(st => ({ t: st.t, horizon: new THREE.Color(st.horizon), zenith: new THREE.Color(st.zenith), sun: new THREE.Color(st.sun) }));
const palette = { water: new THREE.Color(0x1f4f8a), moon: new THREE.Color(0x7d90c8) };
const skyColour = new THREE.Color();      // horizon colour: also the fog colour
const zenithColour = new THREE.Color();
const sunColour = new THREE.Color();

function sunElevation() { return Math.sin((time.t - 0.25) * Math.PI * 2); }

function lerpColour(out, a, b, k) { return out.copy(a).lerp(b, Math.max(0, Math.min(1, k))); }

function sampleSky(t) {
    for (let i = 0; i < stopColours.length - 1; i++) {
        const a = stopColours[i], b = stopColours[i + 1];
        if (t >= a.t && t <= b.t) {
            const k = (t - a.t) / (b.t - a.t);
            lerpColour(skyColour, a.horizon, b.horizon, k);
            lerpColour(zenithColour, a.zenith, b.zenith, k);
            lerpColour(sunColour, a.sun, b.sun, k);
            return;
        }
    }
}

// 0 at night, 1 in full daylight, with a soft ramp across dawn and dusk.
function daylightAmount() {
    const e = sunElevation();
    return Math.max(0, Math.min(1, (e + 0.08) / 0.45));
}

function dayPhase(t = time.t) {
    if (t < 0.2 || t >= 0.82) return 'Night';
    if (t < 0.28) return 'Dawn';
    if (t < 0.45) return 'Morning';
    if (t < 0.55) return 'Noon';
    if (t < 0.7) return 'Afternoon';
    return 'Dusk';
}

function updateSky() {
    const e = sunElevation();
    sampleSky(time.t);
    const daylight = daylightAmount();
    const underwater = world && world.isLiquid(camera.position.x, camera.position.y, camera.position.z);
    const far = settings.renderDistance * CHUNK_SIZE - 10;
    if (underwater) {
        scene.fog.color.copy(palette.water).multiplyScalar(0.4 + daylight * 0.6);
        scene.fog.near = 1; scene.fog.far = 22;
    } else {
        scene.fog.color.copy(skyColour);
        // night fog closes in a little so the dark feels close
        scene.fog.near = far * (0.35 + daylight * 0.2); scene.fog.far = far * (0.8 + daylight * 0.2);
    }
    scene.background = null;
    skyDome.material.uniforms.horizon.value.copy(underwater ? scene.fog.color : skyColour);
    skyDome.material.uniforms.zenith.value.copy(underwater ? scene.fog.color : zenithColour);
    ui.underwater.hidden = !underwater;

    const angle = (time.t - 0.25) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(angle) * 0.6, Math.sin(angle), Math.cos(angle) * 0.4).normalize();
    sun.position.copy(camera.position).addScaledVector(dir, 120);
    sun.target.position.copy(camera.position);
    if (e > -0.05) {
        sun.color.copy(sunColour);
        sun.intensity = 0.2 + Math.max(0, e) * 1.2;
    } else {
        sun.position.copy(camera.position).addScaledVector(dir, -120);
        sun.color.copy(palette.moon);
        sun.intensity = 0.14;
    }
    ambient.intensity = 0.1 + daylight * 0.42;
    hemisphere.intensity = 0.08 + daylight * 0.5;
    hemisphere.color.copy(skyColour);

    // horizon glow around the sun at dawn and dusk
    const lowSun = Math.max(0, 1 - Math.abs(e) / 0.3);
    skyDome.material.uniforms.glowDir.value.copy(dir);
    skyDome.material.uniforms.glowColour.value.copy(sunColour);
    skyDome.material.uniforms.glowStrength.value = lowSun * 1.4;

    sky.position.copy(camera.position);
    sunDisc.position.copy(dir).multiplyScalar(380);
    sunDisc.lookAt(camera.position);
    sunDisc.material.color.copy(sunColour).lerp(new THREE.Color(0xffffff), 0.4);
    sunHalo.position.copy(dir).multiplyScalar(385);
    sunHalo.lookAt(camera.position);
    sunHalo.material.color.copy(sunColour);
    sunHalo.material.opacity = 0.12 + lowSun * 0.3;
    moonDisc.position.copy(dir).multiplyScalar(-380);
    moonDisc.lookAt(camera.position);
    sunDisc.visible = sunHalo.visible = !underwater && e > -0.12;
    moonDisc.visible = !underwater && e < 0.12;
    stars.material.opacity = underwater ? 0 : Math.max(0, Math.min(1, -e * 3));

    heldLight.visible = mode === 'survival' && state !== 'menu' && daylight < 0.6 && heldItem()?.item === 'block:19';
    if (heldLight.visible) {
        heldLight.position.copy(camera.position);
        heldLight.intensity = (0.6 - daylight) * 1.4 + Math.sin(performance.now() / 90) * 0.08;
    }
    drawSkyArc(e, daylight);
}

// Small HUD widget: the sun and moon travel along an arc, so the time of day reads at a glance.
const arcCtx = ui.skyArc.getContext('2d');
function drawSkyArc(elevation, daylight) {
    if (ui.hud.hidden) return;
    const w = ui.skyArc.width, h = ui.skyArc.height;
    const ctx = arcCtx;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h - 8, r = 62;
    // sky band coloured like the current horizon
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `#${zenithColour.getHexString()}`);
    grad.addColorStop(1, `#${skyColour.getHexString()}`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, r + 8, Math.PI, 0); ctx.closePath(); ctx.fill();
    // ground line
    ctx.fillStyle = 'rgba(70, 110, 50, 0.9)';
    ctx.fillRect(cx - r - 8, cy, (r + 8) * 2, 3);
    // path
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0); ctx.stroke();
    ctx.setLineDash([]);
    // time 0.25 = sunrise on the left, 0.75 = sunset on the right
    const a = Math.PI + (time.t - 0.25) * Math.PI * 2;
    const sx = cx + Math.cos(a) * r, sy = cy + Math.sin(a) * r;
    const mx = cx - Math.cos(a) * r, my = cy - Math.sin(a) * r;
    if (my <= cy + 4) {
        ctx.fillStyle = '#e8ecff';
        ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `#${skyColour.getHexString()}`;
        ctx.beginPath(); ctx.arc(mx + 3.2, my - 1.5, 3.6, 0, Math.PI * 2); ctx.fill();
    }
    if (sy <= cy + 4) {
        ctx.fillStyle = `rgba(255, 200, 90, ${0.3 + daylight * 0.3})`;
        ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff3c0';
        ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill();
    }
    void elevation;
}

function formatClock() {
    const minutes = Math.round(time.t * 24 * 60) % (24 * 60);
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return `Day ${time.day} · ${hh}:${mm}`;
}

function skipTime() {
    const e = sunElevation();
    if (e > 0) { time.t = 0.76; }
    else { if (time.t > 0.5) time.day += 1; time.t = 0.24; }
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

    const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
    const feetY = Math.floor(player.pos.y + 0.1);
    const wasInWater = player.inWater;
    player.inWater = !!BLOCKS[world.getBlock(bx, feetY, bz)].liquid || !!BLOCKS[world.getBlock(bx, Math.floor(player.pos.y + 0.9), bz)].liquid;
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
        if (keys.has('Space')) player.vel.y += 22 * dt;
        player.vel.y = Math.max(-3, Math.min(4, player.vel.y));
        // Climb out: swimming towards a bank with headroom above it hoists the player onto it.
        if (keys.has('Space') && wish.lengthSq() > 0) {
            const ax = Math.floor(player.pos.x + wish.x * 0.75), az = Math.floor(player.pos.z + wish.z * 0.75);
            const bank = BLOCKS[world.getBlock(ax, feetY, az)].solid || BLOCKS[world.getBlock(ax, feetY + 1, az)].solid;
            const top = BLOCKS[world.getBlock(ax, feetY + 1, az)].solid ? feetY + 2 : feetY + 1;
            const headroom = !BLOCKS[world.getBlock(ax, top, az)].solid && !BLOCKS[world.getBlock(ax, top + 1, az)].solid;
            if (bank && headroom && top - player.pos.y <= 1.6) player.vel.y = Math.max(player.vel.y, JUMP_SPEED * 0.9);
        }
    } else {
        player.vel.y -= GRAVITY * dt;
        player.vel.y = Math.max(-40, player.vel.y);
        if (keys.has('Space') && player.onGround) {
            player.vel.y = JUMP_SPEED;
            player.onGround = false;
        } else if (keys.has('Space') && wasInWater && player.vel.y > 0) {
            // leaving the surface with the jump key held: finish the hop onto the shore
            player.vel.y = Math.max(player.vel.y, JUMP_SPEED * 0.8);
        }
    }

    moveAxis('x', player.vel.x * dt);
    moveAxis('z', player.vel.z * dt);
    const falling = player.vel.y <= 0;
    const impact = player.vel.y;
    const hitY = moveAxis('y', player.vel.y * dt);
    player.onGround = !player.flying && hitY && falling;
    if (mode === 'survival' && player.onGround && !player.inWater && impact < -13) {
        const damage = Math.round((-impact - 13) / 2.5 + 0.5);
        if (damage > 0) damagePlayer(damage, null, 'fall');
    }

    if (player.onGround && wish.lengthSq() > 0 && !player.inWater) {
        const under = world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y - 0.1), Math.floor(player.pos.z));
        audio.footstep(under, player.sprinting ? 1.5 : 1);
    }

    if (player.pos.y < -20) { player.pos.copy(spawn); player.vel.set(0, 0, 0); toast('You fell out of the world and were returned to the start'); }

    if (mode === 'survival') updateVitals(dt, wish.lengthSq() > 0);
    syncCamera();
    audio.updateWind(player.pos.y);
}

// --- Survival: vitals ---------------------------------------------------------------------------
function clampVital(v, fallback) {
    return Number.isFinite(v) ? Math.max(0, Math.min(MAX_VITAL, v)) : fallback;
}

function updateVitals(dt, moving) {
    survival.hurtCooldown = Math.max(0, survival.hurtCooldown - dt);
    // hunger ticks faster while sprinting or swimming
    const effort = player.sprinting && moving ? 2.4 : player.inWater ? 1.6 : moving ? 1.25 : 1;
    survival.hungerClock += dt * effort;
    if (survival.hungerClock >= 24) {
        survival.hungerClock -= 24;
        if (survival.hunger > 0) { survival.hunger -= 1; renderVitals(); if (survival.hunger === 4) toast('You are getting hungry'); }
    }
    if (survival.hunger <= 0) {
        survival.starveClock += dt;
        if (survival.starveClock >= 4) { survival.starveClock = 0; damagePlayer(1, null, 'starving'); }
    } else if (survival.hunger >= 14 && survival.health < MAX_VITAL) {
        survival.regenClock += dt;
        if (survival.regenClock >= 5) { survival.regenClock = 0; survival.health = Math.min(MAX_VITAL, survival.health + 1); renderVitals(); }
    }
}

// A creature can only strike when nothing solid stands between it and the player. Torches,
// bushes and water are not cover, so the line is sampled against solid blocks rather than raycast.
function creatureCanReach(enemy) {
    const from = enemy.pos.clone(); from.y += enemy.def.height * 0.7;
    const to = player.pos.clone(); to.y += PLAYER.height * 0.6;
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 1e-3) return true;
    dir.divideScalar(dist);
    const step = 0.2;
    for (let d = step; d < dist; d += step) {
        if (world.isSolid(from.x + dir.x * d, from.y + dir.y * d, from.z + dir.z * d)) return false;
    }
    return true;
}

function damagePlayer(amount, source, cause = 'attack') {
    if (mode !== 'survival' || state !== 'playing' || amount <= 0) return false;
    if (cause === 'attack' && survival.hurtCooldown > 0) return false;
    if (source && source.def && !creatureCanReach(source)) return false;
    survival.health = Math.max(0, survival.health - amount);
    survival.hurtCooldown = 0.6;
    survival.regenClock = 0;
    audio.hurt();
    ui.damageFlash.hidden = false;
    ui.damageFlash.classList.add('show');
    setTimeout(() => ui.damageFlash.classList.remove('show'), 120);
    if (source && source.pos) {
        const push = new THREE.Vector3().subVectors(player.pos, source.pos);
        push.y = 0;
        if (push.lengthSq() > 1e-4) { push.normalize().multiplyScalar(6); player.vel.x += push.x; player.vel.z += push.z; player.vel.y = Math.max(player.vel.y, 4); }
    }
    renderVitals();
    if (survival.health <= 0) die(cause, source);
    return true;
}

function die(cause, source) {
    survival.deaths += 1;
    audio.death();
    const by = source ? `a ${source.def.name.toLowerCase()}` : cause === 'fall' ? 'a long fall' : cause === 'starving' ? 'hunger' : 'the night';
    ui.deathSummary.textContent = `Killed by ${by} on day ${time.day}. ${survival.kills} creature${survival.kills === 1 ? '' : 's'} slain, ${world.edits.size} blocks changed. Your world and your inventory are kept.`;
    setState('dead');
    saveToLocal(true);
}

function respawn() {
    player.pos.copy(spawn);
    player.vel.set(0, 0, 0);
    player.yaw = Math.PI * 0.25; player.pitch = -0.1;
    resetSurvival(false);
    // waking at the start always leaves a full stretch of daylight: a death from the afternoon
    // onwards wakes you the next morning, and a death at night wakes you at dawn
    if (time.t >= 0.6) { time.day += 1; time.t = 0.24; } else if (time.t < 0.24) time.t = 0.24;
    renderVitals();
    setState('playing');
    requestPointerLock();
    saveToLocal(true);
    toast('You wake at the start. The world is as you left it.');
}

function eatHeld() {
    const slot = heldItem();
    const item = slot && ITEMS[slot.item];
    if (!item || item.kind !== 'food') return false;
    if (survival.hunger >= MAX_VITAL) { toast('You are not hungry'); return false; }
    survival.hunger = Math.min(MAX_VITAL, survival.hunger + item.food);
    survival.health = Math.min(MAX_VITAL, survival.health + Math.floor(item.food / 4));
    consumeHeld(1);
    audio.eat();
    renderVitals();
    dirty = true;
    return true;
}

// Hearts for health and drumsticks for hunger, painted on small canvases.
function renderVitals() {
    if (mode !== 'survival') return;
    drawVitalBar(ui.healthBar, survival.health, 'heart');
    drawVitalBar(ui.hungerBar, survival.hunger, 'food');
}

function drawVitalBar(canvas, value, kind) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 10; i++) {
        const fill = Math.max(0, Math.min(2, value - i * 2));   // 0, 1 (half) or 2 (full)
        const x = i * 22 + 2, y = 2;
        if (kind === 'heart') drawHeart(ctx, x, y, 18, fill);
        else drawDrumstick(ctx, x, y, 18, fill);
    }
}

function drawHeart(ctx, x, y, size, fill) {
    const path = () => {
        ctx.beginPath();
        ctx.moveTo(x + size / 2, y + size * 0.95);
        ctx.bezierCurveTo(x - size * 0.15, y + size * 0.55, x + size * 0.05, y + size * 0.05, x + size / 2, y + size * 0.3);
        ctx.bezierCurveTo(x + size * 0.95, y + size * 0.05, x + size * 1.15, y + size * 0.55, x + size / 2, y + size * 0.95);
        ctx.closePath();
    };
    path(); ctx.fillStyle = 'rgba(20, 10, 14, 0.75)'; ctx.fill();
    if (fill > 0) {
        ctx.save(); path(); ctx.clip();
        ctx.fillStyle = '#e23c3c';
        ctx.fillRect(x, y, fill === 2 ? size : size / 2, size);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(x + size * 0.22, y + size * 0.3, size * 0.14, size * 0.14);
        ctx.restore();
    }
    path(); ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.2; ctx.stroke();
}

function drawDrumstick(ctx, x, y, size, fill) {
    const path = () => {
        ctx.beginPath();
        ctx.arc(x + size * 0.6, y + size * 0.42, size * 0.34, 0, Math.PI * 2);
        ctx.moveTo(x + size * 0.42, y + size * 0.62);
        ctx.lineTo(x + size * 0.12, y + size * 0.92);
        ctx.lineTo(x + size * 0.04, y + size * 0.84);
        ctx.lineTo(x + size * 0.34, y + size * 0.54);
        ctx.closePath();
    };
    path(); ctx.fillStyle = 'rgba(20, 14, 8, 0.75)'; ctx.fill();
    if (fill > 0) {
        ctx.save(); path(); ctx.clip();
        ctx.fillStyle = '#c8863c';
        ctx.fillRect(x, y, fill === 2 ? size : size / 2, size);
        ctx.fillStyle = '#f4ecd8';
        ctx.fillRect(x + size * 0.02, y + size * 0.78, fill === 2 ? size * 0.25 : size * 0.15, size * 0.2);
        ctx.restore();
    }
    path(); ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.2; ctx.stroke();
}

// --- Survival: inventory helpers ----------------------------------------------------------------
function hotbarLength() { return mode === 'survival' ? survival.inventory.length : PLACEABLE.length; }

function heldItem() { return mode === 'survival' ? survival.inventory[selected] : null; }

function consumeHeld(n = 1) {
    const slot = survival.inventory[selected];
    if (!slot) return;
    slot.count -= n;
    if (slot.count <= 0) survival.inventory[selected] = null;
    renderHotbar();
}

function wearHeldTool() {
    const slot = survival.inventory[selected];
    if (!slot || ITEMS[slot.item].kind !== 'tool') return;
    slot.durability -= 1;
    if (slot.durability <= 0) {
        toast(`Your ${ITEMS[slot.item].name.toLowerCase()} broke`);
        audio.break(BLOCK.PLANKS);
        survival.inventory[selected] = null;
    }
    renderHotbar();
}

function giveItems(drops) {
    let gained = 0;
    for (const d of drops) {
        const left = addToInventory(survival.inventory, d.item, d.count);
        gained += d.count - left;
        if (left > 0) toast('Your inventory is full');
    }
    if (gained) { audio.pickup(); renderHotbar(); }
    return gained;
}

// --- Survival: timed mining -------------------------------------------------------------------------
function updateMining(dt) {
    if (mode !== 'survival' || !mouse.right || !hitInfo || blueprint.active) { mining.active = false; updateMiningIndicator(); return; }
    const plan = hitInfo.y === 0 ? null : breakPlan(hitInfo.id, heldItem() ? ITEMS[heldItem().item] : null);
    if (!plan) { mining.active = false; updateMiningIndicator(hitInfo.y === 0 ? 'The bedrock here is too hard to break' : null); return; }
    if (!mining.active || mining.x !== hitInfo.x || mining.y !== hitInfo.y || mining.z !== hitInfo.z) {
        Object.assign(mining, { active: true, x: hitInfo.x, y: hitInfo.y, z: hitInfo.z, progress: 0, seconds: plan.seconds, tickClock: 0 });
    }
    mining.progress += dt / plan.seconds;
    mining.tickClock += dt;
    if (mining.tickClock >= 0.28) { mining.tickClock = 0; audio.mineTick(hitInfo.id); }
    const block = BLOCKS[hitInfo.id];
    updateMiningIndicator(plan.collects ? null : `Needs a ${block.tier >= 2 ? 'stone or iron ' : ''}${block.tool} to collect`);
    if (mining.progress >= 1) {
        const id = hitInfo.id;
        world.setBlock(hitInfo.x, hitInfo.y, hitInfo.z, BLOCK.AIR);
        audio.break(id);
        dirty = true;
        if (plan.collects) giveItems(dropsFor(id));
        if (block.tool || block.hardness >= 0.5) wearHeldTool();
        mining.active = false;
        mining.progress = 0;
        updateMiningIndicator();
    }
}

function updateMiningIndicator(label = null) {
    const show = mining.active && mode === 'survival' && state === 'playing';
    ui.mineProgress.hidden = !show;
    if (show) ui.mineProgress.style.setProperty('--progress', `${Math.min(100, mining.progress * 100)}%`);
    ui.targetLabel.hidden = !label || state !== 'playing';
    if (label) { ui.targetLabel.textContent = label; ui.targetLabel.className = 'warn'; }
}

// --- Survival: creatures ------------------------------------------------------------------------------
function clearEnemies() {
    for (const e of enemies) { scene.remove(e.group); disposeEnemy(e); }
    enemies.length = 0;
    spawnClock = 0;
}

function removeEnemy(enemy) {
    const i = enemies.indexOf(enemy);
    if (i >= 0) enemies.splice(i, 1);
    scene.remove(enemy.group);
    disposeEnemy(enemy);
}

function isLitNearby(x, y, z, radius = 5) {
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
            for (let dy = -2; dy <= 3; dy++) {
                if (BLOCKS[world.getBlock(x + dx, y + dy, z + dz)].glow) return true;
            }
        }
    }
    return false;
}

function spawnEnemy(type, x, y, z) {
    const enemy = createEnemy(type, x, y, z);
    enemies.push(enemy);
    scene.add(enemy.group);
    return enemy;
}

// Creatures appear on the dark surface some distance from the player, never where torches burn.
function trySpawnEnemies(dt) {
    if (mode !== 'survival' || daylightAmount() > 0.12) { spawnClock = 0; return; }
    spawnClock += dt;
    if (spawnClock < 2.5 || enemies.length >= MAX_ENEMIES) return;
    spawnClock = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
        const angle = Math.random() * Math.PI * 2, dist = 14 + Math.random() * 16;
        const x = Math.floor(player.pos.x + Math.cos(angle) * dist), z = Math.floor(player.pos.z + Math.sin(angle) * dist);
        const top = world.surfaceHeight(x, z);
        const y = top + 1;
        if (top <= SEA_LEVEL || y + 2 >= WORLD_HEIGHT) continue;
        if (world.getBlock(x, y, z) !== BLOCK.AIR || world.getBlock(x, y + 1, z) !== BLOCK.AIR) continue;
        if (isLitNearby(x, y, z)) continue;
        const type = Math.random() < 0.55 ? 'brute' : 'lunger';
        const enemy = spawnEnemy(type, x + 0.5, y, z + 0.5);
        if (dist < 24) audio.growl(type === 'lunger');
        void enemy;
        return;
    }
}

const enemyContext = {
    hitsSolid: box => boxHitsSolid(box),
    get playerPos() { return player.pos; },
    get playerBox() { return playerBox(player.pos); },
    damagePlayer: (amount, enemy) => damagePlayer(amount, enemy),
    get daylight() { return daylightAmount(); },
    inLiquid: (x, y, z) => world.isLiquid(x, y, z),
    onLunge: () => audio.growl(true)
};

function updateEnemies(dt) {
    if (!enemies.length) return;
    for (const enemy of Array.from(enemies)) {
        const alive = updateEnemy(enemy, dt, enemyContext);
        const far = enemy.pos.distanceTo(player.pos) > 64;
        if (!alive || far || enemy.pos.y < -10) removeEnemy(enemy);
    }
}

// The creature under the crosshair within arm's reach, if it is nearer than any block.
function targetedEnemy() {
    const dir = cameraDirection();
    let best = null, bestDist = hitInfo ? hitInfo.distance : ATTACK_REACH;
    for (const enemy of enemies) {
        const d = rayHitsEnemy(enemy, camera.position, dir, ATTACK_REACH);
        if (d < bestDist) { best = enemy; bestDist = d; }
    }
    return best;
}

function attack(enemy) {
    const slot = heldItem();
    const item = slot ? ITEMS[slot.item] : null;
    const damage = item && item.kind === 'tool' ? item.damage : HAND.damage;
    const dead = hurtEnemy(enemy, damage, player.pos);
    audio.hitEnemy();
    if (item && item.kind === 'tool') wearHeldTool();
    if (dead) {
        survival.kills += 1;
        audio.enemyDie();
        const drops = rollDrops(enemy);
        const gained = giveItems(drops);
        toast(`${enemy.def.name} defeated${gained ? ': ' + drops.map(d => `${d.count} ${ITEMS[d.item].name.toLowerCase()}`).join(', ') : ''}`);
        removeEnemy(enemy);
        dirty = true;
    }
}

// Left click: attack a creature in reach, eat the held food, or place the held block.
function primaryAction() {
    if (blueprint.active) { stampBlueprint(); return; }
    if (mode !== 'survival') { placeBlock(); return; }
    const enemy = targetedEnemy();
    if (enemy) { attack(enemy); return; }
    const slot = heldItem();
    const item = slot ? ITEMS[slot.item] : null;
    if (!item) return;
    if (item.kind === 'food') eatHeld();
    else if (item.kind === 'block') placeBlock();
}

// --- Survival: crafting ----------------------------------------------------------------------------------
function openCrafting() {
    if (mode !== 'survival') { toast('Crafting is part of Survival mode'); return; }
    if (state !== 'playing') return;
    setState('crafting');
    renderRecipes();
    audio.click();
}

function closeCrafting() {
    if (state !== 'crafting') return;
    setState('playing');
    requestPointerLock();
}

function renderRecipes() {
    ui.recipeList.innerHTML = '';
    RECIPES.forEach((recipe, index) => {
        const li = document.createElement('li');
        const affordable = canCraft(survival.inventory, recipe);
        li.className = affordable ? '' : 'unaffordable';
        const icon = document.createElement('canvas');
        icon.width = icon.height = 64;
        drawItemIcon(icon, recipe.out, tiles);
        const text = document.createElement('div');
        const needs = Object.entries(recipe.needs).map(([key, n]) => {
            const have = survival.inventory.filter(sl => sl && sl.item === key).reduce((a, sl) => a + sl.count, 0);
            return `<b class="${have >= n ? '' : 'short'}">${n} ${ITEMS[key].name.toLowerCase()}</b> (${have})`;
        }).join(' · ');
        text.innerHTML = `<div class="name">${recipe.count > 1 ? recipe.count + ' × ' : ''}${ITEMS[recipe.out].name}</div><div class="needs">${needs}</div>`;
        li.append(icon, text);
        li.title = recipe.note || '';
        li.addEventListener('click', () => craftRecipe(index));
        ui.recipeList.appendChild(li);
    });
}

function craftRecipe(index) {
    const recipe = RECIPES[index];
    if (!recipe) return false;
    const result = craft(survival.inventory, recipe);
    if (!result) { toast('You need more materials for that'); return false; }
    if (result.full) { toast('No room in your inventory for that'); return false; }
    audio.craft();
    toast(`Crafted ${result.made} × ${ITEMS[recipe.out].name}`);
    dirty = true;
    renderRecipes();
    renderHotbar();
    return true;
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
    let id;
    if (mode === 'survival') {
        const slot = heldItem();
        if (!slot || ITEMS[slot.item].kind !== 'block') return false;
        id = ITEMS[slot.item].block;
    } else {
        id = PLACEABLE[selected];
    }
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    if (BLOCKS[id].solid && placementIntersectsPlayer(x, y, z)) return false;
    const existing = world.getBlock(x, y, z);
    if (existing !== BLOCK.AIR && !BLOCKS[existing].liquid) return false;
    world.setBlock(x, y, z, id);
    audio.place(id);
    if (mode === 'survival') consumeHeld(1);
    dirty = true;
    return true;
}

function breakBlock() {
    // Targeting ignores water so blocks can be placed through it, but water in front of the
    // targeted block (or with nothing solid behind it) should still be removable.
    const liquidHit = raycast(world, camera.position, cameraDirection(), REACH, true);
    const target = liquidHit && BLOCKS[liquidHit.id].liquid && (!hitInfo || liquidHit.distance < hitInfo.distance) ? liquidHit : hitInfo;
    if (!target) return false;
    if (target.y === 0) { toast('The bedrock here is too hard to break'); return false; }
    const id = target.id;
    world.setBlock(target.x, target.y, target.z, BLOCK.AIR);
    audio.break(id);
    dirty = true;
    return true;
}

function pickBlock() {
    if (!hitInfo) return;
    const idx = mode === 'survival'
        ? survival.inventory.findIndex(sl => sl && sl.item === `block:${hitInfo.id}`)
        : PLACEABLE.indexOf(hitInfo.id);
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
    if (mode === 'survival') { blueprint.active = false; updateBlueprintGhost(); toast('Blueprints are a Creative mode tool'); return; }
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
const HINTS = {
    creative: 'WASD move · Space jump · Shift sprint · F fly · Left click place · Right click break · Middle click pick · Wheel or 1-9 choose block · Tab next page · B blueprints · N skip time · M mute · Esc menu · H hide hints',
    survival: 'WASD move · Space jump · Shift sprint · Left click place, eat or attack · Hold right click to mine · Middle click pick · Wheel or 1-9 choose · Tab next page · C craft · N skip time · M mute · Esc menu · H hide hints'
};

function renderHotbar() {
    const length = hotbarLength();
    const page = Math.floor(selected / HOTBAR_SLOTS);
    const pages = Math.ceil(length / HOTBAR_SLOTS);
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
            const count = document.createElement('span');
            count.className = 'count';
            const durability = document.createElement('span');
            durability.className = 'durability';
            durability.hidden = true;
            durability.appendChild(document.createElement('i'));
            slot.append(c, key, count, durability);
            ui.hotbar.appendChild(slot);
            hotbarCanvases.push({ slot, canvas: c, count, durability });
        }
        const indicator = document.createElement('div');
        indicator.id = 'page-indicator';
        ui.hotbar.appendChild(indicator);
    }
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
        const idx = page * HOTBAR_SLOTS + i;
        const { slot, canvas: c, count, durability } = hotbarCanvases[i];
        slot.classList.toggle('selected', idx === selected);
        if (mode === 'survival') {
            const entry = survival.inventory[idx];
            slot.style.visibility = idx < length ? 'visible' : 'hidden';
            slot.classList.toggle('empty', !entry);
            if (entry) drawItemIcon(c, entry.item, tiles); else c.getContext('2d').clearRect(0, 0, c.width, c.height);
            count.textContent = entry && entry.count > 1 ? String(entry.count) : '';
            const item = entry && ITEMS[entry.item];
            if (item && item.kind === 'tool') {
                durability.hidden = false;
                const ratio = entry.durability / item.durability;
                durability.firstChild.style.width = `${Math.round(ratio * 100)}%`;
                durability.classList.toggle('low', ratio < 0.25);
            } else {
                durability.hidden = true;
            }
        } else {
            const id = PLACEABLE[idx];
            slot.classList.remove('empty');
            slot.style.visibility = id === undefined ? 'hidden' : 'visible';
            if (id !== undefined) drawBlockIcon(c, BLOCKS[id], tiles);
            count.textContent = '';
            durability.hidden = true;
        }
    }
    $('page-indicator').textContent = `${page + 1}/${pages}`;
    if (mode === 'survival') {
        const entry = survival.inventory[selected];
        const item = entry && ITEMS[entry.item];
        if (!item) ui.blockName.textContent = 'Empty hand';
        else if (item.kind === 'tool') ui.blockName.textContent = `${item.name} · ${entry.durability}/${item.durability}`;
        else if (item.kind === 'food') ui.blockName.textContent = `${item.name} × ${entry.count} · restores ${item.food} hunger`;
        else ui.blockName.textContent = `${item.name} × ${entry.count}`;
    } else {
        ui.blockName.textContent = BLOCKS[PLACEABLE[selected]].name;
    }
    ui.hintBar.textContent = HINTS[mode];
}

function updateModeBadge() {
    if (blueprint.active) {
        ui.modeBadge.textContent = `Blueprint: ${currentBlueprint().name} · ${blueprint.rotation * 90}°`;
        ui.modeBadge.className = 'badge blueprint';
    } else if (player.flying) {
        ui.modeBadge.textContent = 'Flying';
        ui.modeBadge.className = 'badge flying';
    } else if (mode === 'survival') {
        ui.modeBadge.textContent = 'Survival';
        ui.modeBadge.className = 'badge survival';
    } else {
        ui.modeBadge.textContent = 'Creative';
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
    if (e.button === 0) { mouse.left = true; primaryAction(); }
    else if (e.button === 2) { mouse.right = true; if (mode !== 'survival') breakBlock(); }
    else if (e.button === 1) { e.preventDefault(); pickBlock(); }
});
window.addEventListener('mouseup', e => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('wheel', e => {
    if (state !== 'playing') return;
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    if (!delta) return;
    if (blueprint.active) cycleBlueprint(delta);
    else { const n = hotbarLength(); selected = (selected + delta + n) % n; renderHotbar(); }
}, { passive: false });

window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
        if (e.code === 'Enter' && e.target === ui.seedInput) ui.btnNew.click();
        return;
    }
    if (e.code === 'Escape') {
        if (state === 'playing') pause();
        else if (state === 'paused') resume();
        else if (state === 'crafting') closeCrafting();
        return;
    }
    if (state === 'crafting' && e.code === 'KeyC') { closeCrafting(); return; }
    if (state !== 'playing') return;
    keys.add(e.code);
    if (e.code === 'Tab') e.preventDefault();
    if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= HOTBAR_SLOTS) {
            const idx = Math.floor(selected / HOTBAR_SLOTS) * HOTBAR_SLOTS + n - 1;
            if (idx < hotbarLength()) { selected = idx; renderHotbar(); }
        }
    }
    switch (e.code) {
        case 'Tab': {
            const pages = Math.ceil(hotbarLength() / HOTBAR_SLOTS);
            const page = (Math.floor(selected / HOTBAR_SLOTS) + 1) % pages;
            selected = Math.min(hotbarLength() - 1, page * HOTBAR_SLOTS + (selected % HOTBAR_SLOTS));
            renderHotbar();
            break;
        }
        case 'KeyF':
            if (mode === 'survival') { toast('Flying is a Creative mode perk'); break; }
            player.flying = !player.flying;
            player.vel.y = 0;
            updateModeBadge();
            toast(player.flying ? 'Flying: Space to rise, Shift to descend' : 'Walking');
            break;
        case 'KeyB': toggleBlueprintMode(); break;
        case 'KeyC': openCrafting(); break;
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
    ui.pauseSummary.textContent = `${mode === 'survival' ? 'Survival' : 'Creative'} · seed "${world.seedString}" · ${formatClock()} · ${world.edits.size} changes${dirty ? ' (unsaved)' : ''}`;
    saveToLocal(true);
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

ui.btnNew.addEventListener('click', () => { audio.click(); startNewWorld(ui.seedInput.value.trim(), chosenMode); });
ui.modeOptions.forEach(button => button.addEventListener('click', () => {
    audio.click();
    chosenMode = button.dataset.mode;
    settings.mode = chosenMode;
    saveSettings();
    syncModeOptions();
}));
function syncModeOptions() {
    ui.modeOptions.forEach(b => {
        const on = b.dataset.mode === chosenMode;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
}
ui.btnCraftClose.addEventListener('click', () => { audio.click(); closeCrafting(); });
ui.btnRespawn.addEventListener('click', () => { audio.click(); respawn(); });
ui.btnDeathQuit.addEventListener('click', () => {
    audio.click();
    player.pos.copy(spawn);
    resetSurvival(false);
    saveToLocal(true);
    showMenu();
});
ui.btnRandomSeed.addEventListener('click', () => { audio.click(); ui.seedInput.value = randomSeed(); });
ui.btnContinue.addEventListener('click', () => {
    audio.click();
    try { loadSave(readLocalSave()); } catch (err) { alert(err.message); }
});
ui.btnResume.addEventListener('click', () => { audio.click(); resume(); });
ui.btnSave.addEventListener('click', () => { audio.click(); saveToLocal(); pause(); ui.pauseSummary.textContent = `${mode === 'survival' ? 'Survival' : 'Creative'} · seed "${world.seedString}" · ${formatClock()} · ${world.edits.size} changes`; });
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
    clearEnemies();
    showMenu();
});

window.addEventListener('beforeunload', () => { if (state !== 'menu' && state !== 'dead') saveToLocal(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state !== 'menu') saveToLocal(true); });

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
        if (mode === 'survival' && state === 'playing') {
            updateMining(dt);
            trySpawnEnemies(dt);
            updateEnemies(dt);
        }
        ui.clock.textContent = formatClock();
        ui.clockPhase.textContent = dayPhase();
        if (now - lastAutosave > 30000 && state === 'playing') saveToLocal(true); // position and time change constantly, so save regardless of edits
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
    } else if (state === 'paused' || state === 'crafting' || state === 'dead') {
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
    get state() { return state; }, get mode() { return mode; }, world: null, player, time, PLACEABLE, BLOCKS, ITEMS, RECIPES,
    survival, enemies, mining, mouse,
    startNewWorld, loadSave, saveToLocal, readLocalSave, snapshot, placeBlock, breakBlock, pickBlock, skipTime,
    toggleBlueprintMode, stampBlueprint, cycleBlueprint, pause, resume, showMenu, setTime: (t) => { time.t = t; },
    select: (i) => { selected = i; renderHotbar(); }, get selected() { return selected; }, updateTarget, pendingChunks: () => buildQueue.length,
    look: (yaw, pitch) => { player.yaw = yaw; player.pitch = pitch; },
    primaryAction, openCrafting, closeCrafting, craftRecipe, spawnEnemy, damagePlayer, respawn, eatHeld, giveItems, heldItem,
    // stamp a blueprint by index at a world position (used by the thumbnail capture and tests)
    stampAt: (index, x, y, z, rotation = 0) => {
        let placed = 0;
        for (const c of blueprintCells(BLUEPRINTS[index], rotation)) {
            if (y + c.y > 0 && y + c.y < WORLD_HEIGHT && world.setBlock(x + c.x, y + c.y, z + c.z, c.id)) placed++;
        }
        return placed;
    },
    sunElevation, daylightAmount, dayPhase, renderVitals
};

function boot() {
    hintsHidden = !!settings.hintsHidden;
    ui.hintBar.classList.toggle('hidden-hints', hintsHidden);
    ui.renderDistance.value = String(settings.renderDistance);
    chosenMode = settings.mode === 'survival' ? 'survival' : 'creative';
    syncModeOptions();
    updateModeBadge();
    renderHotbar();
    requestAnimationFrame(frame);

    if (thumbnailMode) {
        document.body.classList.add('thumbnail-mode');
        const overlay = document.createElement('div');
        overlay.id = 'thumbnail-overlay';
        overlay.innerHTML = '<h1>Eoin\'s Building Game</h1><p>Voxel sandbox · survival and creative · day and night · blueprints</p>';
        document.body.appendChild(overlay);
    }

    if (params.has('seed') || thumbnailMode) {
        startNewWorld(params.get('seed') || 'portfolio', params.get('mode') || 'creative');
        if (params.has('t')) time.t = parseFloat(params.get('t'));
        if (params.has('yaw')) player.yaw = parseFloat(params.get('yaw'));
        if (params.has('pitch')) player.pitch = parseFloat(params.get('pitch'));
        if (params.has('fly') && mode === 'creative') player.flying = true;
        if (params.has('x')) player.pos.set(parseFloat(params.get('x')), parseFloat(params.get('y')), parseFloat(params.get('z')));
        updateModeBadge();
        if (thumbnailMode) document.exitPointerLock();
    } else {
        showMenu();
    }
}

boot();
