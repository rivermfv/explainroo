// Local speech models: Kokoro for the voice, Whisper for word timing and checks.
// Both run on the CPU through ONNX Runtime and are downloaded from Hugging Face
// on first use into ~/.cache/explainroo/models (or $EXPLAINROO_CACHE/models).
// With EXPLAINROO_WHISPER_CPP_MODEL set to a ggml model file, the speech check
// runs through whisper.cpp's whisper-cli instead and downloads nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { writeWav } from './wav.js';

export const TTS_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const ASR_MODEL = 'onnx-community/whisper-base.en_timestamped';
export const MULTILINGUAL_ASR_MODEL = 'onnx-community/whisper-small_timestamped';
export const TTS_SAMPLE_RATE = 24000;

export const LANGUAGES = {
  en: 'af_heart', es: 'ef_dora', fr: 'ff_siwis', it: 'if_sara', 'pt-br': 'pf_dora', hi: 'hf_alpha', ja: 'jf_alpha', zh: 'zf_xiaobei',
};

export function voiceLanguage(id) {
  return { a: 'en', b: 'en', e: 'es', f: 'fr', i: 'it', p: 'pt-br', h: 'hi', j: 'ja', z: 'zh' }[id[0]];
}

export function asrModel(language = 'en') {
  const cpp = whisperCppModel();
  if (cpp) return `whisper.cpp:${path.basename(cpp)}`;
  return language === 'en' ? ASR_MODEL : MULTILINGUAL_ASR_MODEL;
}

export function whisperCppModel() {
  return process.env.EXPLAINROO_WHISPER_CPP_MODEL || null;
}

export function whisperCppBin() {
  return process.env.EXPLAINROO_WHISPER_CPP || 'whisper-cli';
}

function runWhisperCpp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(whisperCppBin(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', () => reject(new Error(`${whisperCppBin()} was not found. Install whisper.cpp (brew install whisper-cpp) or set EXPLAINROO_WHISPER_CPP to its whisper-cli.`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`whisper-cli failed (exit ${code}): ${err.trim().split('\n').pop()}`))));
  });
}

// One segment per word (-ml 1 -sow) gives word times in milliseconds.
async function transcribeWithWhisperCpp(samples, language) {
  const model = whisperCppModel();
  if (!fs.existsSync(model)) throw new Error(`EXPLAINROO_WHISPER_CPP_MODEL points to ${model}, which does not exist.`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-whisper-'));
  try {
    const wav = path.join(dir, 'speech.wav');
    writeWav(wav, samples, 16000);
    await runWhisperCpp(['-m', model, '-f', wav, '-ml', '1', '-sow', '-oj', '-of', path.join(dir, 'out'), '-np',
      '-l', language === 'pt-br' ? 'pt' : language]);
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
    const words = (data.transcription || []).map((w) => ({ text: w.text.trim(), start: w.offsets.from / 1000, end: w.offsets.to / 1000 }))
      .filter((w) => w.text && !/^\[.*\]$/.test(w.text));
    return { text: words.map((w) => w.text).join(' '), words };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function cacheRoot() {
  return process.env.EXPLAINROO_CACHE || path.join(os.homedir(), '.cache', 'explainroo');
}

export function ttsDtype() {
  const d = process.env.EXPLAINROO_TTS_DTYPE || 'fp32';
  if (!['fp32', 'fp16', 'q8', 'q4', 'q4f16'].includes(d)) throw new Error(`EXPLAINROO_TTS_DTYPE must be fp32, fp16, q8, q4 or q4f16, not "${d}"`);
  return d;
}

let transformers = null;
async function lib() {
  if (!transformers) {
    transformers = await import('@huggingface/transformers');
    transformers.env.cacheDir = path.join(cacheRoot(), 'models');
    transformers.env.allowRemoteModels = process.env.EXPLAINROO_OFFLINE !== '1';
  }
  return transformers;
}

function progressLogger(label, log) {
  if (!log) return undefined;
  const files = new Map();
  let last = 0;
  return (p) => {
    if (p.status === 'progress' && p.total > 5e6 && p.loaded < p.total) {
      files.set(p.file, { loaded: p.loaded, total: p.total });
      const now = Date.now();
      if (now - last < 1500) return;
      last = now;
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      log(`downloading ${label}: ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`);
    }
  };
}

let ttsPromise = null;
export function loadTTS({ log } = {}) {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      await lib();
      const { KokoroTTS } = await import('kokoro-js');
      return KokoroTTS.from_pretrained(TTS_MODEL, {
        dtype: ttsDtype(),
        device: 'cpu',
        progress_callback: progressLogger('voice model', log),
      });
    })();
  }
  return ttsPromise;
}

const asrPromises = new Map();
export function loadASR({ log, language = 'en' } = {}) {
  const model = asrModel(language);
  if (!asrPromises.has(model)) {
    asrPromises.set(model, (async () => {
      const { pipeline } = await lib();
      return pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        progress_callback: progressLogger('speech check model', log),
      });
    })());
  }
  return asrPromises.get(model);
}

// samples: Float32Array at 16 kHz. Returns [{ text, start, end }].
export async function transcribeWords(samples, { log, language = 'en' } = {}) {
  if (whisperCppModel()) return transcribeWithWhisperCpp(samples, language);
  const asr = await loadASR({ log, language });
  const r = await asr(samples, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5,
    ...(language === 'en' ? {} : { language: language === 'pt-br' ? 'pt' : language, task: 'transcribe' }),
  });
  return {
    text: (r.text || '').trim(),
    words: (r.chunks || []).map((c) => ({ text: c.text.trim(), start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? c.timestamp[0] ?? 0 })),
  };
}

// Kokoro v1.0 voices for the supported languages.
export const VOICES = {
  af_heart: 'American English, female (default)',
  af_bella: 'American English, female',
  af_nicole: 'American English, female',
  af_aoede: 'American English, female',
  af_kore: 'American English, female',
  af_sarah: 'American English, female',
  af_nova: 'American English, female',
  af_sky: 'American English, female',
  af_alloy: 'American English, female',
  af_jessica: 'American English, female',
  af_river: 'American English, female',
  am_michael: 'American English, male',
  am_fenrir: 'American English, male',
  am_puck: 'American English, male',
  am_echo: 'American English, male',
  am_eric: 'American English, male',
  am_liam: 'American English, male',
  am_onyx: 'American English, male',
  am_adam: 'American English, male',
  am_santa: 'American English, male',
  bf_emma: 'British English, female',
  bf_isabella: 'British English, female',
  bf_alice: 'British English, female',
  bf_lily: 'British English, female',
  bm_george: 'British English, male',
  bm_fable: 'British English, male',
  bm_lewis: 'British English, male',
  bm_daniel: 'British English, male',
  ef_dora: 'Spanish, female (default)',
  em_alex: 'Spanish, male',
  em_santa: 'Spanish, male',
  ff_siwis: 'French, female (default)',
  if_sara: 'Italian, female (default)',
  im_nicola: 'Italian, male',
  pf_dora: 'Brazilian Portuguese, female (default)',
  pm_alex: 'Brazilian Portuguese, male',
  pm_santa: 'Brazilian Portuguese, male',
  hf_alpha: 'Hindi, female (default)',
  hf_beta: 'Hindi, female',
  hm_omega: 'Hindi, male',
  hm_psi: 'Hindi, male',
  jf_alpha: 'Japanese, female (default)',
  jf_gongitsune: 'Japanese, female',
  jf_nezumi: 'Japanese, female',
  jf_tebukuro: 'Japanese, female',
  jm_kumo: 'Japanese, male',
  zf_xiaobei: 'Mandarin Chinese, female (default)',
  zf_xiaoni: 'Mandarin Chinese, female',
  zf_xiaoxiao: 'Mandarin Chinese, female',
  zf_xiaoyi: 'Mandarin Chinese, female',
  zm_yunjian: 'Mandarin Chinese, male',
  zm_yunxi: 'Mandarin Chinese, male',
  zm_yunxia: 'Mandarin Chinese, male',
  zm_yunyang: 'Mandarin Chinese, male',
};
