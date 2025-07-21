import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';

// Global constants for world size and chunking
const GROUND_SIZE = 1000;
const GROUND_HEIGHT = 3;
const CHUNK_SIZE = 32; // Reduced for better performance

// game.js - Three.js ES module game logic
// Pause menu/game state
// Scenery objects for clearing
console.log('Game script loaded');
let isPaused = false;
window.addEventListener('resetWorld', () => {
    console.log('Event: resetWorld');
    // Remove all blocks
    if (!window.blockMeshes) window.blockMeshes = [];
    if (window.blockMeshes && typeof threeScene !== 'undefined') {
        for (const block of window.blockMeshes) {
            if (block) threeScene.remove(block);
        }
        window.blockMeshes = [];
    }
    // Optionally reset camera position
    if (typeof threeCamera !== 'undefined' && threeCamera) {
        threeCamera.position.set(0, 18, 60);
        cameraControls.yaw = 0;
        cameraControls.pitch = 0;
    }
});
// Ensure file ends with correct closing brace
// (No-op, just fixes syntax)
window.addEventListener('exportWorld', () => {
window.addEventListener('exportWorld', () => {
    console.log('Event: exportWorld');
    // Export block positions as JSON
    if (!window.blockMeshes) window.blockMeshes = [];
    const blocks = window.blockMeshes.map(b => ({ x: b.position.x, y: b.position.y, z: b.position.z }));
    const dataStr = JSON.stringify(blocks);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'world.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});
window.addEventListener('importWorld', () => {
    console.log('Event: importWorld');
    // Import block positions from JSON file
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const blocks = JSON.parse(ev.target.result);
                // Remove existing blocks
                if (!window.blockMeshes) window.blockMeshes = [];
                if (window.blockMeshes && typeof threeScene !== 'undefined') {
                    for (const block of window.blockMeshes) {
                        if (block) threeScene.remove(block);
                    }
                    window.blockMeshes = [];
                }
                // Add imported blocks
                for (const pos of blocks) {
                    const block = new THREE.Mesh(
                        new THREE.BoxGeometry(1, 1, 1),
                        new THREE.MeshLambertMaterial({ color: 0xc2b280 })
                    );
                    block.position.set(pos.x, pos.y, pos.z);
                    if (typeof threeScene !== 'undefined') {
                        threeScene.add(block);
                    }
                    window.blockMeshes.push(block);
                }
            } catch (err) {
                alert('Failed to import world: ' + err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
});
window.addEventListener('openOptions', () => {
    console.log('Event: openOptions');
    alert('Options menu coming soon!');
});

// Three.js 3D Forest Scene Setup
let threeScene, threeCamera, threeRenderer;
// Global renderedBlocks map for all block meshes
window.renderedBlocks = new Map();
let cameraControls = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    yaw: 0,
    pitch: 0,
    dragging: false,
    lastX: 0,
    lastY: 0
};

// Player position in world
let playerPos = new THREE.Vector3(0, GROUND_HEIGHT + 2, 0);

// Block types and textures
const BLOCK_TYPES = [
    { name: 'grass', color: 0x4caf50 },
    { name: 'dirt', color: 0x8d5524 },
    { name: 'sand', color: 0xffe082 },
    { name: 'water', color: 0x4fc3f7 },
    { name: 'stone', color: 0x888888 }
];
let selectedBlockType = 0; // index into BLOCK_TYPES

function updateBlockSelectorUI() {
    const prev = document.querySelector('.block-prev');
    const curr = document.querySelector('.block-current');
    const next = document.querySelector('.block-next');
    if (!prev || !curr || !next) return;
    // Calculate indices
    const prevIdx = (selectedBlockType - 1 + BLOCK_TYPES.length) % BLOCK_TYPES.length;
    const nextIdx = (selectedBlockType + 1) % BLOCK_TYPES.length;
    // Set colors
    prev.style.background = `#${BLOCK_TYPES[prevIdx].color.toString(16).padStart(6, '0')}`;
    curr.style.background = `#${BLOCK_TYPES[selectedBlockType].color.toString(16).padStart(6, '0')}`;
    next.style.background = `#${BLOCK_TYPES[nextIdx].color.toString(16).padStart(6, '0')}`;
    // Set tooltips
    prev.title = BLOCK_TYPES[prevIdx].name;
    curr.title = BLOCK_TYPES[selectedBlockType].name;
    next.title = BLOCK_TYPES[nextIdx].name;
}

// Faint block outline for placement preview
let placementOutline = null;
function updatePlacementOutline() {
    if (!threeScene || !threeCamera) return;
    if (!placementOutline) {
        const outlineGeo = new THREE.BoxGeometry(1.01, 1.01, 1.01);
        const outlineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
        placementOutline = new THREE.LineSegments(new THREE.EdgesGeometry(outlineGeo), outlineMat);
        placementOutline.visible = false;
        threeScene.add(placementOutline);
    }
    // Raycast to find placement position
    const raycaster = new THREE.Raycaster();
    raycaster.set(threeCamera.position, getCameraDirection());
    let pos = null;
    const intersects = raycaster.intersectObjects(window.blockMeshes, false);
    if (intersects.length > 0) {
        const hit = intersects[0];
        if (hit.face) {
            const normal = hit.face.normal;
            pos = hit.point.clone().add(normal.multiplyScalar(1));
        } else {
            pos = hit.point.clone();
        }
        pos.x = Math.round(pos.x);
        pos.y = Math.round(pos.y);
        pos.z = Math.round(pos.z);
    } else {
        // In front of camera
        pos = threeCamera.position.clone().add(getCameraDirection().multiplyScalar(5));
        pos.x = Math.round(pos.x);
        pos.y = Math.round(pos.y);
        pos.z = Math.round(pos.z);
    }
    // Don't show below ground
    if (pos.y < 0) {
        placementOutline.visible = false;
        return;
    }
    placementOutline.position.copy(pos);
    placementOutline.visible = true;
}
function setupThreeScene() {
    console.log('setupThreeScene: start');
    let canvas = document.getElementById('three-canvas');
    if (!canvas) {
        console.error("Canvas element with id 'three-canvas' not found.");
        return;
    }
    console.log('setupThreeScene: canvas found');
    // Block storage
    window.blockMeshes = [];
    // Block interaction (place/break)
    canvas.addEventListener('mousedown', (e) => {
        console.log('Canvas mousedown', {button: e.button, pointerLock: document.pointerLockElement === canvas});
        if (document.pointerLockElement !== canvas) return;
        if (e.button === 0) {
            // Left click: place block
            placeBlock();
        } else if (e.button === 2) {
            // Right click: break block
            breakBlock();
        }
    });
    // Prevent context menu on right click
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    console.log('Canvas contextmenu prevented');
    // Camera controls
    window.addEventListener('keydown', (e) => {
        console.log('Keydown', e.code);
        if (e.code === 'KeyW') cameraControls.forward = true;
        if (e.code === 'KeyS') cameraControls.backward = true;
        if (e.code === 'KeyA') cameraControls.left = true;
        if (e.code === 'KeyD') cameraControls.right = true;
    });
    window.addEventListener('keyup', (e) => {
        console.log('Keyup', e.code);
        if (e.code === 'KeyW') cameraControls.forward = false;
        if (e.code === 'KeyS') cameraControls.backward = false;
        if (e.code === 'KeyA') cameraControls.left = false;
        if (e.code === 'KeyD') cameraControls.right = false;
    });
    // Pointer lock for immersive camera control
    canvas.addEventListener('click', () => {
        console.log('Canvas click, pointerLock:', document.pointerLockElement === canvas);
        if (document.pointerLockElement !== canvas) {
            canvas.requestPointerLock();
        }
    });
    document.addEventListener('pointerlockchange', () => {
        console.log('Pointerlockchange', document.pointerLockElement === canvas);
        if (document.pointerLockElement === canvas) {
            // Listen for mouse movement when pointer is locked
            document.addEventListener('mousemove', onPointerLockMove);
        } else {
            document.removeEventListener('mousemove', onPointerLockMove);
        }
    });
    function onPointerLockMove(e) {
        // Debug mouse movement
        console.log('PointerLockMove', {movementX: e.movementX, movementY: e.movementY});
        cameraControls.yaw -= e.movementX * 0.005;
        cameraControls.pitch -= e.movementY * 0.005; // Flip sign so up is up
        cameraControls.pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, cameraControls.pitch));
    }
    // canvas already declared above
    console.log('setupThreeScene: initializing renderer');
    threeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    console.log('Three.js renderer initialized');
    threeRenderer.setClearColor(0x87ceeb); // Sky blue
    threeRenderer.setSize(window.innerWidth, window.innerHeight);
    console.log('setupThreeScene: creating scene');
    threeScene = new THREE.Scene();
    console.log('Three.js scene initialized');
    // Fog for depth
    threeScene.fog = new THREE.Fog(0x87ceeb, 60, 180);
    // Camera
    console.log('setupThreeScene: creating camera');
    threeCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    console.log('Three.js camera initialized');
    // Blocky world ground (chunked)
    // Start player above the ground, looking forward (after GROUND_HEIGHT is defined)
    threeCamera.position.set(0, GROUND_HEIGHT + 2, 0); // y=5, well above ground
    threeCamera.up.set(0, 1, 0);
    threeCamera.lookAt(0, GROUND_HEIGHT + 2, 10);
    console.log('setupThreeScene: camera positioned');
    // Ambient and directional light
    threeScene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sunLight = new THREE.DirectionalLight(0xfff7b2, 1.2);
    sunLight.position.set(-40, 80, 40);
    threeScene.add(sunLight);
    console.log('setupThreeScene: lights added');


    // --- Deterministic pseudo-random terrain generation ---
    function pseudoHeight(x, z) {
        // Use a combination of sin/cos for hills and valleys
        const base = Math.sin(x * 0.09) + Math.cos(z * 0.07);
        const detail = Math.sin(x * 0.23 + z * 0.17) * 0.5;
        return Math.floor(2 + 2 * base + detail); // Range: about 0..6
    }

    function getBlockType(x, y, z) {
        // --- Terrain height using deterministic pseudo-random function ---
        let height = pseudoHeight(x, z);
        // Simulate water in valleys
        const waterLevel = 1;
        // Simulate sand near water (valleys)
        const sandBand = height <= waterLevel + 1;
        // Stone at high elevations
        const isStone = height >= 5 && y === height;

        if (y < 0) return 1; // solid dirt below ground
        // Water blocks (valleys)
        if (height <= waterLevel && y <= waterLevel) return 3; // water
        // Sand around water
        if (sandBand && y === waterLevel) return 2; // sand
        // Stone on mountain tops
        if (isStone) return 4; // stone
        // Grass on top layer
        if (y === height && y > waterLevel) return 0; // grass
        // Dirt below grass/stone
        if (y < height && y >= 0) return 1; // dirt
        // Underwater dirt
        if (height <= waterLevel && y < waterLevel) return 1; // dirt under water
        // Default: air (undefined)
        return undefined;
    }

// Persistent world data: key = 'x,y,z', value = blockType index
// TODO: For large worlds, use a chunked/sparse data structure for worldBlocks and renderedBlocks
if (!window.worldBlocks) window.worldBlocks = new Map();
// Rendered block meshes: key = 'x,y,z', value = mesh
window.renderedBlocks = window.renderedBlocks || new Map();

    // Helper to get block type at (x,y,z), using persistent world data if present
    function getOrGenBlockType(x, y, z) {
        const key = `${x},${y},${z}`;
        if (window.worldBlocks.has(key)) return window.worldBlocks.get(key);
        const t = getBlockType(x, y, z);
        window.worldBlocks.set(key, t);
        return t;
    }

    // Helper to update visible chunk centered at (cx, cz)
    function updateVisibleChunk(cx, cz) {
        const newVisible = new Set();
        for (let x = cx - CHUNK_SIZE/2; x < cx + CHUNK_SIZE/2; x++) {
            for (let z = cz - CHUNK_SIZE/2; z < cz + CHUNK_SIZE/2; z++) {
                for (let y = 0; y < GROUND_HEIGHT; y++) {
                    // y=0 is ground, y=1,2 are dirt
                    const key = `${x},${y},${z}`;
                    newVisible.add(key);
                    if (!window.renderedBlocks.has(key)) {
                        const type = getOrGenBlockType(x, y, z);
                        // Only create a block if type is defined (not air)
                        if (typeof type === 'undefined') continue;
                        // Ensure worldBlocks is always up to date for adjacency logic
                        window.worldBlocks.set(key, type);
                        const mat = new THREE.MeshLambertMaterial({ color: BLOCK_TYPES[type].color });
                        // Place y=0 at ground, y>0 above
                        const block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
                        block.position.set(x, y, z);
                        block.userData.blockType = type;
                        block.userData.blockName = BLOCK_TYPES[type].name;
                        threeScene.add(block);
                        window.blockMeshes.push(block);
                        window.renderedBlocks.set(key, block);
                    }
                }
            }
        }
        // Remove blocks that are no longer visible
        for (const [key, mesh] of window.renderedBlocks.entries()) {
            if (!newVisible.has(key)) {
                threeScene.remove(mesh);
                window.renderedBlocks.delete(key);
                window.blockMeshes = window.blockMeshes.filter(b => b !== mesh);
            }
        }
    }

    // Initial chunk render centered on camera
    let lastChunkX = null, lastChunkZ = null;
    function updateChunkIfNeeded() {
        // Only run once at start; do not update chunks as player moves
        if (lastChunkX === null || lastChunkZ === null) {
            const px = Math.round(playerPos.x);
            const pz = Math.round(playerPos.z);
            const chunkX = Math.floor(px / CHUNK_SIZE) * CHUNK_SIZE;
            const chunkZ = Math.floor(pz / CHUNK_SIZE) * CHUNK_SIZE;
            updateVisibleChunk(chunkX, chunkZ);
            lastChunkX = chunkX;
            lastChunkZ = chunkZ;
        }
    }
    setTimeout(() => {
        updateChunkIfNeeded();
        console.log('setupThreeScene: initial chunk rendered');
    }, 100);
    window.updateChunkIfNeeded = updateChunkIfNeeded;

    // Clear scenery logic (removes only non-ground blocks)
    window.addEventListener('clearScenery', () => {
        console.log('Event: clearScenery');
        // Remove all blocks above ground level
        window.blockMeshes = window.blockMeshes.filter(block => {
            if (block.position.y >= GROUND_HEIGHT-2) {
                threeScene.remove(block);
                return false;
            }
            return true;
        });
    });

    // Render loop
    console.log('setupThreeScene: calling animateThreeScene');
    animateThreeScene();
    window.addEventListener('resize', onWindowResize);
    console.log('setupThreeScene: end');
}
// Butterfly creation function
// Butterfly creation function
function onWindowResize() {
    if (threeCamera) {
        threeCamera.updateProjectionMatrix();
    }
    if (threeRenderer) {
        threeRenderer.setSize(window.innerWidth, window.innerHeight);
    }
}
function animateThreeScene() {
    // Debug: log each frame
    // console.log('animateThreeScene: frame', performance.now());
    // console.log('Function: animateThreeScene', {isPaused});
    if (!isPaused) {
        requestAnimationFrame(animateThreeScene);
        // Camera movement and rendering logic should go here
        // Example camera movement (WASD + mouse)
        const speed = 0.5;
        // Calculate direction from yaw/pitch
        const euler = new THREE.Euler(cameraControls.pitch, cameraControls.yaw, 0, 'YXZ');
        const forward = new THREE.Vector3(0, 0, -1).applyEuler(euler).normalize();
        const right = new THREE.Vector3(1, 0, 0).applyEuler(euler).normalize();
        // Move player position with collision detection
        let moveVec = new THREE.Vector3();
        if (cameraControls.forward) moveVec.add(forward);
        if (cameraControls.backward) moveVec.add(forward.clone().negate());
        if (cameraControls.left) moveVec.add(right.clone().negate());
        if (cameraControls.right) moveVec.add(right);
        if (moveVec.lengthSq() > 0) {
            moveVec.normalize().multiplyScalar(speed);
            const nextPos = playerPos.clone().add(moveVec);
            // Check collision: only move if no block at intended position (rounded to int)
            const checkKey = `${Math.round(nextPos.x)},${Math.round(nextPos.y)},${Math.round(nextPos.z)}`;
            if (!window.worldBlocks || !window.worldBlocks.has(checkKey)) {
                if (nextPos.y >= 0) {
                    playerPos.copy(nextPos);
                }
            } else {
                // Optionally, allow sliding up if block is at feet but space above is empty (simple step-up)
                const aboveKey = `${Math.round(nextPos.x)},${Math.round(nextPos.y)+1},${Math.round(nextPos.z)}`;
                if (!window.worldBlocks.has(aboveKey) && nextPos.y >= 0) {
                    playerPos.set(nextPos.x, nextPos.y+1, nextPos.z);
                }
            }
        }
        if (playerPos.y < 0) playerPos.y = 0;
        // Camera follows player at a fixed offset (first-person)
        threeCamera.position.copy(playerPos);
        threeCamera.up.set(0, 1, 0);
        threeCamera.quaternion.setFromEuler(euler);
        // Update chunk if player moved to a new chunk
        if (window.updateChunkIfNeeded) window.updateChunkIfNeeded();
        // Update block placement outline
        updatePlacementOutline();
        threeRenderer.render(threeScene, threeCamera);
        // Debug: confirm render
        // console.log('animateThreeScene: rendered frame');
    } else {
        // If paused, don't animate, but keep rendering current frame
        threeRenderer.render(threeScene, threeCamera);
    }
}

// Block placement logic
function placeBlock() {
    console.log('Function: placeBlock');
    // Raycast from camera, offset origin slightly forward to avoid self-intersection
    const camDir = getCameraDirection();
    const rayOrigin = playerPos.clone().add(camDir.clone().multiplyScalar(0.1));
    const raycaster = new THREE.Raycaster();
    raycaster.set(rayOrigin, camDir);
    const intersects = raycaster.intersectObjects(window.blockMeshes, false);
    let pos;
    let valid = false;
    if (intersects.length > 0) {
        // Place block adjacent to the face of the hit block
        const hit = intersects[0];
        if (hit.face) {
            const normal = hit.face.normal;
            pos = hit.point.clone().add(normal); // Only add normal ONCE
            pos.x = Math.round(pos.x);
            pos.y = Math.round(pos.y);
            pos.z = Math.round(pos.z);
            // Allow placement if neighbor exists OR block below exists (for building up)
            const neighborKey = `${pos.x - normal.x},${pos.y - normal.y},${pos.z - normal.z}`;
            const belowKey = `${pos.x},${pos.y - 1},${pos.z}`;
            if (window.worldBlocks.has(neighborKey) || window.worldBlocks.has(belowKey)) {
                valid = true;
            }
        }
    } else {
        // Place block in front of player only if there is a block below
        pos = playerPos.clone().add(camDir.clone().multiplyScalar(5));
        pos.x = Math.round(pos.x);
        pos.y = Math.round(pos.y);
        pos.z = Math.round(pos.z);
        const belowKey = `${pos.x},${pos.y - 1},${pos.z}`;
        if (window.worldBlocks.has(belowKey)) {
            valid = true;
        }
    }
    if (!pos) return;
    console.log('[placeBlock] Target position:', pos.x, pos.y, pos.z, 'Valid:', valid);
    // Don't place inside ground
    if (pos.y < 0 || !valid) {
        console.log('[placeBlock] Invalid placement (below ground or not adjacent to block).');
        return;
    }
    // Create block of selected type
    const type = selectedBlockType;
    const key = `${pos.x},${pos.y},${pos.z}`;
    // Update persistent world data
    window.worldBlocks.set(key, type);
    // If block is in visible chunk, add mesh immediately
    const px = Math.round(playerPos.x);
    const pz = Math.round(playerPos.z);
    const chunkX = Math.floor(px / 64) * 64;
    const chunkZ = Math.floor(pz / 64) * 64;
    if (
        pos.x >= chunkX - 32 && pos.x < chunkX + 32 &&
        pos.z >= chunkZ - 32 && pos.z < chunkZ + 32 &&
        pos.y >= 0
    ) {
        // Only add mesh if not already present
        const exists = window.blockMeshes.some(b => b.position.x === pos.x && b.position.y === pos.y && b.position.z === pos.z);
        console.log('[placeBlock] Block exists at position?', exists);
        if (!exists) {
            const mat = new THREE.MeshLambertMaterial({ color: BLOCK_TYPES[type].color });
            const block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
            block.position.set(pos.x, pos.y, pos.z);
            let moveVec = new THREE.Vector3();
            if (cameraControls.forward) moveVec.add(forward);
            if (cameraControls.backward) moveVec.add(forward.clone().negate());
            if (cameraControls.left) moveVec.add(right.clone().negate());
            if (cameraControls.right) moveVec.add(right);
            if (moveVec.lengthSq() > 0) {
                moveVec.normalize().multiplyScalar(speed);
                const nextPos = playerPos.clone();
                nextPos.x += moveVec.x;
                nextPos.z += moveVec.z;
                // Find the highest solid block at the intended (x,z)
                let highestY = -1;
                for (let y = 40; y >= 0; y--) {
                    const key = `${Math.round(nextPos.x)},${y},${Math.round(nextPos.z)}`;
                    if (window.worldBlocks && window.worldBlocks.has(key)) {
                        highestY = y;
                        break;
                    }
                }
                // Only move if the space above the highest block is empty
                const aboveKey = `${Math.round(nextPos.x)},${highestY+1},${Math.round(nextPos.z)}`;
                if (!window.worldBlocks.has(aboveKey)) {
                    playerPos.x = nextPos.x;
                    playerPos.z = nextPos.z;
                    // Snap player to stand on top of the highest block
                    playerPos.y = highestY + 1;
                }
            }
        }
    }
} // <-- Add this closing brace to properly end placeBlock

function breakBlock() {
    // ...existing code...
}

// Block type selection (1-5 keys)
window.addEventListener('keydown', (e) => {
    let changed = false;
    if (e.code.startsWith('Digit')) {
        const idx = parseInt(e.code.replace('Digit','')) - 1;
        if (idx >= 0 && idx < BLOCK_TYPES.length) {
            selectedBlockType = idx;
            changed = true;
        }
    }
    // Mouse wheel for block selection
    if (e.type === 'wheel') {
        if (e.deltaY < 0) {
            selectedBlockType = (selectedBlockType - 1 + BLOCK_TYPES.length) % BLOCK_TYPES.length;
            changed = true;
        } else if (e.deltaY > 0) {
            selectedBlockType = (selectedBlockType + 1) % BLOCK_TYPES.length;
            changed = true;
        }
    }
    if (changed) {
        updateBlockSelectorUI();
        console.log('Selected block type:', BLOCK_TYPES[selectedBlockType].name);
    }
});
// Mouse wheel for block selection
window.addEventListener('wheel', (e) => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (e.deltaY < 0) {
        selectedBlockType = (selectedBlockType - 1 + BLOCK_TYPES.length) % BLOCK_TYPES.length;
    } else if (e.deltaY > 0) {
        selectedBlockType = (selectedBlockType + 1) % BLOCK_TYPES.length;
    }
    updateBlockSelectorUI();
    e.preventDefault();
}, { passive: false });

// Update UI on load
function startGameInit() {
    console.log('startGameInit called');
    updateBlockSelectorUI();
    console.log('Block selector UI updated');
    setupThreeScene();
    console.log('Three.js scene setup called');
    if (!isPaused) {
        console.log('Starting animation loop');
        requestAnimationFrame(animateThreeScene);
    }
}
if (document.readyState === 'loading') {
    console.log('Waiting for DOMContentLoaded');
    window.addEventListener('DOMContentLoaded', startGameInit);
} else {
    console.log('DOM already loaded, starting game init');
    startGameInit();
}
console.log('Game initialization triggered');
// Listen for pause state from index.html
window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
        isPaused = !isPaused;
        if (!isPaused) {
            requestAnimationFrame(animateThreeScene);
        }
    }
});