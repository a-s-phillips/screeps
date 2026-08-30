// Screeps injects these as real globals at runtime; @types/screeps only
// declares their types (`declare const X: Y`), so tests need the actual
// values polyfilled to reference them the same way production code does.
Object.assign(globalThis, {
  OK: 0,
  ERR_NOT_IN_RANGE: -9,
  ERR_NOT_ENOUGH_RESOURCES: -6,
  ERR_NOT_ENOUGH_ENERGY: -6,

  FIND_SOURCES_ACTIVE: 104,
  FIND_SOURCES: 105,
  FIND_CONSTRUCTION_SITES: 111,
  FIND_MY_SPAWNS: 112,

  MOVE: "move",
  WORK: "work",
  CARRY: "carry",
  ATTACK: "attack",
  RANGED_ATTACK: "ranged_attack",
  TOUGH: "tough",
  HEAL: "heal",
  CLAIM: "claim",

  RESOURCE_ENERGY: "energy",

  MAX_CREEP_SIZE: 50,
  CARRY_CAPACITY: 50,
  BODYPART_COST: {
    move: 50,
    work: 100,
    attack: 80,
    carry: 50,
    heal: 250,
    ranged_attack: 150,
    tough: 10,
    claim: 600
  }
});
