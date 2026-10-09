const mod=(a,b)=>((a%b)+b)%b;
export function conductionTiming(baseline,patch,T,atrialEnd) {
 const rateScale=Math.sqrt(T/baseline.periodMs);
 const rapidQrsStart=atrialEnd-20*rateScale;
 const pr=(patch.prMs??baseline.physiology.prMs)*Math.max(.68,Math.min(1.1,rateScale));
 const branchDelay=(patch.branchDelayMs??0);
 const qrsScale=Math.max(.85,Math.min(1.08,rateScale));
 const accessoryAdvance=patch.accessoryPathway?(patch.accessoryAdvanceMs??45):0;
 const qrsStart=rapidQrsStart-accessoryAdvance*qrsScale;
 const baseQrs=(patch.escapeQrsMs??baseline.physiology.qrsMs+branchDelay)+accessoryAdvance;
 const qrsDuration=baseQrs*qrsScale;
 const saStart=qrsStart-pr;
 const atrialPeriod=patch.completeBlock?60000/(patch.atrialHR??75):T;
 const atrialScale=Math.max(.68,Math.min(1.1,Math.sqrt(atrialPeriod/baseline.periodMs)));
 return {qrsStart,rapidQrsStart,prMs:patch.completeBlock?null:pr,saStart,qrsDuration,qtMs:380*rateScale+accessoryAdvance*qrsScale,rateScale,branchDelay,atrialScale,qrsScale,baseQrs,activationOrigin:160-accessoryAdvance,
  atrialPeriod,accessoryStart:patch.accessoryPathway?qrsStart:null};
}
/** Bake this scalar into the mesh's aActivation attribute. x is normalized anatomical space. */
export function activationAt(position,chamber='lv',patch={}) {
 const p=Array.isArray(position)?{x:position[0],y:position[1],z:position[2]}:position;
 const longitudinal=Math.max(0,Math.min(1,((p.y??0)+1)/2)); // apex0 → base1
 const transmural=Math.max(0,Math.min(1,p.transmural??Math.abs(p.z??0)));
 if(chamber==='ra'||chamber==='la') return (chamber==='ra'?0:25)+(1-longitudinal)*55+transmural*10;
 const delay=(patch.block==='left'&&chamber==='lv'||patch.block==='right'&&chamber==='rv')?(patch.branchDelayMs??60):0;
 const ordinary=160+longitudinal*55+transmural*35+delay;
 const accessory=160-(patch.accessoryAdvanceMs??45)+(1-longitudinal)*55+transmural*35;
 return patch.accessoryPathway&&chamber==='lv'?Math.min(ordinary,accessory):ordinary;
}
export function repolarizationAt(position,chamber='lv',patch={}) {
 const p=Array.isArray(position)?{x:position[0],y:position[1],z:position[2]}:position;
 const transmural=Math.max(0,Math.min(1,p.transmural??Math.abs(p.z??0)));
 // Epi activates35ms later but APD shortens65ms → epi recovers30ms earlier.
 return activationAt(position,chamber,patch)+300-65*transmural;
}
export function sampleConduction(t,T,timing,patch={},absoluteTime=t) {
 const atrialTime=mod(absoluteTime-timing.saStart,timing.atrialPeriod);
 const ventricularTime=mod(t-timing.qrsStart,T);
 const saRelative=mod(t-timing.saStart,T);
 const shaderTime=timing.activationOrigin+(ventricularTime<=timing.qrsDuration?ventricularTime/timing.qrsScale:timing.baseQrs+(ventricularTime-timing.qrsDuration)/timing.rateScale);
 return {saRelative,atrialTime,ventricularTime,periodMs:T,qrsScale:timing.qrsScale,saStart:timing.saStart,qrsStart:timing.qrsStart,qrsDuration:timing.qrsDuration,prMs:timing.prMs,qtMs:timing.qtMs,
  shaderTime,shaderPeriod:timing.baseQrs+(T-timing.qrsDuration)/timing.rateScale,atrialShaderTime:atrialTime/timing.atrialScale,atrialShaderPeriod:timing.atrialPeriod/timing.atrialScale,
  rapidQrsStart:timing.rapidQrsStart,activationOrigin:timing.activationOrigin,
  avDelay:!patch.completeBlock&&!patch.atrialFibrillation&&atrialTime>=50*timing.atrialScale&&atrialTime<timing.prMs-20*timing.qrsScale,
  dissociated:!!patch.completeBlock,fibrillating:!!patch.atrialFibrillation,block:patch.block??null,leftDelay:patch.block==='left'?(patch.branchDelayMs??70):0,rightDelay:patch.block==='right'?(patch.branchDelayMs??60):0,
  accessory:!!patch.accessoryPathway,activationProgress:Math.min(1,ventricularTime/timing.qrsDuration),
  repolarizing:ventricularTime>200*timing.rateScale&&ventricularTime<timing.qtMs,
  repolarizationDirection:'epicardium → endocardium',rateScale:timing.rateScale};
}
/** Shader injection for a per-vertex SA-relative activation-time field in milliseconds. */
export const conductionShader = {
 vertexHeader:'attribute float aActivation; attribute float aRepolarization; varying float vActivation; varying float vRepolarization;',
 vertexMain:'vActivation = aActivation; vRepolarization = aRepolarization;',
 fragmentHeader:'uniform float uConductionTime; uniform float uCycleMs; uniform float uConductionScale; varying float vActivation; varying float vRepolarization;',
 fragmentMain:`float age=mod(uConductionTime-vActivation*uConductionScale+uCycleMs,uCycleMs);
 float recovery=(vRepolarization-vActivation)*uConductionScale;
 float excited=(1.0-smoothstep(recovery-35.0,recovery+15.0,age))*step(0.0,age);
 float front=exp(-age*age/90.0);
 diffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.0,0.65,0.18),excited*0.68)+vec3(1.0,0.9,0.35)*front*0.7;`
};
