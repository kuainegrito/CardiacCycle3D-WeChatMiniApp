// The mini program's js/engine/av-chord-runtime.js: tools/build-vendor.mjs
// bundles this wrapper in place of the website's file, which it imports and
// re-exports unchanged, except that while the chordae are inactive
// (tools/chord-gate.js) their tubes are hidden and not rewritten.
import {
  updateAvChords as updateChords,
  writeCableGeometry as writeCable,
} from "@web/js/engine/av-chord-runtime.js";
import { chords } from "./chord-gate.js";

export * from "@web/js/engine/av-chord-runtime.js";

// Each heart's chord tubes hidden by the gate, with their own visibility.
const hidden = new WeakMap();

export function updateAvChords(preview) {
  if (!chords.active) {
    if (!hidden.has(preview)) {
      // Branch tubes follow their parent's visibility (mitral-chord-branches.js).
      hidden.set(preview, preview.attachments.map(({ line }) => [line, line.visible]));
      for (const { line } of preview.attachments) line.visible = false;
    }
    return;
  }
  for (const [line, visible] of hidden.get(preview) ?? []) line.visible = visible;
  hidden.delete(preview);
  return updateChords(preview);
}

export function writeCableGeometry(...args) {
  if (chords.active) return writeCable(...args);
}
