---
name: explainroo
description: Make an explainer video (MP4) with a voice-over using explainroo. The voice-over is made on this computer with Kokoro, and the word timing with the local whisper.cpp, so no API key is needed. Use when the user asks for an explainer, how-to, walkthrough, launch or tutorial video, an animated diagram with a voice-over, or a short for YouTube, Reels or TikTok.
---

# Make an explainer video with explainroo

explainroo makes an MP4 video from two files: a script with the words the
voice says, and a small JavaScript file that draws the pictures. Kokoro,
a voice model on this computer, reads the script aloud. explainroo writes down when each
word is spoken, Chrome draws the frames, and explainroo adds music and sound
effects.

## Find or install explainroo

Try these first:

```bash
command -v explainroo
ls "${EXPLAINROO_HOME:-$HOME/.explainroo}/bin/explainroo.js"
```

If neither exists, install it. It needs Node.js 20.11 or newer, ffmpeg, and
Chrome or Chromium.

```bash
git clone https://github.com/rivermfv/explainroo.git "$HOME/.explainroo"
cd "$HOME/.explainroo" && npm install
node bin/explainroo.js doctor
```

Do not run `doctor --fetch`. It also downloads a Whisper model, which this
setup does not need. The speech check uses whisper.cpp and the ggml model
already on this computer. The first `voice` run downloads the Kokoro voice
model once, about 330 MB from huggingface.co, into `~/.cache/explainroo`.
After that it runs offline. Check that both are set up:

```bash
command -v whisper-cli && echo "${EXPLAINROO_WHISPER_CPP_MODEL:-unset}"
```

If `EXPLAINROO_WHISPER_CPP_MODEL` is unset or `whisper-cli` is missing, stop
and ask the user. Never let explainroo download speech models on its own.

In the rest of this file, `explainroo` means whichever one you found: the
`explainroo` command, or `node "$HOME/.explainroo/bin/explainroo.js"`.

## Read AGENTS.md

`AGENTS.md` in the explainroo folder has the steps, the writing rules, the
settings and the Scene API, which is the list of everything `scenes.js` can
draw. Read it before you start.

## Make the video

Create the project where the user wants it, for example `./video`:

```bash
explainroo init video --theme paper --title "..."
```

## The voice

Use Kokoro, the default. Leave `voice` out of `video/video.json`, or pick
another Kokoro voice from `explainroo voices`, for example
`"voice": "am_michael"`. Kokoro speaks English, Spanish, French, Italian,
Brazilian Portuguese, Hindi, Japanese and Chinese, not Vietnamese. For
another language, set `--language` on `init` and pick a voice of that
language. The speech check then needs a multilingual ggml model, one without
`.en` in its name.

Use Gemini or ElevenLabs only when the user asks for them. Both send the
script text to an outside service and need a key. See Voices in AGENTS.md.
Never print a key or put it in a commit.

## Two rules for every video

1. **No watermark, ever.** Keep `"watermark": false` in `video.json` (it is
   the default) and never set it to text. Do not add a logo, a site name or
   any other mark in a corner of the frame. Check `video.json` before you
   render.
2. **Show whole screens, not small crops.** Show screenshots and app screens
   full screen, so the viewer sees the whole page and where each part sits.
   Do not cut a screen into small pieces or crop it down to one field or
   button: a crop loses the context and is easy to get wrong. To point at a
   detail, keep the full screen and use `s.annotate`, `s.focus` or the
   camera to zoom in on it.

Then follow the steps in AGENTS.md. When the video is done, tell the user
where `video/out/video.mp4` is, how long it is, and what
`explainroo verify video` said.
