import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeConfig, loadProject, ProjectError } from '../src/project.js';
import { geminiSpeech, geminiUsage, GEMINI_VOICES } from '../src/gemini.js';
import { main } from '../src/cli.js';

function project(t, voice = { provider: 'gemini', id: 'Puck' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-gemini-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ voice }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n## first\nHello.');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { first() {} };');
  return loadProject(dir);
}

function setEnv(t, name, value) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

function audioResponse(pcm) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }],
    usageMetadata: { totalTokenCount: 12 },
  }));
}

test('Gemini voice config has defaults and rejects bad values', () => {
  const cfg = normalizeConfig({ voice: { provider: 'gemini' } });
  assert.deepEqual(cfg.voice, { provider: 'gemini', id: 'Kore', model: 'gemini-2.5-pro-preview-tts' });
  assert.equal(cfg.speed, 1);
  assert.equal(normalizeConfig({ voice: { provider: 'gemini', id: 'Puck', style: 'Say warmly' }, language: 'ja' }).voice.style, 'Say warmly');
  for (const voice of [{ provider: 'gemini', id: '' }, { provider: 'gemini', model: 4 }, { provider: 'gemini', style: '' }, { provider: 'gemini', key: 'secret' }]) {
    assert.throws(() => normalizeConfig({ voice }), ProjectError);
  }
});

test('Gemini requests audio with the voice and style, and logs usage without secrets', async (t) => {
  const p = project(t, { provider: 'gemini', id: 'Puck', style: 'Say cheerfully' });
  p.config.speed = 1;
  p.config.pace = 1;
  setEnv(t, 'GEMINI_API_KEY', 'secret-test-key');
  const pcm = Buffer.alloc(6);
  pcm.writeInt16LE(-32768, 0);
  pcm.writeInt16LE(16384, 4);
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-tts:generateContent');
    assert.equal(opts.headers['x-goog-api-key'], 'secret-test-key');
    const body = JSON.parse(opts.body);
    assert.equal(body.contents[0].parts[0].text, 'Say cheerfully:\nHello.');
    assert.deepEqual(body.generationConfig.responseModalities, ['AUDIO']);
    assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');
    return audioResponse(pcm);
  });
  const audio = await geminiSpeech(p, 'first', 'Hello.');
  assert.equal(audio.sampling_rate, 24000);
  assert.deepEqual([...audio.audio], [-1, 0, 0.5]);
  const usage = geminiUsage(p);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].characters, 6);
  assert.equal(usage[0].voice_id, 'Puck');
  assert.equal(usage[0].tokens, 12);
  assert.ok(!JSON.stringify(usage).includes('secret-test-key'));
  assert.ok(!JSON.stringify(usage).includes('Hello'));
});

test('Gemini gives friendly errors without echoing the key', async (t) => {
  const p = project(t);
  setEnv(t, 'GEMINI_API_KEY', '');
  setEnv(t, 'GOOGLE_API_KEY', '');
  await assert.rejects(() => geminiSpeech(p, 'first', 'Hello.'), /Ask the user.*aistudio.*\.env/);
  process.env.GEMINI_API_KEY = 'secret-test-key';
  for (const [status, message] of [[403, /rejected the API key/], [404, /does not know the model/], [400, /could not make the voice/]]) {
    t.mock.method(globalThis, 'fetch', async () => new Response('secret-test-key', { status }));
    await assert.rejects(() => geminiSpeech(p, 'first', 'Hello.'), (e) => {
      assert.match(e.message, message);
      assert.ok(!e.message.includes('secret-test-key'));
      return true;
    });
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ candidates: [] })));
  await assert.rejects(() => geminiSpeech(p, 'first', 'Hello.'), /returned no audio/);
});

test('voices --gemini lists the prebuilt voices', async (t) => {
  let output = '';
  t.mock.method(process.stdout, 'write', (s) => { output += s; return true; });
  assert.equal(await main(['voices', '--gemini', '--json']), 0);
  const data = JSON.parse(output);
  assert.equal(data.voices.length, Object.keys(GEMINI_VOICES).length);
  assert.ok(data.voices.some((v) => v.id === 'Kore'));
});

test('whisper.cpp gives word times from an existing ggml model and downloads nothing', async (t) => {
  const { transcribeWords, asrModel } = await import('../src/models.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-whispercpp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const model = path.join(dir, 'ggml-small.en.bin');
  fs.writeFileSync(model, '');
  // A stand-in whisper-cli that checks its arguments and writes the JSON whisper.cpp writes.
  const bin = path.join(dir, 'whisper-cli');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const a = process.argv.slice(2);
const get = (f) => a[a.indexOf(f) + 1];
if (get('-m') !== ${JSON.stringify(model)} || get('-ml') !== '1' || !a.includes('-sow') || get('-l') !== 'en') process.exit(3);
require('fs').writeFileSync(get('-of') + '.json', JSON.stringify({ transcription: [
  { text: '', offsets: { from: 0, to: 30 } }, { text: ' Hello', offsets: { from: 30, to: 400 } },
  { text: ' [BLANK_AUDIO]', offsets: { from: 400, to: 500 } }, { text: ' world.', offsets: { from: 500, to: 900 } }] }));
`);
  fs.chmodSync(bin, 0o755);
  setEnv(t, 'EXPLAINROO_WHISPER_CPP_MODEL', model);
  setEnv(t, 'EXPLAINROO_WHISPER_CPP', bin);
  assert.equal(asrModel('en'), 'whisper.cpp:ggml-small.en.bin');
  const r = await transcribeWords(new Float32Array(1600), { language: 'en' });
  assert.equal(r.text, 'Hello world.');
  assert.deepEqual(r.words, [{ text: 'Hello', start: 0.03, end: 0.4 }, { text: 'world.', start: 0.5, end: 0.9 }]);
  process.env.EXPLAINROO_WHISPER_CPP_MODEL = path.join(dir, 'missing.bin');
  await assert.rejects(() => transcribeWords(new Float32Array(1600)), /does not exist/);
  process.env.EXPLAINROO_WHISPER_CPP_MODEL = model;
  process.env.EXPLAINROO_WHISPER_CPP = path.join(dir, 'nope');
  await assert.rejects(() => transcribeWords(new Float32Array(1600)), /was not found/);
});
