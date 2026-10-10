import {valveStates} from './valves.js';
import {conductionTiming,sampleConduction} from './conduction.js';
import {reducedFillingFraction} from './reduced-filling.js';
import {valsalvaRise,interatrialState} from './foramen-ovale.js';
export const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
export const modulo=(x,T)=>((x%T)+T)%T;
/** Periodic Catmull–Rom lookup, locally bounded to avoid overshooting flat volume limbs. */
export function lookup(table,t,period=table.periodMs??800){
 const data=table.samples??table,n=data.length,x=modulo(t,period)/period*n,i=Math.floor(x),f=x-i;
 const a=data[(i+n-1)%n],b=data[i%n],c=data[(i+1)%n],d=data[(i+2)%n];
 const v=.5*((2*b)+(-a+c)*f+(2*a-5*b+4*c-d)*f*f+(-a+3*b-3*c+d)*f*f*f);
 return clamp(v,Math.min(b,c),Math.max(b,c));
}
export function createModel(baseline,scenario={id:'normal',hr:75,patch:{}}){
 const patch=scenario.patch??{},ref=baseline.periodMs,phys=baseline.physiology;
 const lookupWave=(id,t)=>lookup(baseline.waveforms[id],t);
 const cycleDuration=(hr=scenario.hr??75,beatIndex=0)=>60000/clamp(hr,40,180)*(patch.rrSequence?.[modulo(beatIndex,patch.rrSequence.length)]??1);
 function phaseSchedule(hr=scenario.hr??75,beatIndex=0){
  const T=cycleDuration(hr,beatIndex),s=Math.sqrt(T/ref),atrial=100*T/ref,relax=60*s;
  // Very short AF intervals can exceed the nominal HR slider rate. Preserve a
  // positive filling window there rather than returning a schedule longer than RR.
  const systole=Math.min(350*s,T-atrial-relax-Math.min(20,T*.06));
  const remaining=Math.max(0,T-atrial-systole-relax),rapid=Math.min(140*s,remaining),rest=remaining-rapid;
  const durations=[atrial,systole/7,systole*12/35,systole*18/35,relax,rapid,rest];
  let start=0;
  return baseline.phases.map((phase,i)=>{const p={...phase,index:i,start,end:start+durations[i],duration:durations[i]};start=p.end;return p;});
 }
 function mappedTime(t,hr,beatIndex){const schedule=phaseSchedule(hr,beatIndex),T=cycleDuration(hr,beatIndex),time=modulo(t,T);let index=schedule.findIndex(p=>time>=p.start&&time<p.end);if(index<0)index=0;const p=schedule[index],r=baseline.phases[index];return {referenceTime:r.start+(time-p.start)/(p.duration||1)*(r.end-r.start),phaseIndex:index,phase:p,T,t:time,schedule};}
 function absoluteBeatStart(hr,beatIndex){const seq=patch.rrSequence;if(!seq)return beatIndex*cycleDuration(hr,0);const rounds=Math.floor(beatIndex/seq.length),tail=modulo(beatIndex,seq.length);return 60000/clamp(hr,40,180)*(rounds*seq.reduce((a,b)=>a+b,0)+seq.slice(0,tail).reduce((a,b)=>a+b,0));}
 function pressureVolume(t,hr,modifiers,beatIndex){
  const m=mappedTime(t,hr,beatIndex),r=m.referenceTime;
  const timing=conductionTiming(baseline,patch,m.T,m.schedule[0].end),absolute=absoluteBeatStart(hr,beatIndex)+m.t;
  const atrialStart=timing.saStart+80*timing.atrialScale;
  const atrialDuration=Math.max(1,Math.min(100*timing.atrialScale,m.schedule[0].end-atrialStart));
  // Place organized atrial mechanics after its electrical activation, including
  // an atrial contraction that begins near the end of the preceding display RR.
  const organizedAge=m.t<m.schedule[0].end?m.t-atrialStart:
   atrialStart<0&&m.t>=m.T+atrialStart?m.t-m.T-atrialStart:-1;
  const atrialFraction=organizedAge<0?0:clamp(organizedAge/atrialDuration,0,1);
  const kickFraction=atrialFraction*atrialFraction*(3-2*atrialFraction);
  const preload=clamp(modifiers.preload??1,.7,1.4),afterload=clamp(modifiers.afterload??1,.7,1.5),contractility=clamp(modifiers.contractility??1,.6,1.6);
  const edv=(patch.edv??phys.edv)*preload;
  const esv=clamp((patch.esv??phys.esv)*afterload/contractility,20,edv-8);
  let normalized=(lookupWave('volume',r)-phys.esv)/(phys.edv-phys.esv);
  normalized=reducedFillingFraction(normalized,r,m.schedule,baseline);
  const removeKick=patch.atrialKick===0||patch.completeBlock;
  if(removeKick&&r<150)normalized=1;
  if(removeKick&&r>=510)normalized=clamp(normalized/(58/70),0,1);
  if(!removeKick&&(r<100||r>=510)){
   const passiveFraction=1-phys.atrialKickMl/(phys.edv-phys.esv);
   if(r<100)normalized=passiveFraction+(1-passiveFraction)*kickFraction;
   else normalized+=Math.min(1,normalized/passiveFraction)*(1-passiveFraction)*kickFraction;
  }
  if(patch.regurgitation==='mitral'){
   // Reverse leakage removes genuine isovolumetric limbs; total SV includes this loss.
   if(r>=100&&r<150)normalized=1-.07*(r-100)/50;
   else if(r>=150&&r<450)normalized=normalized*.89+.04;
   else if(r>=450&&r<510)normalized=.04*(1-(r-450)/60);
  }
  const sv=edv-esv,lvVolume=esv+sv*normalized;
  // The extra stenotic gradient starts/ends at the semilunar pressure crossings;
  // applying it during relaxation would falsely leave forward flow at ESV.
  const sys=lookupWave('murmurSystolic',r);
  const fillBoost=(patch.fillingPressure??0)+8*(preload-1);
  const pressures=Object.fromEntries(['ao','lv','la','rv','pa','ra'].map(key=>[key,lookupWave(key,r)]));
  // Matched compartment offsets preserve the measured gradient sign at valve events.
  const loadScale=afterload;
  pressures.ao=pressures.ao*loadScale+fillBoost;
  pressures.lv=pressures.lv*loadScale+fillBoost+(patch.lvSystolicBoost??0)*sys;
  pressures.la=pressures.la*loadScale+fillBoost;
  pressures.rv+=fillBoost*.35;pressures.ra+=fillBoost*.35;pressures.pa+=fillBoost*.35;
  if(patch.giantV) {
   pressures.la+=patch.giantV*lookupWave('vAugmentation',r);
   if(r>=450&&r<510) {
    // Maintain a closing gradient until the shared filling boundary. This is a
    // constrained pressure-table transform, not a claim of pressure integration.
    pressures.lv=Math.max(pressures.lv,pressures.la+(lookupWave('lv',r)-lookupWave('la',r))*loadScale);
   }
  }
  if(patch.atrialFibrillation){const aw=Math.max(0,(lookupWave('la',r)-10))*(r<100?1:0);pressures.la-=aw;pressures.ra-=aw*.5;if(r<100)pressures.lv=Math.min(pressures.lv,pressures.la-.1);}
  if(!patch.atrialFibrillation){
   const atrialAge=modulo(absolute-timing.saStart,timing.atrialPeriod);
   const aTime=patch.completeBlock?atrialAge/timing.atrialScale-80:organizedAge/atrialDuration*100;
   // Remove baseline organized a wave, then place it on its own atrial clock.
   const oldA=r<100?Math.max(0,lookupWave('la',r)-10):0;
   const newA=aTime>=0&&aTime<100?Math.max(0,lookupWave('la',aTime)-10):0;
   pressures.la+=(newA-oldA)*loadScale;pressures.ra+=(newA-oldA)*.5;
   // The transmitted ventricular a component moves with the atrial component.
   // Keeping their diastolic gradient avoids a closed valve during the kick.
   if(r<100){pressures.lv+=(newA-oldA)*loadScale;pressures.rv+=(newA-oldA)*.5;}
   if(patch.completeBlock&&pressures.lv>pressures.la)pressures.la+=newA*2;
  }
  // CC-48 PFO: a Valsalva-release beat lifts RA, RV and PA together (foramen-ovale.js).
  const release=valsalvaRise(patch,beatIndex,m.t,m.T);
  if(release){pressures.ra+=release;pressures.rv+=release;pressures.pa+=release;}
  return {...m,pressures,volume:{lv:lvVolume,rv:lvVolume},edv,esv,sv,ef:sv/edv*100,forwardSV:sv*(1-(patch.regurgitantFraction??0)),timing,absolute,modifiers:{preload,afterload,contractility}};
 }
 function sample(t,hr=scenario.hr??75,modifiers={},beatIndex=0){
  const state=pressureVolume(t,hr,modifiers,beatIndex),{referenceTime:r,T,t:time,timing}=state;
  const sinceRapid=modulo(time-timing.rapidQrsStart,T);
  const rapidDuration=timing.qrsDuration-(timing.rapidQrsStart-timing.qrsStart);
  const electricalRef=80+sinceRapid*90/rapidDuration;
  const sinceQrs=modulo(time-timing.qrsStart,T);
  const qtRef=80+sinceQrs*380/timing.qtMs;
  const pAge=modulo(state.absolute-timing.saStart,timing.atrialPeriod);
  const pRef=720+pAge/timing.atrialScale;
  let ecg=(sinceRapid<=rapidDuration?lookupWave('qrs',electricalRef):0)+(sinceQrs<=timing.qtMs?lookupWave('twave',qtRef):0);
  ecg+=patch.atrialFibrillation?lookupWave('afFibrillation',state.absolute):pAge<80*timing.atrialScale?lookupWave('p',pRef):0;
  if(patch.accessoryPathway&&sinceQrs<=60*timing.qrsScale)ecg+=lookupWave('delta',35+sinceQrs/timing.qrsScale);
  const recent=new Map(),pressureAt=at=>{let p=recent.get(at);if(!p){p=pressureVolume(at,hr,modifiers,beatIndex).pressures;recent.set(at,p);}return p;};
  const valves=valveStates(state.pressures,pressureAt,time,patch,phys.valveRampMs);
  // CC-48: the foramen-ovale flap shares the valves' pressure history.
  const interatrial=patch.pfo?interatrialState(state.pressures,Array.from({length:15},(_,i)=>pressureAt(time-i*phys.valveRampMs/15)),patch):null;
  const ap={};
  for(const [id,table]of Object.entries(baseline.actionPotentials)){
   const atrial=['sa','atrial','av'].includes(id),offset=atrial?{sa:0,atrial:35,av:50}[id]:{purkinje:0,ventricular:10}[id];
   const age=atrial?modulo(pAge-offset*timing.atrialScale,timing.atrialPeriod):modulo(time-timing.rapidQrsStart-offset*timing.qrsScale,T);
   let local=age/(atrial?timing.atrialScale:timing.rateScale);
   if(id==='sa'||id==='av')local=age/timing.atrialPeriod*800;
   ap[id]=patch.atrialFibrillation&&atrial?{sa:-55,atrial:-65,av:-50}[id]:lookup(table,Math.min(local,799.999));
  }
  const sounds={s1:lookupWave('s1',r),s2:lookupWave('s2',r),s3:lookupWave('s3',r)*(patch.s3??0),s4:lookupWave('s4',r)*(patch.s4??0),murmur:patch.murmur?lookupWave(patch.murmur==='ejection'?'murmurSystolic':'murmurHolosystolic',r)*.6:0};
  const conduction=sampleConduction(time,T,timing,patch,state.absolute);
  return {...state,ecg,ap,sounds,valves,...(interatrial&&{interatrial}),conduction,conductionTime:conduction.saRelative,scenarioId:scenario.id,erp:modulo(time-timing.qrsStart,T)<phys.ventricularErpMs*timing.rateScale,
   pv:{espvrSlope:2.2*(patch.contractility??1)*(modifiers.contractility??1),edpvrStiffness:.025,volumeIntercept:10},atrialKick:patch.atrialKick===0||patch.completeBlock?0:phys.atrialKickMl};
 }
 const model={baseline,scenario,patch,sample,cycleDuration,phaseSchedule,lookup:lookupWave,
  series:(hr=scenario.hr??75,modifiers={},beatIndex=0,count=400)=>Array.from({length:count},(_,i)=>sample(cycleDuration(hr,beatIndex)*i/count,hr,modifiers,beatIndex))};
 return model;
}
