#!/usr/bin/env node
/**
 * Build the README hero GIF from a series of static screenshots.
 *
 * Pipeline:
 *   1. Run the screenshots Playwright project (recreates the DB, seeds it,
 *      walks the storyboard, drops a PNG per beat into docs/screenshots/shots/).
 *   2. For each beat, scale-and-pad the PNG to a uniform canvas with the
 *      brand background colour (so modal close-ups land centred in a
 *      letterbox instead of stretched).
 *   3. Duplicate each padded frame N times based on its `holdSeconds` to
 *      produce a hard-cut slideshow at FPS (no transitions = no flicker).
 *   4. Feed the duplicated frames to gifski at max quality.
 *
 * Requires ffmpeg and gifski on PATH:
 *   brew install ffmpeg gifski
 *
 * Output: docs/screenshots/hero.gif
 */

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cropReadmeShots } from './crop-readme.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const screenshotsDir = path.join(repoRoot, 'docs', 'screenshots');
const shotsDir = path.join(screenshotsDir, 'shots');
const outputPath = path.join(screenshotsDir, 'hero.gif');

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 800;
const BG_COLOR = '#0E1A24'; // tablet/admin shell background — matches the app
const FPS = 10;
const SIZE_WARN_MB = 8;

// Per-beat display durations. Keys match the PNG filenames produced by
// hero.spec.ts. Default is 3.0s; bump for beats with more text to read
// (tier modal) or trim for ones the eye absorbs at a glance.
const HOLD_SECONDS = {
  '01-routine.png': 3.5,
  '02-completion.png': 3.0,
  '03-tier-modal.png': 3.5,
  '04-celebration.png': 4.0,
  '05-cashout.png': 3.5,
  '06-admin-pending.png': 3.5,
  '07-admin-restrictions.png': 3.5,
  '08-admin-presence.png': 3.5,
};
const DEFAULT_HOLD_SECONDS = 3.0;

function main() {
  requireTool('ffmpeg', 'brew install ffmpeg');

  mkdirSync(screenshotsDir, { recursive: true });

  console.log('[hero] preparing screenshots database…');
  // prepare-db asks before dropping its database; `--yes` skips the prompt.
  const prepareArgs = process.argv.includes('--yes') ? ['--yes'] : [];
  runChecked(
    'node',
    [path.join(repoRoot, 'scripts/screenshots/prepare-db.mjs'), ...prepareArgs],
    repoRoot,
  );

  console.log('[hero] running screenshots Playwright project…');
  runChecked(
    'npm',
    ['--workspace', 'apps/e2e', 'run', 'test:screenshots'],
    repoRoot,
  );

  const shots = readdirSync(shotsDir)
    .filter((f) => f.endsWith('.png'))
    .sort();
  if (shots.length === 0) {
    throw new Error(`No screenshots found under ${shotsDir}.`);
  }
  console.log(`[hero] ${shots.length} beat${shots.length === 1 ? '' : 's'} captured`);
  cropReadmeShots();

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'hero-build-'));
  try {
    const padded = padAll(shots, tmp);
    const sequence = duplicateFrames(padded, tmp);
    console.log(`[hero] ${sequence.length} GIF frame${sequence.length === 1 ? '' : 's'} → encoding…`);
    encodeGif(tmp, outputPath);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const sizeMb = statSync(outputPath).size / (1024 * 1024);
  console.log(`[hero] wrote ${path.relative(repoRoot, outputPath)} (${sizeMb.toFixed(2)} MB)`);
  if (sizeMb > SIZE_WARN_MB) {
    console.warn(`[hero] ⚠ GIF is over ${SIZE_WARN_MB} MB. Consider shorter beats or fewer pixels.`);
  }
}

function padAll(shots, tmp) {
  const out = [];
  for (const file of shots) {
    const src = path.join(shotsDir, file);
    const dst = path.join(tmp, `pad-${file}`);
    runChecked('ffmpeg', [
      '-y',
      '-loglevel', 'error',
      '-i', src,
      '-vf', [
        `scale=w=${CANVAS_WIDTH}:h=${CANVAS_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos`,
        `pad=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=${BG_COLOR}`,
      ].join(','),
      '-frames:v', '1',
      dst,
    ]);
    out.push({ file, padded: dst });
  }
  return out;
}

/**
 * Encode the duplicated frame sequence as an animated GIF.
 *
 * `paletteuse=new=1` generates a fresh palette every output frame, which
 * forces ffmpeg to emit each frame in full rather than as a delta against
 * the previous one. Without this, GIF disposal-method 0 (the default)
 * lets pixels from a small modal frame ghost through into the next full
 * page screenshot. `-gifflags -offsetting` disables the encoder's
 * rectangle-diff optimisation for the same reason — we want full-canvas
 * frames so every beat is visually clean.
 */
function encodeGif(framesDir, dest) {
  runChecked('ffmpeg', [
    '-y',
    '-loglevel', 'error',
    '-framerate', String(FPS),
    '-i', path.join(framesDir, 'f_%05d.png'),
    '-filter_complex',
    '[0:v]split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=new=1:dither=bayer:bayer_scale=5',
    '-gifflags', '-offsetting',
    '-loop', '0',
    dest,
  ]);
}

function duplicateFrames(padded, tmp) {
  const seq = [];
  let frameIdx = 0;
  for (const { file, padded: src } of padded) {
    const holdSeconds = HOLD_SECONDS[file] ?? DEFAULT_HOLD_SECONDS;
    const copies = Math.max(1, Math.round(holdSeconds * FPS));
    for (let i = 0; i < copies; i++) {
      const dst = path.join(tmp, `f_${String(frameIdx).padStart(5, '0')}.png`);
      copyFileSync(src, dst);
      seq.push(dst);
      frameIdx++;
    }
  }
  return seq;
}

function requireTool(name, install) {
  const probe = spawnSync(name, ['--version'], { stdio: 'ignore' });
  if (probe.error || probe.status === null) {
    throw new Error(`Missing required tool: ${name}. Install with: ${install}`);
  }
}

function runChecked(cmd, args, cwd) {
  const result = spawnSync(cmd, args, {
    cwd: cwd ?? process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with status ${result.status ?? 'null'}`);
  }
}

try {
  main();
} catch (err) {
  console.error(`[hero] ${err.message}`);
  process.exit(1);
}
