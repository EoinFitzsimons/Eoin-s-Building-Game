// Night creatures for Survival mode. Meshes are assembled from boxes in code and the
// behaviour is deliberately simple: brutes plod straight at you, lungers stalk and pounce.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';

export const ENEMY_TYPES = {
    brute: {
        name: 'Brute', hp: 14, speed: 2.3, damage: 3, reach: 2.0, attackCooldown: 1.5,
        width: 0.9, height: 1.9, knockback: 7,
        drops: [{ item: 'raw_meat', min: 1, max: 2 }, { item: 'block:4', min: 0, max: 2 }]
    },
    lunger: {
        name: 'Lunger', hp: 7, speed: 4.4, damage: 2, reach: 1.5, attackCooldown: 1.1,
        width: 0.7, height: 0.9, knockback: 5,
        drops: [{ item: 'raw_meat', min: 1, max: 1 }, { item: 'berries', min: 0, max: 2 }]
    }
};

const GRAVITY = 28;

function box(w, h, d, colour, emissive = 0x000000) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: colour, emissive }));
    return mesh;
}

function eye(colour, size = 0.12) {
    return new THREE.Mesh(new THREE.BoxGeometry(size, size, 0.05), new THREE.MeshBasicMaterial({ color: colour }));
}

function buildBrute() {
    const g = new THREE.Group();
    const skin = 0x3c5a3a, dark = 0x2a3f2a;
    const torso = box(0.9, 0.85, 0.6, skin); torso.position.y = 1.15; g.add(torso);
    const head = box(0.6, 0.5, 0.6, dark); head.position.y = 1.85; g.add(head);
    const jaw = box(0.62, 0.14, 0.4, 0x6a5a3a); jaw.position.set(0, 1.64, 0.14); g.add(jaw);
    const eyeL = eye(0xff5a2a), eyeR = eye(0xff5a2a);
    eyeL.position.set(-0.16, 1.9, 0.31); eyeR.position.set(0.16, 1.9, 0.31); g.add(eyeL, eyeR);
    const armL = box(0.3, 0.9, 0.3, skin), armR = box(0.3, 0.9, 0.3, skin);
    armL.geometry.translate(0, -0.4, 0); armR.geometry.translate(0, -0.4, 0);
    armL.position.set(-0.62, 1.5, 0); armR.position.set(0.62, 1.5, 0); g.add(armL, armR);
    const legL = box(0.34, 0.75, 0.36, dark), legR = box(0.34, 0.75, 0.36, dark);
    legL.geometry.translate(0, -0.37, 0); legR.geometry.translate(0, -0.37, 0);
    legL.position.set(-0.24, 0.74, 0); legR.position.set(0.24, 0.74, 0); g.add(legL, legR);
    return { group: g, parts: { armL, armR, legL, legR, head }, tint: [torso, head, armL, armR, legL, legR] };
}

function buildLunger() {
    const g = new THREE.Group();
    const skin = 0x4a2c5e, pale = 0x7a4a8a;
    const body = box(0.55, 0.42, 0.95, skin); body.position.y = 0.5; g.add(body);
    const head = box(0.42, 0.36, 0.4, pale); head.position.set(0, 0.62, 0.6); g.add(head);
    const eyeL = eye(0xaaff55, 0.1), eyeR = eye(0xaaff55, 0.1);
    eyeL.position.set(-0.12, 0.68, 0.81); eyeR.position.set(0.12, 0.68, 0.81); g.add(eyeL, eyeR);
    const tail = box(0.14, 0.14, 0.6, pale); tail.position.set(0, 0.6, -0.72); g.add(tail);
    const legs = [];
    for (const [x, z] of [[-0.26, 0.3], [0.26, 0.3], [-0.26, -0.3], [0.26, -0.3]]) {
        const leg = box(0.14, 0.36, 0.14, skin);
        leg.geometry.translate(0, -0.18, 0);
        leg.position.set(x, 0.36, z);
        g.add(leg); legs.push(leg);
    }
    return { group: g, parts: { legs, head, tail }, tint: [body, head, tail, ...legs] };
}

export function createEnemy(type, x, y, z) {
    const def = ENEMY_TYPES[type];
    const built = type === 'brute' ? buildBrute() : buildLunger();
    built.group.position.set(x, y, z);
    return {
        type, def,
        pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(),
        hp: def.hp, yaw: 0, onGround: false,
        cooldown: 1 + Math.random(), state: 'chase', stateTimer: 0, phase: Math.random() * 6,
        hurtTimer: 0, burning: false, age: 0,
        group: built.group, parts: built.parts, tint: built.tint
    };
}

export function enemyBox(enemy, pos = enemy.pos) {
    const hw = enemy.def.width / 2;
    return { minX: pos.x - hw, maxX: pos.x + hw, minY: pos.y, maxY: pos.y + enemy.def.height, minZ: pos.z - hw, maxZ: pos.z + hw };
}

// Axis-by-axis movement with sliding, mirroring the player's collision code.
function moveAxis(enemy, axis, amount, hitsSolid) {
    if (amount === 0) return false;
    const steps = Math.max(1, Math.ceil(Math.abs(amount) / 0.5));
    const step = amount / steps;
    const hw = axis === 'y' ? 0 : enemy.def.width / 2;
    const size = axis === 'y' ? enemy.def.height : 0;
    for (let i = 0; i < steps; i++) {
        const next = enemy.pos.clone();
        next[axis] += step;
        if (!hitsSolid(enemyBox(enemy, next))) { enemy.pos.copy(next); continue; }
        if (step > 0) enemy.pos[axis] = Math.floor(next[axis] + hw + size) - hw - size - 1e-4;
        else enemy.pos[axis] = Math.ceil(next[axis] - hw) + hw + 1e-4;
        enemy.vel[axis] = 0;
        return true;
    }
    return false;
}

// Advance one enemy. `ctx` supplies the world queries and callbacks the creature needs.
//   ctx.hitsSolid(box)       -> true when the box overlaps a solid block
//   ctx.playerPos            -> THREE.Vector3 (feet position)
//   ctx.playerBox            -> the player's bounding box
//   ctx.damagePlayer(amount, enemy)
//   ctx.daylight             -> 0..1, creatures burn when it is bright
//   ctx.inLiquid(x, y, z)
export function updateEnemy(enemy, dt, ctx) {
    const def = enemy.def;
    enemy.age += dt;
    enemy.cooldown -= dt;
    enemy.hurtTimer = Math.max(0, enemy.hurtTimer - dt);
    enemy.stateTimer -= dt;

    const toPlayer = new THREE.Vector3().subVectors(ctx.playerPos, enemy.pos);
    const dist = toPlayer.length();
    const flat = new THREE.Vector3(toPlayer.x, 0, toPlayer.z);
    const flatDist = flat.length();
    if (flatDist > 1e-3) flat.divideScalar(flatDist);

    let wishX = 0, wishZ = 0, speed = def.speed;
    const inWater = ctx.inLiquid(enemy.pos.x, enemy.pos.y + 0.3, enemy.pos.z);

    if (ctx.daylight > 0.25) {
        // the sun burns night creatures away
        enemy.burning = true;
        enemy.hp -= dt * 2.5;
    }

    if (enemy.type === 'brute') {
        if (dist < 40) { wishX = flat.x; wishZ = flat.z; }
        if (flatDist < def.reach && Math.abs(toPlayer.y) < 2 && enemy.cooldown <= 0) {
            ctx.damagePlayer(def.damage, enemy);
            enemy.cooldown = def.attackCooldown;
            enemy.swing = 0.4;
        }
    } else {
        // lunger: stalk to a few blocks away, pause, then pounce
        switch (enemy.state) {
            case 'chase':
                if (flatDist > 5) { wishX = flat.x; wishZ = flat.z; }
                else if (flatDist > 3) { wishX = flat.x * 0.4 - flat.z * 0.8; wishZ = flat.z * 0.4 + flat.x * 0.8; speed *= 0.6; }
                else { speed *= 0.4; wishX = -flat.x; wishZ = -flat.z; }
                if (flatDist < 6.5 && flatDist > 2 && enemy.cooldown <= 0 && enemy.onGround) { enemy.state = 'wind'; enemy.stateTimer = 0.45; }
                break;
            case 'wind':
                if (enemy.stateTimer <= 0) {
                    enemy.state = 'lunge'; enemy.stateTimer = 0.7;
                    enemy.vel.x = flat.x * 10; enemy.vel.z = flat.z * 10; enemy.vel.y = 5.5;
                    enemy.onGround = false;
                    if (ctx.onLunge) ctx.onLunge(enemy);
                }
                break;
            case 'lunge':
                if (flatDist < def.reach && Math.abs(toPlayer.y) < 2 && enemy.cooldown <= 0) {
                    ctx.damagePlayer(def.damage, enemy);
                    enemy.cooldown = def.attackCooldown;
                }
                if (enemy.stateTimer <= 0 || (enemy.onGround && enemy.stateTimer < 0.5)) { enemy.state = 'recover'; enemy.stateTimer = 0.8; }
                break;
            default:
                if (enemy.stateTimer <= 0) enemy.state = 'chase';
        }
    }

    const accel = enemy.onGround ? 12 : 3;
    if (enemy.state !== 'lunge') {
        enemy.vel.x += (wishX * speed - enemy.vel.x) * Math.min(1, accel * dt);
        enemy.vel.z += (wishZ * speed - enemy.vel.z) * Math.min(1, accel * dt);
    }
    if (inWater) {
        enemy.vel.y += (1.5 - enemy.vel.y) * Math.min(1, 4 * dt);
    } else {
        enemy.vel.y -= GRAVITY * dt;
        enemy.vel.y = Math.max(-40, enemy.vel.y);
    }

    const blockedX = moveAxis(enemy, 'x', enemy.vel.x * dt, ctx.hitsSolid);
    const blockedZ = moveAxis(enemy, 'z', enemy.vel.z * dt, ctx.hitsSolid);
    const falling = enemy.vel.y <= 0;
    const hitY = moveAxis(enemy, 'y', enemy.vel.y * dt, ctx.hitsSolid);
    enemy.onGround = hitY && falling;
    // hop up single blocks in the way
    if ((blockedX || blockedZ) && enemy.onGround && (wishX || wishZ)) { enemy.vel.y = 8.2; enemy.onGround = false; }

    if (wishX || wishZ) enemy.yaw = Math.atan2(wishX, wishZ);
    else if (flatDist > 0.01 && dist < 40) enemy.yaw = Math.atan2(flat.x, flat.z);

    animate(enemy, dt);
    return enemy.hp > 0;
}

function animate(enemy, dt) {
    const g = enemy.group;
    g.position.copy(enemy.pos);
    g.rotation.y = enemy.yaw;
    const moving = Math.hypot(enemy.vel.x, enemy.vel.z);
    enemy.phase += dt * (2 + moving * 2.2);
    const swing = Math.sin(enemy.phase) * Math.min(1, moving / 2) * 0.7;
    if (enemy.type === 'brute') {
        const p = enemy.parts;
        p.legL.rotation.x = swing; p.legR.rotation.x = -swing;
        if (enemy.swing > 0) {
            enemy.swing -= dt;
            p.armL.rotation.x = p.armR.rotation.x = -2.2 + enemy.swing * 2;
        } else {
            p.armL.rotation.x = -swing * 0.8 - 0.2; p.armR.rotation.x = swing * 0.8 - 0.2;
        }
        p.head.rotation.y = Math.sin(enemy.age * 1.3) * 0.15;
    } else {
        const p = enemy.parts;
        p.legs.forEach((leg, i) => { leg.rotation.x = (i % 2 ? swing : -swing) * 1.2; });
        p.tail.rotation.y = Math.sin(enemy.age * 6) * 0.4;
        const crouch = enemy.state === 'wind' ? 0.75 : 1;
        g.scale.set(1, crouch, 1);
    }
    const hurt = enemy.hurtTimer > 0 ? 0.9 : 0;
    const burn = enemy.burning ? 0.5 + Math.sin(enemy.age * 20) * 0.3 : 0;
    for (const mesh of enemy.tint) {
        mesh.material.emissive.setRGB(hurt + burn, hurt * 0.1 + burn * 0.4, 0);
    }
}

// Apply damage from the player; returns true when the enemy is dead.
export function hurtEnemy(enemy, amount, fromPos) {
    enemy.hp -= amount;
    enemy.hurtTimer = 0.25;
    const push = new THREE.Vector3().subVectors(enemy.pos, fromPos);
    push.y = 0;
    if (push.lengthSq() > 1e-4) {
        push.normalize().multiplyScalar(enemy.def.knockback);
        enemy.vel.x = push.x; enemy.vel.z = push.z; enemy.vel.y = Math.max(enemy.vel.y, 4);
    }
    if (enemy.type === 'lunger' && enemy.state === 'lunge') { enemy.state = 'recover'; enemy.stateTimer = 0.9; }
    return enemy.hp <= 0;
}

export function rollDrops(enemy, rnd = Math.random) {
    if (enemy.burning) return [];
    const out = [];
    for (const d of enemy.def.drops) {
        const n = d.min + Math.floor(rnd() * (d.max - d.min + 1));
        if (n > 0) out.push({ item: d.item, count: n });
    }
    return out;
}

// Ray against the enemy's bounding box; returns the hit distance or Infinity.
export function rayHitsEnemy(enemy, origin, dir, maxDistance) {
    const b = enemyBox(enemy);
    let tmin = 0, tmax = maxDistance;
    for (const [o, d, lo, hi] of [[origin.x, dir.x, b.minX, b.maxX], [origin.y, dir.y, b.minY, b.maxY], [origin.z, dir.z, b.minZ, b.maxZ]]) {
        if (Math.abs(d) < 1e-8) { if (o < lo || o > hi) return Infinity; continue; }
        let t1 = (lo - o) / d, t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return Infinity;
    }
    return tmin;
}

export function disposeEnemy(enemy) {
    enemy.group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
    });
}
