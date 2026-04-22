// Produces the deterministic dataset feeding both the visualisation (apps/web)
// and the TypeDB ingestion path.
//
//   bun run backend/src/cmd/mockgen.ts
//   bun run backend/src/cmd/mockgen.ts --seed 123 --out backend/out

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { generate } from "../mock/generator.ts";
import { buildInsertScript } from "../mock/tql.ts";

function parseFlags(argv: string[]): { seed: number; out: string } {
  const flags: { seed: number; out: string } = { seed: 42, out: "out" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "--seed" || a === "-seed") && i + 1 < argv.length) {
      flags.seed = Number(argv[++i]);
    } else if ((a === "--out" || a === "-out") && i + 1 < argv.length) {
      flags.out = argv[++i]!;
    }
  }
  return flags;
}

const { seed, out } = parseFlags(Bun.argv.slice(2));

const ds = generate(seed);
await mkdir(out, { recursive: true });

const episodesPath = path.join(out, "episodes.json");
const tqlPath = path.join(out, "insert.tql");

const json = JSON.stringify(ds, null, 2);
await Bun.write(episodesPath, json);

const tql = buildInsertScript(ds);
await Bun.write(tqlPath, tql);

const stats = ds.episodes.reduce(
  (acc, e) => {
    acc.relCounts[e.relation_type] = (acc.relCounts[e.relation_type] ?? 0) + 1;
    if (e.crosses_minute) acc.crossMinute++;
    if (e.crosses_hour) acc.crossHour++;
    return acc;
  },
  { crossMinute: 0, crossHour: 0, relCounts: {} as Record<string, number> },
);

const n = ds.episodes.length;
console.log(`wrote ${episodesPath} (${json.length} bytes)`);
console.log(`wrote ${tqlPath} (${tql.length} bytes)`);
console.log(
  `episodes=${n}  crosses_minute=${stats.crossMinute} (${((100 * stats.crossMinute) / n).toFixed(1)}%)  ` +
    `crosses_hour=${stats.crossHour} (${((100 * stats.crossHour) / n).toFixed(1)}%)`,
);
console.log("relation_type breakdown:");
for (const [k, v] of Object.entries(stats.relCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(16)} ${v}`);
}
