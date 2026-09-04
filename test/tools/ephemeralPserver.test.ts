import { describe, expect, it } from "vitest";
import {
  buildDestConfig,
  buildDockerRunArgs,
  containerNameFor,
  dataDirFor,
  generateInstanceName,
  handlePathFor,
  instanceDir,
  parseFlags
} from "../../tools/ephemeralPserver.mjs";

describe("generateInstanceName", () => {
  it("produces a name in the expected format", () => {
    expect(generateInstanceName(() => 0)).toMatch(/^ephemeral-[0-9a-z]+$/);
  });

  it("produces different names for different random inputs", () => {
    const a = generateInstanceName(() => 0.1);
    const b = generateInstanceName(() => 0.9);

    expect(a).not.toBe(b);
  });
});

describe("path helpers", () => {
  it("nests dataDir and handlePath under the same instance directory", () => {
    const dir = instanceDir("foo");

    expect(dataDirFor("foo")).toBe(`${dir}/data`);
    expect(handlePathFor("foo")).toBe(`${dir}/handle.json`);
  });

  it("namespaces the container name so it can't collide with the persistent server's", () => {
    expect(containerNameFor("foo")).toBe("screeps-ephemeral-foo");
  });
});

describe("buildDockerRunArgs", () => {
  it("publishes the given port to the API port and bind-mounts the data dir", () => {
    const args = buildDockerRunArgs({
      containerName: "screeps-ephemeral-foo",
      dataDir: "/tmp/screeps-ephemeral/foo/data",
      port: 21125
    });

    expect(args).toEqual([
      "run",
      "-d",
      "--name",
      "screeps-ephemeral-foo",
      "-p",
      "21125:21025",
      "-v",
      "/tmp/screeps-ephemeral/foo/data:/screeps",
      "screepers/screeps-launcher"
    ]);
  });
});

describe("buildDestConfig", () => {
  it("builds a screeps.json-shaped destination pointed at localhost", () => {
    expect(buildDestConfig({ port: 21125, token: "abc" })).toEqual({
      protocol: "http",
      hostname: "localhost",
      port: 21125,
      path: "/",
      token: "abc",
      branch: "auto"
    });
  });
});

describe("parseFlags", () => {
  it("separates positional args from --flag value pairs", () => {
    const { positional, flags } = parseFlags(["myname", "W1N1", "--shard", "shard2"]);

    expect(positional).toEqual(["myname", "W1N1"]);
    expect(flags).toEqual({ shard: "shard2" });
  });

  it("treats a registered boolean flag as valueless, not consuming the next token", () => {
    const { positional, flags } = parseFlags(["myname", "--overwrite", "W1N1"], new Set(["overwrite"]));

    expect(positional).toEqual(["myname", "W1N1"]);
    expect(flags).toEqual({ overwrite: true });
  });

  it("defaults to no positional args or flags for an empty input", () => {
    expect(parseFlags([])).toEqual({ positional: [], flags: {} });
  });
});
