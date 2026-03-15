import { smokeCommands } from "./catalog.js";

console.log("Piphony smoke entrypoint");
console.log("Canonical smoke scripts:");
for (const command of smokeCommands) {
  console.log(`- npm run ${command.script}  [${command.lane}]`);
  console.log(`  ${command.description}`);
}
console.log("- npm run smoke:all");
console.log("  Runs the full canonical smoke suite.");
