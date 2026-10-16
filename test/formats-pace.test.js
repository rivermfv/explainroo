import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, speechChunks } from '../src/script.js';
import { normalizeConfig, resolveSize, FORMATS, ProjectError } from '../src/project.js';
import { buildTimeline } from '../src/timeline.js';
import { layoutAreas } from '../engine/layout.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('named formats resolve to their size and safe area', () => {
  assert.deepEqual(resolveSize('youtube'), { width: 1920, height: 1080, safe: null });
  assert.equal(resolveSize('tiktok').height, 1920);
  assert.ok(resolveSize('tiktok').safe.bottom > 0.3);
  assert.deepEqual(resolveSize('linkedin'), { width: 1080, height: 1350, safe: null });
  const cfg = normalizeConfig({ size: 'reels' });
  assert.equal(cfg.format, 'reels');
  assert.equal(cfg.captions, true);
  assert.deepEqual(cfg.safe, FORMATS.reels.safe);
  assert.equal(normalizeConfig({ size: '9:16' }).safe, null);
  assert.throws(() => normalizeConfig({ size: 'myspace' }), ProjectError);
});

test('platform safe area keeps content above the captions and clear of the buttons', () => {
  const cfg = normalizeConfig({ size: 'tiktok' });
  const { safe, captions, app } = layoutAreas(cfg, 1080, 1920);
  assert.equal(app.bottom, 1920 - Math.round(1920 * FORMATS.tiktok.safe.bottom));
  assert.ok(captions.bottom < app.bottom);
  assert.ok(safe.bottom < captions.bottom - 150);
  assert.equal(safe.right, 1080 - Math.round(1080 * FORMATS.tiktok.safe.right));
  const plain = layoutAreas(normalizeConfig({ size: '16:9' }), 1920, 1080);
  assert.equal(plain.captions, null);
  assert.equal(plain.band, null);
  assert.equal(plain.safe.left, Math.round(1080 * 0.07));
});

test('captions on feed sizes sit at the bottom, clear of the watermark and the content area', () => {
  assert.equal(normalizeConfig({ size: 'linkedin' }).watermark, false);
  for (const size of ['linkedin', 'square', 'instagram']) {
    const cfg = normalizeConfig({ size, watermark: 'explainroo.com' });
    const { safe, band } = layoutAreas(cfg, cfg.width, cfg.height);
    const wm = Math.round(Math.min(cfg.width, cfg.height) * 0.028);
    assert.ok(band, size);
    assert.ok(band.bottom <= cfg.height - wm - Math.round(wm * 1.6), `${size}: captions reach the watermark`);
    assert.ok(safe.bottom < band.top, `${size}: content area overlaps the captions`);
  }
  const noCaptions = normalizeConfig({ size: 'linkedin', captions: false });
  assert.equal(layoutAreas(noCaptions, 1080, 1350).safe.bottom, 1350 - Math.round(1080 * 0.07));
});

test('pace must stay in range and must not make the voice too fast', () => {
  assert.equal(normalizeConfig({}).pace, 1);
  assert.equal(normalizeConfig({ pace: 1.3 }).pace, 1.3);
  assert.throws(() => normalizeConfig({ pace: 3 }), ProjectError);
  assert.throws(() => normalizeConfig({ speed: 1.5, pace: 1.3 }), ProjectError);
  assert.equal(normalizeConfig({ pace: 1.44 }).music.tempo, 1.2);
});

test('pace shortens pauses between sentences and explicit pauses', () => {
  const { scenes } = parseScript('## a\nOne. Two. [pause 1] Three.');
  const normal = speechChunks(scenes[0].units, { sentenceGap: 0.3 });
  const fast = speechChunks(scenes[0].units, { sentenceGap: 0.3, pace: 1.5 });
  assert.equal(normal[1].gapBefore, 0.3);
  close(fast[1].gapBefore, 0.2);
  assert.ok(Math.abs(normal[2].gapBefore - 1.3) < 1e-9);
  assert.ok(Math.abs(fast[2].gapBefore - 1.3 / 1.5) < 1e-9);
});

test('pace shortens lead-ins, holds and transitions', () => {
  const src = '## a\nHi.\n\n## b {min=3}\n';
  const voice = { a: { duration: 1, words: [{ text: 'Hi.', start: 0, end: 1 }], marks: {}, chunks: [{ start: 0, end: 1 }] } };
  const cfg = { fps: 30, lead: 0.3, hold: 0.6, end: 0 };
  const normal = buildTimeline({ config: normalizeConfig(cfg), script: parseScript(src) }, voice);
  const fast = buildTimeline({ config: normalizeConfig({ ...cfg, pace: 1.5 }), script: parseScript(src) }, voice);
  assert.equal(normal.scenes[0].dur, Math.round((0.3 + 1 + 0.6) * 30) / 30);
  assert.equal(fast.scenes[0].dur, Math.round((0.2 + 1 + 0.4) * 30) / 30);
  close(fast.scenes[0].words[0].start, 0.2);
  assert.equal(fast.scenes[1].dur, 2);
  assert.ok(fast.transitionSeconds < normal.transitionSeconds);
  assert.equal(fast.pace, 1.5);
});

test('in a scene, times stay real seconds and pace shortens animations', async () => {
  const { Stage } = await import('../engine/stage.js');
  const { getTheme } = await import('../engine/themes.js');
  const cfg = normalizeConfig({ pace: 1.6 });
  const engine = {
    config: cfg,
    theme: getTheme('paper'),
    pen: null,
    W: 1920,
    H: 1080,
    fps: 30,
    safeArea: layoutAreas(cfg, 1920, 1080).safe,
    timeline: { pace: 1.6, duration: 10, frames: 300, fps: 30, width: 1920, height: 1080, scenes: [{}] },
    recorder: null,
  };
  const scene = { id: 'a', index: 0, start: 0, dur: 10, lead: 0.2, words: [{ text: 'hello', start: 1, end: 1.4 }], marks: { go: 3 }, voice: { dur: 2 } };
  const s = new Stage(engine, null, scene, 1.5);
  assert.equal(s.time(4), 4);
  assert.equal(s.time('hello') + 0.3, 1.3);
  assert.equal(s.time('#go'), 3);
  assert.equal(s.p(1, 0.8), 1); // 0.8 s at pace 1.6 takes 0.5 s, so it is done at 1.5
  close(s.p(1, 1.6), 0.5); // halfway through 1 s of real time
  assert.equal(s.pace, 1.6);
});
