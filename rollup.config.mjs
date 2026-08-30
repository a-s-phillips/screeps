import fs from "fs";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import screeps from "rollup-plugin-screeps";

const dest = process.env.DEST;

let config;
if (!dest) {
  console.log("No destination specified - code will be compiled but not uploaded");
} else {
  if (!fs.existsSync("screeps.json")) {
    throw new Error("screeps.json not found - copy screeps.json.example and fill in your credentials");
  }
  const allConfig = JSON.parse(fs.readFileSync("screeps.json", "utf8"));
  config = allConfig[dest];
  if (!config) {
    throw new Error(`"${dest}" is not a valid destination in screeps.json`);
  }
}

export default {
  input: "src/main.ts",
  output: {
    file: "dist/main.js",
    format: "cjs",
    sourcemap: true
  },
  plugins: [
    resolve(),
    commonjs(),
    typescript({ tsconfig: "./tsconfig.json" }),
    screeps({ config, dryRun: config == null })
  ]
};
