// Serve the JS loader and WASM from the same installed release as the app.
import { cpSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packageDir = dirname(require.resolve("@mediapipe/tasks-vision"));
const { version } = require(join(packageDir, "package.json"));
cpSync(join(packageDir, "wasm"), `public/pose-runtime/${version}`, { recursive: true });
