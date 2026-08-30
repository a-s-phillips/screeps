import { describe, expect, it } from "vitest";
import { cleanUpDeadCreepMemory } from "../../src/memory/cleanup";

describe("cleanUpDeadCreepMemory", () => {
  it("removes memory entries for creeps that no longer exist", () => {
    const memory = { creeps: { alive: {}, dead: {} } } as unknown as Memory;
    const creeps = { alive: {} } as unknown as { [name: string]: Creep };

    cleanUpDeadCreepMemory(memory, creeps);

    expect(memory.creeps).toEqual({ alive: {} });
  });

  it("leaves memory untouched when all creeps are alive", () => {
    const memory = { creeps: { alive: {} } } as unknown as Memory;
    const creeps = { alive: {} } as unknown as { [name: string]: Creep };

    cleanUpDeadCreepMemory(memory, creeps);

    expect(memory.creeps).toEqual({ alive: {} });
  });
});
