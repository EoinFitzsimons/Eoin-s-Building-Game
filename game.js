import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';

// Global constants for world size and chunking
const GROUND_SIZE = 64;
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
    lastY: 0,
    jumping: false,
    jumpVelocity: 0,
    onGround: true
};

// Player position in world
// Helper to get the camera's forward direction as a normalized THREE.Vector3
function getCameraDirection() {
    if (!threeCamera) return new THREE.Vector3(0, 0, -1);
    const direction = new THREE.Vector3();
    threeCamera.getWorldDirection(direction);
    return direction.normalize();
}
// Helper to find highest solid block at (x, z)
function getHighestSolidY(x, z) {
    for (let y = 40; y >= 0; y--) {
        const key = `${Math.round(x)},${y},${Math.round(z)}`;
        if (window.worldBlocks && window.worldBlocks.has(key)) {
            return y;
        }
    }
    return GROUND_HEIGHT; // Default to ground if no block found
}

// Set player on top of ground or highest block at (0,0)
// Player is 1.8 blocks tall, so set Y to highest block + 1.8
let playerPos = new THREE.Vector3(0, getHighestSolidY(0, 0) + 1.8, 0);

// Block types and textures
// Add more block types and textures
const BLOCK_TYPES = [
    { name: 'grass', color: 0x4caf50 },
    { name: 'dirt', color: 0x8d5524 },
    { name: 'sand', color: 0xffe082 },
    { name: 'water', color: 0x4fc3f7 },
    { name: 'stone', color: 0x888888 },
    { name: 'wood', color: 0xdeb887 },
    { name: 'leaves', color: 0x228b22 },
    { name: 'brick', color: 0xb22222 },
    { name: 'glass', color: 0x87ceeb },
    { name: 'planks', color: 0xf5deb3 }
];
let selectedBlockType = 0; // index into BLOCK_TYPES

function updateBlockSelectorUI() {
    const bar = document.getElementById('block-bar');
    if (!bar) return;
    // Clear bar
    bar.innerHTML = '';
    BLOCK_TYPES.forEach((block, idx) => {
        const item = document.createElement('div');
        item.className = 'block-bar-item' + (idx === selectedBlockType ? ' selected' : '');
        item.title = block.name;
        item.style.background = `#${block.color.toString(16).padStart(6, '0')}`;
        // Add label
        const label = document.createElement('span');
        label.className = 'block-label';
        label.textContent = block.name;
        item.appendChild(label);
        bar.appendChild(item);
    });
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
            // Place block directly adjacent to the face, no gap
            const hitPos = hit.object.position;
            console.log('[placeBlock] Hit face normal:', normal.x, normal.y, normal.z);
            pos = new THREE.Vector3(
                Math.round(hitPos.x + normal.x),
                Math.round(hitPos.y + normal.y),
                Math.round(hitPos.z + normal.z)
            );
            // Check adjacency
            const neighborKey = `${pos.x - normal.x},${pos.y - normal.y},${pos.z - normal.z}`;
            const belowKey = `${pos.x},${pos.y - 1},${pos.z}`;
            if (!window.worldBlocks.has(neighborKey) && !window.worldBlocks.has(belowKey)) {
                // If not adjacent, show outline on top of highest block at (x, z)
                let highestY = -1;
                for (let y = 40; y >= 0; y--) {
                    const key = `${pos.x},${y},${pos.z}`;
                    if (window.worldBlocks.has(key)) {
                        highestY = y;
                        break;
                    }
                }
                pos.y = highestY + 1;
            }
        } else {
            pos = hit.point.clone();
            pos.x = Math.round(pos.x);
            pos.y = Math.round(pos.y);
            pos.z = Math.round(pos.z);
        }
    } else {
        // In front of camera
        const tempPos = threeCamera.position.clone().add(getCameraDirection().multiplyScalar(5));
        const targetX = Math.round(tempPos.x);
        const targetZ = Math.round(tempPos.z);
        // Find the highest block at (x, z)
        let highestY = -1;
        for (let y = 40; y >= 0; y--) {
            const key = `${targetX},${y},${targetZ}`;
            if (window.worldBlocks.has(key)) {
                highestY = y;
                break;
            }
        }
        pos = new THREE.Vector3(targetX, highestY + 1, targetZ);
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
    // Block interaction (place/break) - ensure listeners are only attached once
    if (!canvas._blockListenersAttached) {
        canvas.addEventListener('mousedown', (e) => {
            // Only handle if pointer lock is active
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
        canvas._blockListenersAttached = true;
        console.log('Canvas block listeners attached and contextmenu prevented');
    }
    // Camera controls
    window.addEventListener('keydown', (e) => {
    console.log('Keydown', e.code);
    if (e.code === 'KeyW') cameraControls.forward = true;
    if (e.code === 'KeyS') cameraControls.backward = true;
    if (e.code === 'KeyA') cameraControls.left = true;
    if (e.code === 'KeyD') cameraControls.right = true;
    if (e.code === 'Space' && cameraControls.onGround) {
        cameraControls.jumping = true;
        cameraControls.jumpVelocity = 0.18; // Jump velocity for 1 block high
        cameraControls.onGround = false;
    }
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
        for (let x = cx - GROUND_SIZE/2; x < cx + GROUND_SIZE/2; x++) {
            for (let z = cz - GROUND_SIZE/2; z < cz + GROUND_SIZE/2; z++) {
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
            const chunkX = Math.floor(px / GROUND_SIZE) * GROUND_SIZE;
            const chunkZ = Math.floor(pz / GROUND_SIZE) * GROUND_SIZE;
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
        const speed = 4; // restore to 4 blocks per second
        // Frame timing for smooth movement
        if (!animateThreeScene.lastTime) animateThreeScene.lastTime = performance.now();
        const now = performance.now();
        const deltaTime = (now - animateThreeScene.lastTime) / 1000;
        animateThreeScene.lastTime = now;
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
        // Horizontal movement collision
        if (moveVec.lengthSq() > 0) {
            moveVec.normalize().multiplyScalar(speed * deltaTime);
            const nextXZ = playerPos.clone().add(new THREE.Vector3(moveVec.x, 0, moveVec.z));
            // Check if space at player's feet and head is empty AND block is visible
            const footKey = `${Math.round(nextXZ.x)},${Math.floor(playerPos.y - 1.8)},${Math.round(nextXZ.z)}`;
            const headKey = `${Math.round(nextXZ.x)},${Math.floor(playerPos.y)},${Math.round(nextXZ.z)}`;
            const footBlock = window.renderedBlocks.get(footKey);
            const headBlock = window.renderedBlocks.get(headKey);
            const footVisible = footBlock && footBlock.visible !== false;
            const headVisible = headBlock && headBlock.visible !== false;
            if (!footVisible && !headVisible) {
                playerPos.x = nextXZ.x;
                playerPos.z = nextXZ.z;
            }
        }
        // Jumping and gravity
        if (cameraControls.jumping) {
            playerPos.y += cameraControls.jumpVelocity;
            cameraControls.jumpVelocity -= 0.02; // gravity
            // Check collision above
            const aboveKey = `${Math.round(playerPos.x)},${Math.floor(playerPos.y)},${Math.round(playerPos.z)}`;
            const aboveBlock = window.renderedBlocks.get(aboveKey);
            const aboveVisible = aboveBlock && aboveBlock.visible !== false;
            if (aboveVisible && cameraControls.jumpVelocity > 0) {
                // Hit ceiling
                playerPos.y = Math.floor(playerPos.y);
                cameraControls.jumping = false;
                cameraControls.jumpVelocity = 0;
            }
            // Land on ground or block (allow small tolerance)
            const belowKey = `${Math.round(playerPos.x)},${Math.floor(playerPos.y - 1.8 + 0.1)},${Math.round(playerPos.z)}`;
            const belowBlock = window.renderedBlocks.get(belowKey);
            const belowVisible = belowBlock && belowBlock.visible !== false;
            if (belowVisible && cameraControls.jumpVelocity <= 0) {
                playerPos.y = Math.floor(playerPos.y);
                cameraControls.jumping = false;
                cameraControls.jumpVelocity = 0;
                cameraControls.onGround = true;
            }
        } else {
            // Gravity when not jumping
            const belowKey = `${Math.round(playerPos.x)},${Math.floor(playerPos.y - 1.8 + 0.1)},${Math.round(playerPos.z)}`;
            const belowBlock = window.renderedBlocks.get(belowKey);
            const belowVisible = belowBlock && belowBlock.visible !== false;
            if (!belowVisible) {
                playerPos.y -= 0.08; // gravity
                cameraControls.onGround = false;
            } else {
                cameraControls.onGround = true;
            }
        }
        // Prevent player from going below ground
        if (playerPos.y < GROUND_HEIGHT + 1.8) playerPos.y = GROUND_HEIGHT + 1.8;
        // Camera follows player at correct height (first-person)
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
            const hitPos = hit.object.position;
            pos = new THREE.Vector3(
                Math.round(hitPos.x + normal.x),
                Math.round(hitPos.y + normal.y),
                Math.round(hitPos.z + normal.z)
            );
            // Only allow placement if the target position is empty
            const targetKey = `${pos.x},${pos.y},${pos.z}`;
            if (!window.worldBlocks.has(targetKey)) {
                valid = true;
            }
        }
    }
    // If not valid, try placing on top of the highest block at (x, z)
    if (!valid) {
        // Use the intended x, z from raycast or player direction
        let targetX, targetZ;
        if (pos) {
            targetX = pos.x;
            targetZ = pos.z;
        } else {
            const tempPos = playerPos.clone().add(camDir.clone().multiplyScalar(5));
            targetX = Math.round(tempPos.x);
            targetZ = Math.round(tempPos.z);
        }
        // Find the highest block at (x, z)
        let highestY = -1;
        for (let y = 40; y >= 0; y--) {
            const key = `${targetX},${y},${targetZ}`;
            if (window.worldBlocks.has(key)) {
                highestY = y;
                break;
            }
        }
        pos = new THREE.Vector3(targetX, highestY + 1, targetZ);
        // Allow placement if block below exists (ground or any block)
        const belowKey = `${pos.x},${pos.y - 1},${pos.z}`;
        if (window.worldBlocks.has(belowKey)) {
            valid = true;
        }
    }
    if (!pos) return;
    console.log('[placeBlock] Target position:', pos.x, pos.y, pos.z, 'Valid:', valid);
    // Don't place below ground level
    if (pos.y < 0) {
        console.log('[placeBlock] Invalid placement (below ground).');
        return;
    }
    if (!valid) {
        console.log('[placeBlock] Invalid placement (not adjacent to block or ground).');
        return;
    }
    // Create block of selected type
    const type = selectedBlockType;
    const key = `${pos.x},${pos.y},${pos.z}`;
    // Update persistent world data
    window.worldBlocks.set(key, type);
    // Always add mesh for placed blocks, regardless of chunk
    const exists = window.blockMeshes.some(b => b.position.x === pos.x && b.position.y === pos.y && b.position.z === pos.z);
    console.log('[placeBlock] Block exists at position?', exists);
    if (!exists) {
        const blockTypeObj = BLOCK_TYPES[type];
        let mat = new THREE.MeshLambertMaterial({ color: blockTypeObj.color });
        // Add transparency for glass, leaves, water
        if (blockTypeObj.name === 'glass') {
            mat.transparent = true;
            mat.opacity = 0.5;
        }
        if (blockTypeObj.name === 'leaves') {
            mat.transparent = true;
            mat.opacity = 0.7;
        }
        if (blockTypeObj.name === 'water') {
            mat.transparent = true;
            mat.opacity = 0.6;
        }
        const block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
        block.position.set(pos.x, pos.y, pos.z);
        block.userData.blockType = type;
        block.userData.blockName = blockTypeObj.name;
        threeScene.add(block);
        window.blockMeshes.push(block);
        window.renderedBlocks.set(key, block);
    }
} // <-- Add this closing brace to properly end placeBlock

function breakBlock() {
    // Raycast from camera to find block to break
    const camDir = getCameraDirection();
    const rayOrigin = playerPos.clone().add(camDir.clone().multiplyScalar(0.1));
    const raycaster = new THREE.Raycaster();
    raycaster.set(rayOrigin, camDir);
    const intersects = raycaster.intersectObjects(window.blockMeshes, false);
    if (intersects.length > 0) {
        const hit = intersects[0];
        const block = hit.object;
        const pos = block.position;
        const key = `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}`;
        // Remove from scene
        threeScene.remove(block);
        // Remove from blockMeshes
        window.blockMeshes = window.blockMeshes.filter(b => b !== block);
        // Remove from renderedBlocks
        window.renderedBlocks.delete(key);
        // Remove from worldBlocks
        window.worldBlocks.delete(key);
    }
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
        const pauseMenu = document.getElementById('pause-menu');
        if (isPaused) {
            if (pauseMenu) pauseMenu.style.display = 'flex';
        } else {
            if (pauseMenu) pauseMenu.style.display = 'none';
            requestAnimationFrame(animateThreeScene);
        }
    }
});

// Wire up pause menu buttons to their functions
window.addEventListener('DOMContentLoaded', () => {
    const resetBtn = document.getElementById('reset-world');
    const optionsBtn = document.getElementById('options-menu');
    const exportBtn = document.getElementById('export-world');
    const importBtn = document.getElementById('import-world');
    const resumeBtn = document.getElementById('resume-game');
    if (resetBtn) {
        resetBtn.onclick = () => {
            window.dispatchEvent(new Event('resetWorld'));
            document.getElementById('pause-menu').style.display = 'none';
            isPaused = false;
            requestAnimationFrame(animateThreeScene);
        };
    }
    if (optionsBtn) {
        optionsBtn.onclick = () => {
            document.getElementById('options-modal').style.display = 'flex';
        };
    }
    if (exportBtn) {
        exportBtn.onclick = () => {
            window.dispatchEvent(new Event('exportWorld'));
        };
    }
    if (importBtn) {
        importBtn.onclick = () => {
            window.dispatchEvent(new Event('importWorld'));
        };
    }
    if (resumeBtn) {
        resumeBtn.onclick = () => {
            document.getElementById('pause-menu').style.display = 'none';
            isPaused = false;
            requestAnimationFrame(animateThreeScene);
        };
    }
    // Options modal close button
    const closeOptionsBtn = document.getElementById('close-options');
    if (closeOptionsBtn) {
        closeOptionsBtn.onclick = () => {
            document.getElementById('options-modal').style.display = 'none';
        };
    }
    // Clear scenery button
    const clearSceneryBtn = document.getElementById('clear-scenery');
    if (clearSceneryBtn) {
        clearSceneryBtn.onclick = () => {
            window.dispatchEvent(new Event('clearScenery'));
            document.getElementById('options-modal').style.display = 'none';
        };
    }
});