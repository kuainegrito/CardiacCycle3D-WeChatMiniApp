/** The only animation clock. Audio, scenes and charts read its sampled state. */
export class MasterClock {
 constructor(model,{hr=75,speed=.5,playing=false,loop=true}={}) { this.model=model;this.hr=hr;this.speed=speed;this.playing=playing;this.loop=loop;this.t=0;this.beatIndex=0;this.lastNow=null;this.elapsed=0; }
 update(now) {
  if(this.lastNow===null) this.lastNow=now;
  const dt=Math.max(0,Math.min(250,now-this.lastNow));this.lastNow=now;
  return this.advance(dt);
 }
 advance(dt) {
  if (!Number.isFinite(dt) || dt < 0) throw Error('Invalid clock interval');
  if(this.playing){this.t+=dt*this.speed;this.elapsed+=dt*this.speed;
   let T=this.model.cycleDuration(this.hr,this.beatIndex);
   while(this.t>=T){if(!this.loop){this.t=T-.001;this.playing=false;break;}this.t-=T;this.beatIndex++;T=this.model.cycleDuration(this.hr,this.beatIndex);}
  }
  return this.t;
 }
 seek(t){this.t=Math.max(0,Math.min(this.model.cycleDuration(this.hr,this.beatIndex)-.001,Number(t)||0));this.lastNow=null;return this.t;}
 setHR(hr){const fraction=this.t/this.model.cycleDuration(this.hr,this.beatIndex);this.hr=Math.max(40,Math.min(180,Number(hr)||75));this.t=fraction*this.model.cycleDuration(this.hr,this.beatIndex);this.lastNow=null;}
 stepPhase(direction=1){const list=this.model.phaseSchedule(this.hr,this.beatIndex).filter(p=>p.end-p.start>.01);let i=list.findIndex(p=>this.t>=p.start&&this.t<p.end);i=(i+direction+list.length)%list.length;this.seek(list[i].start);return this.t;}
 reset(model=this.model){this.model=model;this.t=0;this.beatIndex=0;this.elapsed=0;this.lastNow=null;}
}
