const BASE_BLOCKS: Record<CreepRole, BodyPartConstant[]> = {
  harvester: [WORK, WORK, CARRY, MOVE],
  upgrader: [WORK, CARRY, MOVE],
  builder: [WORK, CARRY, MOVE]
};

function blockCost(block: BodyPartConstant[]): number {
  return block.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

export function planBody(role: CreepRole, energyAvailable: number): BodyPartConstant[] {
  const block = BASE_BLOCKS[role];
  const cost = blockCost(block);

  const affordableRepeats = Math.floor(energyAvailable / cost);
  const maxSizeRepeats = Math.floor(MAX_CREEP_SIZE / block.length);
  const repeats = Math.min(affordableRepeats, maxSizeRepeats);

  const body: BodyPartConstant[] = [];
  for (let i = 0; i < repeats; i++) {
    body.push(...block);
  }
  return body;
}
