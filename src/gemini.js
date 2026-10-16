import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { findEnv } from './env.js';
import { ProjectError } from './project.js';
import { decodePCM } from './elevenlabs.js';
import { decodeRecording } from './recordings.js';
import { writeWav } from './wav.js';

// The prebuilt voices of the Gemini TTS models. Every voice speaks every
// language Gemini supports.
export const GEMINI_VOICES = {
  Zephyr: 'bright', Puck: 'upbeat', Charon: 'informative', Kore: 'firm', Fenrir: 'excitable',
  Leda: 'youthful', Orus: 'firm', Aoede: 'breezy', Callirrhoe: 'easy-going', Autonoe: 'bright',
  Enceladus: 'breathy', Iapetus: 'clear', Umbriel: 'easy-going', Algieba: 'smooth', Despina: 'smooth',
  Erinome: 'clear', Algenib: 'gravelly', Rasalgethi: 'informative', Laomedeia: 'upbeat', Achernar: 'soft',
  Alnilam: 'firm', Schedar: 'even', Gacrux: 'mature', Pulcherrima: 'forward', Achird: 'friendly',
  Zubenelgenubi: 'casual', Vindemiatrix: 'gentle', Sadachbia: 'lively', Sadaltager: 'knowledgeable', Sulafat: 'warm',
};

function apiKey(dir) {
  const key = findEnv('GEMINI_API_KEY', dir) || findEnv('GOOGLE_API_KEY', dir);
  if (!key) throw new ProjectError('Gemini needs an API key. Ask the user for one from aistudio.google.com/apikey, then set GEMINI_API_KEY or put GEMINI_API_KEY=... in a .env file in the project or explainroo folder.');
  return key;
}

async function request(model, key, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(180000), headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' } });
    } catch {
      throw new ProjectError('Gemini did not answer. Check your connection and try again.');
    }
    if (res.ok) return res;
    if (res.status === 401 || res.status === 403) throw new ProjectError('Gemini rejected the API key. Ask the user to check the key and that the Generative Language API is enabled.');
    if (res.status === 404) throw new ProjectError(`Gemini does not know the model "${model}". Check voice.model in video.json.`);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new ProjectError(res.status === 429 ? 'Gemini is rate limiting this key, or its quota is used up. Wait a minute and run voice again.'
      : res.status >= 500 ? 'Gemini is busy. Try again in a moment.'
        : 'Gemini could not make the voice. Check voice.id, voice.model and voice.style in video.json.');
  }
}

export function geminiUsage(project) {
  const file = path.join(project.paths.voice, 'gemini-usage.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}

export async function geminiSpeech(project, scene, text) {
  const key = apiKey(project.dir);
  const { voice, speed, pace } = project.config;
  // A style asks for a tone ("Say warmly:"). Gemini reads the style and speaks only the text after it.
  const prompt = voice.style ? `${voice.style.trim().replace(/:?$/, ':')}\n${text}` : text;
  const res = await request(voice.model, key, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.id } } } },
  });
  let data;
  try { data = await res.json(); }
  catch { throw new ProjectError('Gemini audio download failed. Check your connection and try again.'); }
  const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new ProjectError('Gemini returned no audio for this text. Try the voice command again, or simplify voice.style.');
  const entry = { time: new Date().toISOString(), scene, characters: [...text].length, model: voice.model, voice_id: voice.id,
    ...(data.usageMetadata ? { tokens: data.usageMetadata.totalTokenCount } : {}) };
  fs.mkdirSync(project.paths.voice, { recursive: true });
  fs.appendFileSync(path.join(project.paths.voice, 'gemini-usage.jsonl'), JSON.stringify(entry) + '\n');
  // Gemini sends 16-bit mono PCM at 24 kHz.
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
  let audio = decodePCM(Buffer.from(part.inlineData.data, 'base64'));
  if (speed * pace !== 1) {
    // Gemini has no speed setting, so change the tempo without changing pitch, like recordings.
    const dir = fs.mkdtempSync(path.join(project.paths.build, 'gemini-'));
    try {
      const wav = path.join(dir, 'speech.wav');
      writeWav(wav, audio, rate);
      audio = (await decodeRecording(wav, dir, speed * pace)).samples;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return { audio, sampling_rate: rate };
}
