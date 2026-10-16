---
name: explainroo
description: Make an explainer video (MP4) with a voice-over using explainroo. The voice-over is made with Google Gemini text to speech (GEMINI_API_KEY), or on this computer when there is no key. Use when the user asks for an explainer, how-to, walkthrough, launch or tutorial video, an animated diagram with a voice-over, or a short for YouTube, Reels or TikTok.
---

# Make an explainer video with explainroo

explainroo makes an MP4 video from two files: a script with the words the
voice says, and a small JavaScript file that draws the pictures. Gemini
reads the script aloud. explainroo writes down when each
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
node bin/explainroo.js doctor --fetch
```

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

## Use the Gemini voice

Before you run `explainroo voice`, set the voice in `video/video.json`:

```json
"voice": { "provider": "gemini", "id": "Kore" }
```

Pick a voice that fits the video with `explainroo voices --gemini`. Add a
short `"style"` such as `"Say in a calm, friendly tone"` when the tone
matters. Gemini needs `GEMINI_API_KEY` in the environment or in a `.env`
file. Check that it is set without printing it:

```bash
[ -n "$GEMINI_API_KEY" ] && echo set || grep -qs '^GEMINI_API_KEY=' video/.env "$HOME/.explainroo/.env" && echo set || echo missing
```

If it is missing, ask the user for a key from aistudio.google.com/apikey,
or ask whether to use the local Kokoro voice instead. Never print the key or
put it in a commit. Everything else, like the looks, captions, music, sizes
and other voices, works as AGENTS.md describes.

Then follow the steps in AGENTS.md. When the video is done, tell the user
where `video/out/video.mp4` is, how long it is, and what
`explainroo verify video` said.
