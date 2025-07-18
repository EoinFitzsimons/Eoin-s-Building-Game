// game.js - Three.js ES module game logic
// Pause menu/game state
// Scenery objects for clearing
let sceneryMeshes = [];
console.log('Game script loaded');
let isPaused = false;
window.addEventListener('resetWorld', () => {
    console.log('Event: resetWorld');
    // Remove all blocks
    if (window.blockMeshes) {
        for (const block of window.blockMeshes) {
            if (threeScene && block) threeScene.remove(block);
        }
        window.blockMeshes = [];
    }
    // Optionally reset camera position
    if (threeCamera) {
        threeCamera.position.set(0, 18, 60);
        cameraControls.yaw = 0;
        cameraControls.pitch = 0;
    }
});

window.addEventListener('exportWorld', () => {
    console.log('Event: exportWorld');
    // Export block positions as JSON
    if (!window.blockMeshes) return;
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
                if (window.blockMeshes) {
                    for (const block of window.blockMeshes) {
                        if (threeScene && block) threeScene.remove(block);
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
                    threeScene.add(block);
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
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';

// Three.js 3D Forest Scene Setup
let threeScene, threeCamera, threeRenderer;
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

// Show bounding edges on block hover for placement
let lastHoveredBlock = null;
function showBlockEdges() {
    console.log('Function: showBlockEdges');
    if (!window.blockMeshes || !threeCamera) return;
    // Raycast from camera
    const raycaster = new THREE.Raycaster();
    raycaster.set(threeCamera.position, getCameraDirection());
    const intersects = raycaster.intersectObjects(window.blockMeshes, false);
    if (lastHoveredBlock && lastHoveredBlock.userData.edgeHelper) {
        lastHoveredBlock.userData.edgeHelper.visible = false;
    }
    if (intersects.length > 0) {
        const block = intersects[0].object;
        if (block.userData.edgeHelper) {
            block.userData.edgeHelper.visible = true;
            lastHoveredBlock = block;
        }
    } else {
        lastHoveredBlock = null;
    }
}
let animatedObjects = [];
function setupThreeScene() {
    console.log('Function: setupThreeScene');
    let canvas = document.getElementById('three-canvas');
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
        cameraControls.pitch -= e.movementY * 0.005;
        cameraControls.pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, cameraControls.pitch));
    }
    // canvas already declared above
    threeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    console.log('Three.js renderer initialized');
    threeRenderer.setClearColor(0x87ceeb); // Sky blue
    threeRenderer.setSize(window.innerWidth, window.innerHeight);
    threeScene = new THREE.Scene();
    console.log('Three.js scene initialized');
    // Fog for depth
    threeScene.fog = new THREE.Fog(0x87ceeb, 60, 180);
    // Camera
    threeCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    console.log('Three.js camera initialized');
    threeCamera.position.set(0, 18, 60);
    threeCamera.lookAt(0, 0, 0);
    // Ambient and directional light
    threeScene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sunLight = new THREE.DirectionalLight(0xfff7b2, 1.2);
    sunLight.position.set(-40, 80, 40);
    threeScene.add(sunLight);
    // Ground
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x228b22 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    threeScene.add(ground);
    // River
    const riverGeometry = new THREE.PlaneGeometry(60, 10);
    const riverMaterial = new THREE.MeshPhongMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.8 });
    const river = new THREE.Mesh(riverGeometry, riverMaterial);
    river.rotation.x = -Math.PI / 2;
    river.position.set(0, -1.8, -20);
    threeScene.add(river);
    // (No path or cartoon guy in sandbox mode)
    // Trees (random positions)
    for (let i = 0; i < 30; i++) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 7, 8), new THREE.MeshPhongMaterial({ color: 0x8d5524 }));
        const leaves = new THREE.Mesh(new THREE.SphereGeometry(2.5 + Math.random(), 16, 16), new THREE.MeshPhongMaterial({ color: 0x228b22 }));
        const x = Math.random() * 180 - 90;
        const z = Math.random() * 180 - 90;
        trunk.position.set(x, 2.5, z);
        leaves.position.set(x, 7, z);
        threeScene.add(trunk);
        threeScene.add(leaves);
        sceneryMeshes.push(trunk, leaves);
        console.log('Tree created', {x, z});
    }
    // Animated butterflies
    for (let i = 0; i < 10; i++) {
        const butterfly = createButterfly();
        butterfly.userData = { t: Math.random() * Math.PI * 2, speed: 0.01 + Math.random() * 0.02 };
        butterfly.position.set(Math.random() * 80 - 40, 6 + Math.random() * 8, Math.random() * 80 - 40);
        threeScene.add(butterfly);
        animatedObjects.push(butterfly);
        sceneryMeshes.push(butterfly);
        console.log('Butterfly created', butterfly.position);
    }
    // Sun
    const sun = new THREE.Mesh(new THREE.SphereGeometry(8, 32, 32), new THREE.MeshBasicMaterial({ color: 0xfff7b2 }));
    console.log('Sun created');
    sun.position.set(-60, 80, 0);
    threeScene.add(sun);
    sceneryMeshes.push(sun);
// Clear scenery logic
    sceneryMeshes.push(sun);

    // Clear scenery logic
    window.addEventListener('clearScenery', () => {
    console.log('Event: clearScenery');
        for (const mesh of sceneryMeshes) {
            if (threeScene && mesh) threeScene.remove(mesh);
        }
        sceneryMeshes = [];
    });

    // Pixelate world logic
    window.addEventListener('pixelateWorld', () => {
    console.log('Event: pixelateWorld');
        // Make blocks pixelated and add bounding edges
        if (window.blockMeshes) {
            for (const block of window.blockMeshes) {
                // Change material to pixelated look
                block.material = new THREE.MeshBasicMaterial({ color: 0xc2b280, wireframe: false });
                block.material.needsUpdate = true;
                // Add bounding box helper if not present
                if (!block.userData.edgeHelper) {
                    const boxHelper = new THREE.BoxHelper(block, 0xff0000);
                    boxHelper.visible = false;
                    threeScene.add(boxHelper);
                    block.userData.edgeHelper = boxHelper;
                }
            }
        }
    });

    // ...existing code...

    // Render loop
    animateThreeScene();
    window.addEventListener('resize', onWindowResize);
}
// Butterfly creation function
function createButterfly() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 1.2, 8), new THREE.MeshPhongMaterial({ color: 0x333 }));
    group.add(body);
    const wingMaterial = new THREE.MeshPhongMaterial({ color: 0xff69b4, transparent: true, opacity: 0.7 });
    const leftWing = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), wingMaterial);
    leftWing.position.set(-0.5, 0.3, 0);
    group.add(leftWing);
    const rightWing = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), wingMaterial);
    rightWing.position.set(0.5, 0.3, 0);
    group.add(rightWing);
    return group;
}
function onWindowResize() {
    if (threeCamera) {
        threeCamera.aspect = window.innerWidth / window.innerHeight;
        threeCamera.updateProjectionMatrix();
    }
    if (threeRenderer) {
        threeRenderer.setSize(window.innerWidth, window.innerHeight);
    }
}

function animateThreeScene() {
    console.log('Function: animateThreeScene', {isPaused});
    if (!isPaused) {
        requestAnimationFrame(animateThreeScene);
        // Camera movement and rendering logic should go here
        // Example camera movement (WASD + mouse)
        const speed = 0.5;
        let dir = new THREE.Vector3();
        threeCamera.getWorldDirection(dir);
        dir.y = 0;
        dir.normalize();
        let right = new THREE.Vector3();
        right.crossVectors(threeCamera.up, dir).normalize();
        if (cameraControls.forward) {
            threeCamera.position.addScaledVector(dir, speed);
        }
        if (cameraControls.backward) {
            threeCamera.position.addScaledVector(dir, -speed);
        }
        if (cameraControls.left) {
            threeCamera.position.addScaledVector(right, speed);
        }
        if (cameraControls.right) {
            threeCamera.position.addScaledVector(right, -speed);
        }
        // Apply yaw/pitch rotation
        threeCamera.rotation.order = 'YXZ';
        threeCamera.rotation.y = cameraControls.yaw;
        threeCamera.rotation.x = cameraControls.pitch;
        // Show bounding edges on block hover
        showBlockEdges();
        threeRenderer.render(threeScene, threeCamera);
    } else {
        // If paused, don't animate, but keep rendering current frame
        threeRenderer.render(threeScene, threeCamera);
    }
}

// Block placement logic
function placeBlock() {
    console.log('Function: placeBlock');
    // Raycast from camera
    const raycaster = new THREE.Raycaster();
    raycaster.set(threeCamera.position, getCameraDirection());
    const intersects = raycaster.intersectObjects(window.blockMeshes, false);
    let pos;
    if (intersects.length > 0) {
        // Place block on top of the hit block
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
        // Place block in front of camera
        pos = threeCamera.position.clone().add(getCameraDirection().multiplyScalar(5));
        pos.x = Math.round(pos.x);
        pos.y = Math.round(pos.y);
        pos.z = Math.round(pos.z);
    }
    // Don't place inside ground
    if (pos.y < 0) return;
    // Create block
    const block = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshLambertMaterial({ color: 0xc2b280 })
    );
    block.position.copy(pos);
    threeScene.add(block);
    window.blockMeshes.push(block);
}

// Block breaking logic
function breakBlock() {
    console.log('Function: breakBlock');
    const raycaster = new THREE.Raycaster();
    raycaster.set(threeCamera.position, getCameraDirection());
    const intersects = raycaster.intersectObjects(window.blockMeshes, false);
    if (intersects.length > 0) {
        const block = intersects[0].object;
        threeScene.remove(block);
        window.blockMeshes = window.blockMeshes.filter(b => b !== block);
    }
}

function getCameraDirection() {
    console.log('Function: getCameraDirection');
    if (!threeCamera) return new THREE.Vector3(0, 0, -1);
    const dir = new THREE.Vector3();
    threeCamera.getWorldDirection(dir);
    return dir;
}

// Initialize the 3D scene when the page loads
window.addEventListener('DOMContentLoaded', setupThreeScene);
console.log('Event: DOMContentLoaded listener added');
// Listen for pause state from index.html
window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
        isPaused = !isPaused;
        if (!isPaused) {
            requestAnimationFrame(animateThreeScene);
        }
    }
});
