// Pure CPU benchmark of the actual source; no database or browser timings here.
import ts from 'typescript';
import { performance } from 'node:perf_hooks';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const temp = await mkdtemp(join(tmpdir(), 'mapa-perf-'));
try {
  for (const name of ['structure', 'layout']) {
    let source = await readFile(`src/maps/${name}.ts`, 'utf8');
    source = source.replace("'./structure'", "'./structure.mjs'").replace("'d3-hierarchy'", JSON.stringify(pathToFileURL(resolve('node_modules/d3-hierarchy/src/index.js')).href));
    await writeFile(join(temp, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  }
  const fixture = ts.transpileModule(await readFile('tests/performance/fixture.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  await writeFile(join(temp, 'fixture.mjs'), fixture);
  const { performanceBackup } = await import(pathToFileURL(join(temp, 'fixture.mjs')));
  const structure = await import(pathToFileURL(join(temp, 'structure.mjs')));
  const { layoutMap } = await import(pathToFileURL(join(temp, 'layout.mjs')));
  const stats = samples => { const sorted = [...samples].sort((a,b) => a-b); return { n: samples.length, p50: sorted[49], p95: sorted[94], max: sorted.at(-1) }; };
  const results = [];
  for (const size of [200, 500]) {
    const nodes = performanceBackup(size).nodes;
    const counts = () => structure.descendantCounts ? structure.descendantCounts(nodes) : new Map(nodes.map(n => [n.id, structure.subtreeIds(nodes,n.id).size - 1]));
    for (let i=0;i<20;i++) { counts(); layoutMap(nodes); }
    const countMs=[],layoutMs=[];
    for(let i=0;i<100;i++) { let start=performance.now(); counts(); countMs.push(performance.now()-start); start=performance.now(); layoutMap(nodes); layoutMs.push(performance.now()-start); }
    results.push({ size, descendantCountsMs:stats(countMs), layoutMs:stats(layoutMs) });
  }
  const phase=process.env.MAPA_PERF_PHASE??'after';
  await writeFile(`.scratch/mapa-mental/evidence/24/${phase}-pure-cpu.json`, JSON.stringify({ node:process.version,phase,results },null,2));
  console.log(JSON.stringify(results));
} finally { await rm(temp,{recursive:true,force:true}); }
