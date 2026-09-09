#!/usr/bin/env node
/**
 * Vendor the vision model weights into the app
 * Indian Railways WRS Raipur
 *
 * WHY THIS EXISTS
 * ---------------
 * A workshop LAN may have no route to the internet, and the one moment an
 * inspector needs the camera is the moment they are standing at a bogie. A
 * model fetched from a Google CDN at first use is a model that does not exist
 * in the shed. So the weights ship inside the application and are served by
 * it, exactly as the COCO-SSD weights already are.
 *
 * Run once on a machine that does have internet, before packaging:
 *   node scripts/vendor-vision-models.mjs
 *
 * It is idempotent and skips files already present, so it is safe to re-run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(here, '..', 'client', 'public', 'models');

const SOURCES = [
  {
    name: 'mobilenet',
    // MobileNet v2, 1.0 depth, 224x224 — the feature extractor. We never use
    // its 1000 ImageNet classes; we take the 1280-value penultimate embedding
    // and compare springs to other springs from this shop.
    base: 'https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224',
    dir: 'mobilenet'
  }
];

async function fetchTo(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`  = ${path.basename(dest)} (already present)`);
    return fs.statSync(dest).size;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`  + ${path.basename(dest)} (${(buf.length / 1048576).toFixed(1)} MB)`);
  return buf.length;
}

for (const src of SOURCES) {
  const outDir = path.join(MODELS_DIR, src.dir);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`${src.name} -> client/public/models/${src.dir}/`);

  const manifestPath = path.join(outDir, 'model.json');
  await fetchTo(`${src.base}/model.json`, manifestPath);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const shards = manifest.weightsManifest.flatMap((g) => g.paths);

  let total = fs.statSync(manifestPath).size;
  for (const shard of shards) {
    total += await fetchTo(`${src.base}/${shard}`, path.join(outDir, shard));
  }
  console.log(`  ${shards.length + 1} files, ${(total / 1048576).toFixed(1)} MB total\n`);
}

console.log('Done. These files must be committed — the shed has no internet.');
