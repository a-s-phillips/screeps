// Screeps injects these as real globals at runtime; @types/screeps only
// declares their types (`declare const X: Y`), so tests need the actual
// values polyfilled to reference them the same way production code does.
Object.assign(globalThis, {
  OK: 0,
  ERR_NOT_IN_RANGE: -9,
  ERR_NOT_ENOUGH_RESOURCES: -6,
  ERR_NOT_ENOUGH_ENERGY: -6,

  FIND_CREEPS: 101,
  FIND_MY_CREEPS: 102,
  FIND_HOSTILE_CREEPS: 103,
  FIND_SOURCES_ACTIVE: 104,
  FIND_SOURCES: 105,
  FIND_STRUCTURES: 107,
  FIND_MY_STRUCTURES: 108,
  FIND_CONSTRUCTION_SITES: 111,
  FIND_MY_SPAWNS: 112,
  FIND_MY_CONSTRUCTION_SITES: 114,

  MOVE: "move",
  WORK: "work",
  CARRY: "carry",
  ATTACK: "attack",
  RANGED_ATTACK: "ranged_attack",
  TOUGH: "tough",
  HEAL: "heal",
  CLAIM: "claim",

  RESOURCE_ENERGY: "energy",

  STRUCTURE_EXTENSION: "extension",
  STRUCTURE_CONTAINER: "container",
  STRUCTURE_SPAWN: "spawn",
  STRUCTURE_ROAD: "road",
  STRUCTURE_TOWER: "tower",
  STRUCTURE_WALL: "constructedWall",
  STRUCTURE_RAMPART: "rampart",
  TERRAIN_MASK_WALL: 1,
  TERRAIN_MASK_SWAMP: 2,

  MAX_CREEP_SIZE: 50,
  CARRY_CAPACITY: 50,
  CREEP_SPAWN_TIME: 3,
  HARVEST_POWER: 2,
  SOURCE_ENERGY_CAPACITY: 3000,
  ENERGY_REGEN_TIME: 300,
  BODYPART_COST: {
    move: 50,
    work: 100,
    attack: 80,
    carry: 50,
    heal: 250,
    ranged_attack: 150,
    tough: 10,
    claim: 600
  },
  CONTROLLER_STRUCTURES: {
    extension: { 0: 0, 1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60 },
    container: { 0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5 },
    tower: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 6 }
  }
});
