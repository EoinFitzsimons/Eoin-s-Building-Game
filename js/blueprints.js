// Prebuilt structures for blueprint mode.
// Each blueprint is a list of layers from the ground up; every layer is a list of strings read
// north to south, and each character is looked up in the legend. A full stop means "leave as is".
import { BLOCK } from './blocks.js';

const LEGEND = {
    '.': null,
    ' ': BLOCK.AIR,
    'P': BLOCK.PLANKS,
    'L': BLOCK.OAK_LOG,
    'C': BLOCK.COBBLESTONE,
    'S': BLOCK.STONE_BRICKS,
    'M': BLOCK.MOSSY_STONE,
    'B': BLOCK.BRICK,
    'R': BLOCK.ROOF_TILES,
    'G': BLOCK.GLASS,
    'A': BLOCK.LANTERN,
    'W': BLOCK.WATER,
    'T': BLOCK.STONE,
    'N': BLOCK.SAND,
    'D': BLOCK.SANDSTONE,
    'V': BLOCK.LEAVES,
    'E': BLOCK.GRASS
};

export const BLUEPRINTS = [
    {
        name: 'Cottage',
        description: 'A snug timber cottage with a tiled roof and a lantern by the door.',
        layers: [
            ['CCCCCCC', 'CPPPPPC', 'CPPPPPC', 'CPPPPPC', 'CPPPPPC', 'CCC CCC'],
            ['LPPGPPL', 'P     P', 'G     G', 'P     P', 'P     P', 'LPP PPL'],
            ['LPGGGPL', 'P     P', 'G     G', 'P     P', 'P     P', 'LPGAGPL'],
            ['RRRRRRR', 'RPPPPPR', 'RPPPPPR', 'RPPPPPR', 'RPPPPPR', 'RRRRRRR'],
            ['.......', '.RRRRR.', '.RPPPR.', '.RPPPR.', '.RRRRR.', '.......'],
            ['.......', '.......', '..RRR..', '..RRR..', '.......', '.......']
        ]
    },
    {
        name: 'Watchtower',
        description: 'A tall stone lookout with a lantern-lit platform.',
        layers: [
            ['SSSSS', 'S   S', 'S   S', 'S   S', 'SS SS'],
            ['SSSSS', 'S   S', 'S   S', 'S   S', 'SS SS'],
            ['SMSMS', 'M   M', 'S   S', 'M   M', 'SMSMS'],
            ['SSSSS', 'S   S', 'S   S', 'S   S', 'SSSSS'],
            ['SSGSS', 'S   S', 'G   G', 'S   S', 'SSGSS'],
            ['SSSSS', 'S   S', 'S   S', 'S   S', 'SSSSS'],
            ['SSSSS', 'SPPPS', 'SPPPS', 'SPPPS', 'SSSSS'],
            ['S S S', '     ', 'A   A', '     ', 'S S S']
        ]
    },
    {
        name: 'Bridge',
        description: 'A plank footbridge on log posts, eleven blocks long.',
        layers: [
            ['L.........L', 'L.........L', '...........', 'L.........L'],
            ['LPPPPPPPPPL', 'PPPPPPPPPPP', 'PPPPPPPPPPP', 'LPPPPPPPPPL'],
            ['L.........L', '...........', '...........', 'L.........L'],
            ['A.........A', '...........', '...........', 'A.........A']
        ]
    },
    {
        name: 'Well',
        description: 'A cobbled village well with a little tiled roof.',
        layers: [
            ['CCC', 'CWC', 'CCC'],
            ['L.L', '...', 'L.L'],
            ['L.L', '...', 'L.L'],
            ['RRR', 'RRR', 'RRR']
        ]
    },
    {
        name: 'Oak tree',
        description: 'A mature oak with a broad canopy.',
        layers: [
            ['.....', '.....', '..L..', '.....', '.....'],
            ['.....', '.....', '..L..', '.....', '.....'],
            ['.....', '.....', '..L..', '.....', '.....'],
            ['.VVV.', 'VVVVV', 'VVLVV', 'VVVVV', '.VVV.'],
            ['.VVV.', 'VVVVV', 'VVLVV', 'VVVVV', '.VVV.'],
            ['.....', '.VVV.', '.VVV.', '.VVV.', '.....'],
            ['.....', '..V..', '.VVV.', '..V..', '.....']
        ]
    },
    {
        name: 'Stone arch',
        description: 'A mossy gateway arch.',
        layers: [
            ['S...S'],
            ['S...S'],
            ['M...M'],
            ['S...S'],
            ['SM.MS'],
            ['SSSSS'],
            ['.SAS.']
        ]
    },
    {
        name: 'Garden wall',
        description: 'A low brick wall with sandstone coping, seven blocks long.',
        layers: [
            ['BBBBBBB'],
            ['BBBBBBB'],
            ['DDDDDDD']
        ]
    },
    {
        name: 'Lamp post',
        description: 'A log post topped with a lantern. Handy for lighting paths at night.',
        layers: [
            ['L'],
            ['L'],
            ['L'],
            ['A']
        ]
    },
    {
        name: 'Pond',
        description: 'A small sandy pond, sunk one block into the ground.',
        layers: [
            ['.NNNN.', 'NWWWWN', 'NWWWWN', 'NWWWWN', 'NWWWWN', '.NNNN.'],
            ['.     ', '      ', '      ', '      ', '      ', '     .']
        ]
    }
];

// Expand a blueprint into a list of relative cells, with the footprint centred on the origin
// and the lowest layer at y = 0. Rotation is given in quarter turns.
export function blueprintCells(blueprint, rotation = 0) {
    const cells = [];
    const depth = blueprint.layers[0].length;
    const width = Math.max(...blueprint.layers[0].map(r => r.length));
    const cx = Math.floor(width / 2), cz = Math.floor(depth / 2);
    blueprint.layers.forEach((layer, y) => {
        layer.forEach((row, z) => {
            for (let x = 0; x < row.length; x++) {
                const id = LEGEND[row[x]];
                if (id === null || id === undefined) continue;
                let rx = x - cx, rz = z - cz;
                for (let r = 0; r < (rotation & 3); r++) {
                    const t = rx; rx = -rz; rz = t;
                }
                cells.push({ x: rx, y, z: rz, id });
            }
        });
    });
    return cells;
}

// Blueprints that are sunk into the ground (such as the pond) start one block lower.
export function blueprintBaseOffset(blueprint) {
    return blueprint.name === 'Pond' ? -1 : 0;
}
