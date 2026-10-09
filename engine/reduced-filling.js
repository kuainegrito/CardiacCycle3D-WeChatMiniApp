// CC-42: redistribute a small share of passive filling from E to diastasis.
// This changes the volume curve itself, so flow, particles and 3D cavities
// share a single blood-volume balance. The amount is a teaching parameter.
export function reducedFillingFraction(
  normalized,
  referenceTime,
  schedule,
  baseline,
) {
  const rapid = baseline.phases[5],
    rest = baseline.phases[6];
  if (referenceTime < rapid.start || schedule[6].duration <= 0)
    return normalized;
  const { edv, esv, atrialKickMl, reducedFillingMl = 0 } = baseline.physiology;
  const passive = 1 - atrialKickMl / (edv - esv);
  const amount =
    Math.min(passive * 0.1, Math.max(0, reducedFillingMl / (edv - esv))) *
    Math.min(1, schedule[6].duration / (rest.end - rest.start));
  if (referenceTime < rest.start)
    return (normalized * (passive - amount)) / passive;
  const u = Math.max(
    0,
    Math.min(1, (referenceTime - rest.start) / (rest.end - rest.start)),
  );
  return passive - amount * (1 - u * u * (3 - 2 * u));
}
