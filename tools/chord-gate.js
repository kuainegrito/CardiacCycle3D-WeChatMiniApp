// How much of the 3D heart's chordae tendineae is computed (the bundle's
// setChords, set by pages/lab/lab.js syncChords). They lie inside the
// ventricles: behind opaque walls, seen from outside the heart, they cannot
// be seen, and moving them was most of a motion step. While inactive their
// tubes are hidden and left as they are (tools/av-chord-runtime.js); the
// first step after reactivation shows and moves them again. Seating, which
// tapers each tube's end to its leaflet's clearance (tools/chord-insertions.js,
// about half of the chordae's cost), is a fraction of a millimetre: it is only
// done with the camera close to the heart, where it can be seen.
export const chords = { active: true, seat: true };

export function setChords({ active = chords.active, seat = chords.seat } = {}) {
  chords.active = !!active;
  chords.seat = !!seat;
}
