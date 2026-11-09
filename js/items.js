// Survival mode items: blocks as inventory stacks, tools with durability, food and crafting recipes.
// Icons are painted on canvases at start-up, like the block textures; there are no image files.
import { BLOCKS, BLOCK, PLACEABLE, drawBlockIcon } from './blocks.js';

export const INVENTORY_SLOTS = 27;
export const STACK_SIZE = 64;
export const HAND = { speed: 1, tier: 0, damage: 1 };

// Tool tiers: speed is the multiplier on the base break time when the right tool is used,
// tier gates which blocks can be collected, and damage is what the tool deals to enemies.
export const TIERS = [
    { key: 'wooden', name: 'Wooden', tier: 1, speed: 2, damage: 2, swordDamage: 3, durability: 60, material: 'block:13', head: [178, 138, 86] },
    { key: 'stone', name: 'Stone', tier: 2, speed: 4, damage: 3, swordDamage: 4, durability: 130, material: 'block:4', head: [128, 128, 132] },
    { key: 'iron', name: 'Iron', tier: 3, speed: 7, damage: 4, swordDamage: 6, durability: 260, material: 'block:20', head: [222, 222, 230] }
];
export const TOOL_TYPES = ['pickaxe', 'axe', 'shovel', 'sword'];
const TOOL_COST = { pickaxe: 3, axe: 3, shovel: 1, sword: 2 };

export const ITEMS = {};

function define(item) {
    ITEMS[item.key] = Object.assign({ stack: STACK_SIZE, kind: 'misc' }, item);
    return ITEMS[item.key];
}

for (const id of PLACEABLE) {
    define({ key: `block:${id}`, name: BLOCKS[id].name, kind: 'block', block: id });
}
define({ key: 'apple', name: 'Apple', kind: 'food', food: 4, description: 'Falls from oak leaves.' });
define({ key: 'berries', name: 'Berries', kind: 'food', food: 2, description: 'Picked from berry bushes.' });
define({ key: 'raw_meat', name: 'Raw meat', kind: 'food', food: 2, description: 'Better cooked.' });
define({ key: 'cooked_meat', name: 'Cooked meat', kind: 'food', food: 8, description: 'A proper meal.' });

for (const tier of TIERS) {
    for (const type of TOOL_TYPES) {
        define({
            key: `${tier.key}_${type}`,
            name: `${tier.name} ${type}`,
            kind: 'tool', stack: 1, toolType: type, tier: tier.tier, speed: tier.speed,
            damage: type === 'sword' ? tier.swordDamage : tier.damage, durability: tier.durability, head: tier.head
        });
    }
}

export const STICK_COLOUR = [120, 86, 48];

// Crafting recipes. `needs` maps item keys to counts; `count` is how many of `out` one craft yields.
export const RECIPES = [
    { out: 'block:13', count: 4, needs: { 'block:11': 1 }, note: 'Saw a log into planks' },
    { out: 'block:19', count: 4, needs: { 'block:11': 1, 'block:13': 1 }, note: 'Four torches from a log and a plank' },
    { out: 'block:16', count: 2, needs: { 'block:7': 2, 'block:11': 1 }, note: 'Melt sand over a wood fire' },
    { out: 'block:5', count: 4, needs: { 'block:4': 4 }, note: 'Dress cobblestone into bricks' },
    { out: 'block:17', count: 1, needs: { 'block:19': 1, 'block:16': 1 }, note: 'A torch in a glass case' },
    { out: 'cooked_meat', count: 1, needs: { raw_meat: 1, 'block:11': 1 }, note: 'Roast meat over a log fire' }
];
for (const tier of TIERS) {
    for (const type of TOOL_TYPES) {
        // a head of the tier's material on an oak-log handle
        const needs = { [tier.material]: TOOL_COST[type] };
        needs['block:11'] = (needs['block:11'] || 0) + (type === 'sword' ? 1 : 2);
        RECIPES.push({ out: `${tier.key}_${type}`, count: 1, needs, note: `${tier.name} head on an oak handle` });
    }
}

// What a block yields when it is broken in Survival. Returns [{ item, count }] (possibly empty).
export function dropsFor(blockId, rnd = Math.random) {
    switch (blockId) {
        case BLOCK.AIR: case BLOCK.WATER: return [];
        case BLOCK.GRASS: return [{ item: 'block:2', count: 1 }];
        case BLOCK.STONE: return [{ item: 'block:4', count: 1 }];
        case BLOCK.LEAVES: return rnd() < 0.14 ? [{ item: 'apple', count: 1 }] : [];
        case BLOCK.BERRY_BUSH: return [{ item: 'berries', count: 1 + Math.floor(rnd() * 3) }];
        default: return [{ item: `block:${blockId}`, count: 1 }];
    }
}

// Seconds needed to break a block with the given tool item (or null for bare hands) in Survival.
// Returns { seconds, collects } where collects is false when the tool tier is too low to yield a drop.
export function breakPlan(blockId, tool) {
    const block = BLOCKS[blockId];
    if (!block || block.liquid || blockId === BLOCK.AIR) return null;
    const hardness = block.hardness ?? 1;
    const matches = !!tool && tool.kind === 'tool' && tool.toolType === block.tool;
    const tier = matches ? tool.tier : 0;
    const collects = tier >= (block.tier || 0);
    let seconds = hardness / (matches ? tool.speed : 1);
    if (!collects) seconds *= 2.5;           // chipping away at stone with your hands is slow and fruitless
    if (!matches && block.tool && tool && tool.kind === 'tool') seconds *= 1.3;   // the wrong tool is clumsier than hands
    return { seconds: Math.max(0.1, seconds), collects };
}

// --- Inventory --------------------------------------------------------------------------------
// An inventory is a fixed-length array; each slot is null or { item, count, durability? }.

export function newInventory() {
    return new Array(INVENTORY_SLOTS).fill(null);
}

export function addToInventory(inv, key, count = 1, durability = undefined) {
    const item = ITEMS[key];
    if (!item) return count;
    let left = count;
    if (item.stack > 1) {
        for (const slot of inv) {
            if (left <= 0) break;
            if (slot && slot.item === key && slot.count < item.stack) {
                const take = Math.min(left, item.stack - slot.count);
                slot.count += take; left -= take;
            }
        }
    }
    for (let i = 0; i < inv.length && left > 0; i++) {
        if (inv[i]) continue;
        const take = Math.min(left, item.stack);
        inv[i] = { item: key, count: take };
        if (item.kind === 'tool') inv[i].durability = durability ?? item.durability;
        left -= take;
    }
    return left;   // what did not fit
}

export function countItem(inv, key) {
    let n = 0;
    for (const slot of inv) if (slot && slot.item === key) n += slot.count;
    return n;
}

export function removeFromInventory(inv, key, count) {
    let left = count;
    for (let i = 0; i < inv.length && left > 0; i++) {
        const slot = inv[i];
        if (!slot || slot.item !== key) continue;
        const take = Math.min(left, slot.count);
        slot.count -= take; left -= take;
        if (slot.count <= 0) inv[i] = null;
    }
    return left === 0;
}

export function canCraft(inv, recipe) {
    return Object.entries(recipe.needs).every(([key, n]) => countItem(inv, key) >= n);
}

export function craft(inv, recipe) {
    if (!canCraft(inv, recipe)) return false;
    for (const [key, n] of Object.entries(recipe.needs)) removeFromInventory(inv, key, n);
    const left = addToInventory(inv, recipe.out, recipe.count);
    return { made: recipe.count - left, dropped: left };
}

export function serialiseInventory(inv) {
    return inv.map(slot => slot ? [slot.item, slot.count, slot.durability ?? null] : null);
}

export function deserialiseInventory(list) {
    const inv = newInventory();
    if (!Array.isArray(list)) return inv;
    list.slice(0, INVENTORY_SLOTS).forEach((entry, i) => {
        if (!Array.isArray(entry) || !ITEMS[entry[0]]) return;
        const item = ITEMS[entry[0]];
        const slot = { item: entry[0], count: Math.max(1, Math.min(item.stack, entry[1] | 0)) };
        if (item.kind === 'tool') slot.durability = Number.isFinite(entry[2]) ? Math.max(1, Math.min(item.durability, entry[2])) : item.durability;
        inv[i] = slot;
    });
    return inv;
}

// A sensible kit for a fresh Survival world: enough to get through the first night.
export function starterInventory() {
    const inv = newInventory();
    addToInventory(inv, 'wooden_axe');
    addToInventory(inv, 'block:19', 4);
    addToInventory(inv, 'apple', 3);
    return inv;
}

// --- Icons ----------------------------------------------------------------------------------
function rgb([r, g, b], k = 1) {
    return `rgb(${Math.min(255, Math.round(r * k))},${Math.min(255, Math.round(g * k))},${Math.min(255, Math.round(b * k))})`;
}

// Paint pixel-art onto a canvas using a 16x16 grid of cells.
function pixels(ctx, size, rows, palette) {
    const cell = size / 16;
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            const colour = palette[row[x]];
            if (!colour) continue;
            ctx.fillStyle = colour;
            ctx.fillRect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell), Math.ceil(cell));
        }
    });
}

const TOOL_SHAPES = {
    pickaxe: [
        '......HHHHH.....',
        '....HHHHHHHHH...',
        '...HH...S...HH..',
        '..H.....S....HH.',
        '.H......S.....H.',
        '.......SS.......',
        '......SS........',
        '.....SS.........',
        '....SS..........',
        '...SS...........',
        '..SS............',
        '.SS.............',
        'SS..............',
        '................',
        '................',
        '................'
    ],
    axe: [
        '.......HHHH.....',
        '.....HHHHHHH....',
        '.....HHHHHHHH...',
        '.....HHHSHHHH...',
        '......HSSHHH....',
        '.......SS.HH....',
        '......SS........',
        '.....SS.........',
        '....SS..........',
        '...SS...........',
        '..SS............',
        '.SS.............',
        'SS..............',
        '................',
        '................',
        '................'
    ],
    shovel: [
        '..........HHH...',
        '.........HHHHH..',
        '.........HHHHH..',
        '.........HHHHH..',
        '..........HHH...',
        '.........SS.....',
        '........SS......',
        '.......SS.......',
        '......SS........',
        '.....SS.........',
        '....SS..........',
        '...SS...........',
        '..SS............',
        '.SS.............',
        '................',
        '................'
    ],
    sword: [
        '.............HH.',
        '............HHH.',
        '...........HHH..',
        '..........HHH...',
        '.........HHH....',
        '........HHH.....',
        '.......HHH......',
        '......HHH.......',
        '..G..HHH........',
        '...GGHH.........',
        '....GGG.........',
        '...SSGGG........',
        '..SS............',
        '.SS.............',
        'SS..............',
        '................'
    ]
};

const FOOD_SHAPES = {
    apple: {
        rows: [
            '................',
            '.........L......',
            '........LL......',
            '.......LL.......',
            '....RRRRSRRR....',
            '...RRRRRRRRRR...',
            '..RRWRRRRRRRRR..',
            '..RWRRRRRRRRRR..',
            '..RRRRRRRRRRRR..',
            '..RRRRRRRRRRRR..',
            '..RRRRRRRRRRRR..',
            '...RRRRRRRRRR...',
            '....RRRRRRRRR...',
            '.....RRR.RRR....',
            '................',
            '................'
        ],
        palette: { R: 'rgb(200,40,50)', W: 'rgb(255,190,190)', L: 'rgb(70,140,50)', S: 'rgb(90,60,30)' }
    },
    berries: {
        rows: [
            '................',
            '.......LL.......',
            '......LL........',
            '....PP.L.PP.....',
            '...PWPP.PPWP....',
            '...PPPP.PPPP....',
            '....PP...PP.....',
            '......PP........',
            '.....PWPP..PP...',
            '.....PPPP.PWPP..',
            '......PP..PPPP..',
            '..PP.......PP...',
            '.PWPP...........',
            '.PPPP...........',
            '..PP............',
            '................'
        ],
        palette: { P: 'rgb(120,40,140)', W: 'rgb(230,200,240)', L: 'rgb(70,140,50)' }
    },
    raw_meat: {
        rows: [
            '................',
            '................',
            '....MMMMMM......',
            '..MMMMMMMMMM....',
            '.MMMFFMMMMMMM...',
            '.MMFFMMMMMFMM...',
            '.MMMMMMMMFFMM...',
            '.MMMMMMMMMMMMB..',
            '..MMMMMMMMMMBB..',
            '...MMMMMMMMBBB..',
            '.....MMMMMBB....',
            '..........B.....',
            '................',
            '................',
            '................',
            '................'
        ],
        palette: { M: 'rgb(214,80,90)', F: 'rgb(250,220,220)', B: 'rgb(240,235,220)' }
    },
    cooked_meat: {
        rows: [
            '................',
            '................',
            '....MMMMMM......',
            '..MMMMMMMMMM....',
            '.MMMDDMMMMMMM...',
            '.MMDDMMMMMDMM...',
            '.MMMMMMMMDDMM...',
            '.MMMMMMMMMMMMB..',
            '..MMMMMMMMMMBB..',
            '...MMMMMMMMBBB..',
            '.....MMMMMBB....',
            '..........B.....',
            '................',
            '................',
            '................',
            '................'
        ],
        palette: { M: 'rgb(150,90,50)', D: 'rgb(95,55,30)', B: 'rgb(240,235,220)' }
    }
};

export function drawItemIcon(canvas, key, tiles) {
    const item = ITEMS[key];
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    if (!item) return;
    if (item.kind === 'block') {
        if (item.block === BLOCK.TORCH) {
            pixels(ctx, size, [
                '................', '......FFF.......', '.....FYYYF......', '.....FYWYF......', '.....FYYYF......',
                '......FFF.......', '......SSS.......', '......SSS.......', '......SSS.......', '......SSS.......',
                '......SSS.......', '......SSS.......', '......SSS.......', '......SSS.......', '................', '................'
            ], { F: 'rgb(255,120,30)', Y: 'rgb(255,200,60)', W: 'rgb(255,250,200)', S: rgb(STICK_COLOUR) });
            return;
        }
        drawBlockIcon(canvas, BLOCKS[item.block], tiles);
        return;
    }
    if (item.kind === 'tool') {
        pixels(ctx, size, TOOL_SHAPES[item.toolType], { H: rgb(item.head), S: rgb(STICK_COLOUR), G: rgb(STICK_COLOUR, 0.75) });
        return;
    }
    const shape = FOOD_SHAPES[key];
    if (shape) pixels(ctx, size, shape.rows, shape.palette);
}
