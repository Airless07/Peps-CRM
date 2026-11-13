// Creates .env from .env.example with a random SESSION_SECRET. Used by launch.bat. Never overwrites an existing .env.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".env")) process.exit(0);
const secret = randomBytes(32).toString("hex");
const env = readFileSync(".env.example", "utf8").replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET="${secret}"`);
writeFileSync(".env", env);
console.log("Created .env with local defaults.");
