/** Pressure-gradient logic is intentionally stateless: a seek has the same result as playback. */
export const VALVE_CONNECTIONS = Object.freeze({mitral:['la','lv'],tricuspid:['ra','rv'],aortic:['lv','ao'],pulmonary:['rv','pa']});
export function valveStates(pressures, pressureAt, t, patch={}, rampMs=15) {
  const history=Array.from({length:15},(_,i)=>pressureAt(t-i*rampMs/15));
  return Object.fromEntries(Object.entries(VALVE_CONNECTIONS).map(([id,[up,down]])=>{
    const gradient=pressures[up]-pressures[down], open=gradient>1e-6;
    let blend=0;
    // Finite look-back is time-derived, so pause/scrub never leaves stale leaflets.
    for(const p of history) { if(p[up]>p[down]+1e-6) blend+=1/15; }
    let conductance=1, maxOpening=1, orifice=1;
    if(id==='aortic'&&patch.stenosis){
      conductance=1/(1+4*patch.stenosis);
      // A stenotic valve still opens and closes on the same gradient timing,
      // but its leaflets only reach part of the full excursion (maxOpening)
      // and the effective lumen narrows further (orifice: continuity makes the
      // jet through it faster — the high-pressure ejection of AS).
      maxOpening=1/(1+1.2*patch.stenosis);
      orifice=1/(1+2*patch.stenosis);
    }
    const incompetent=patch.regurgitation===id;
    const reverse=incompetent&&gradient<0;
    const flow=open?Math.sqrt(gradient)*conductance:reverse?-Math.sqrt(-gradient)*(patch.regurgitantFraction??.3):0;
    return [id,{open,blend:Math.min(1,blend),gradient,flow,regurgitant:reverse,velocity:Math.abs(flow),conductance,maxOpening,orifice}];
  }));
}
