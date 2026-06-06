#!/usr/bin/env node
/**
 * Crop README close-ups out of the full-frame beats in docs/screenshots/shots/.
 * Called by build-gif.mjs after each capture; also runs on its own (it needs
 * only ffmpeg, no database or browser) after you change a crop below.
 *
 * Output: docs/screenshots/readme/<name>.png
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const shotsDir = path.join(repoRoot, 'docs', 'screenshots', 'shots');
const readmeDir = path.join(repoRoot, 'docs', 'screenshots', 'readme');

// source beat → { out, crop: [width, height, x, y] } in source pixels. Each
// crop trims the empty canvas below an admin page's content.
const CROPS = {
  '06-admin-pending.png': { out: 'admin-pending.png', crop: [1280, 175, 0, 0] },
  '07-admin-restrictions.png': { out: 'admin-restrictions.png', crop: [1280, 545, 0, 0] },
  '08-admin-presence.png': { out: 'admin-presence.png', crop: [1280, 650, 0, 0] },
};

export function cropReadmeShots() {
  mkdirSync(readmeDir, { recursive: true });
  for (const [src, { out, crop }] of Object.entries(CROPS)) {
    const [w, h, x, y] = crop;
    const result = spawnSync(
      'ffmpeg',
      ['-loglevel', 'error', '-y', '-i', path.join(shotsDir, src),
        '-vf', `crop=${w}:${h}:${x}:${y}`, path.join(readmeDir, out)],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) throw new Error(`ffmpeg crop of ${src} failed`);
    console.log(`[crop] ${src} → readme/${out}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    cropReadmeShots();
  } catch (err) {
    console.error(`[crop] ${err.message}`);
    process.exit(1);
  }
}
