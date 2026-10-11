// Local fallback clips use the same frequencies/envelopes as WebAudio.
// node tools/build-heart-sounds.mjs (no recording, network or external assets).
import { mkdir, writeFile } from "node:fs/promises";
import { SOUND_SPEC } from "../engine/heart-audio.js";
const rate = 24000;
await mkdir("assets/sounds", { recursive: true });
for (const [key, spec] of Object.entries(SOUND_SPEC)) {
  const samples = Math.ceil((spec.duration + 0.01) * rate);
  const out = Buffer.alloc(44 + samples * 2);
  out.write("RIFF", 0); out.writeUInt32LE(out.length - 8, 4);
  out.write("WAVEfmt ", 8); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const phase = t * spec.frequency;
    const wave = key === "murmur" ? 2 * (phase % 1) - 1 : Math.sin(2 * Math.PI * phase);
    const envelope = t >= spec.duration ? 0 : t < 0.008
      ? 0.0001 * Math.pow(spec.level / 0.0001, t / 0.008)
      : spec.level * Math.pow(0.0001 / spec.level, (t - 0.008) / (spec.duration - 0.008));
    out.writeInt16LE(Math.round(wave * envelope * 32767), 44 + i * 2);
  }
  await writeFile(`assets/sounds/${key}.wav`, out);
}
