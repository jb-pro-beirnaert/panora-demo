import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { generateDataset } from './lib/dataset.js';

/** `npm run gen:evals -- --seed 7 --count 60` → evals/datasets/seed-7.json */
const { values } = parseArgs({
  options: { seed: { type: 'string', default: '7' }, count: { type: 'string', default: '60' } },
});
const dataset = generateDataset(Number(values.seed), Number(values.count));
const directory = new URL('./datasets/', import.meta.url);
mkdirSync(directory, { recursive: true });
const file = new URL(`${dataset.name}.json`, directory);
writeFileSync(file, `${JSON.stringify(dataset, null, 2)}\n`);

const count = (key: (c: (typeof dataset.cases)[number]) => string) =>
  Object.entries(
    dataset.cases.reduce<Record<string, number>>((acc, c) => {
      acc[key(c)] = (acc[key(c)] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([name, n]) => `${name}: ${n}`)
    .join(', ');
console.log(`wrote ${dataset.cases.length} cases to ${file.pathname}`);
console.log(`scenarios — ${count((c) => c.groundTruth.scenario)}`);
console.log(`languages — ${count((c) => c.groundTruth.emailLanguage)}`);
