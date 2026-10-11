import test from "node:test";
import assert from "node:assert/strict";
import { PlotResume } from "../engine/plot-resume.js";

function fixture() {
  let now = 0, resumes = 0;
  const tasks = new Map();
  let id = 0;
  const timers = {
    setTimeout(fn, delay) { tasks.set(++id, { fn, at: now + delay }); return id; },
    clearTimeout(key) { tasks.delete(key); },
  };
  const plot = new PlotResume(() => resumes++, timers);
  return { plot, get resumes() { return resumes; }, advance(ms) {
    now += ms;
    for (const [key, task] of tasks) if (task.at <= now) { tasks.delete(key); task.fn(); }
  } };
}

test("plot pause resumes exactly seven seconds after release, once", () => {
  const f = fixture();
  f.plot.begin(); f.plot.pause(true);
  f.advance(20000); assert.equal(f.resumes, 0);
  f.plot.end(); f.advance(6999); assert.equal(f.resumes, 0);
  f.advance(1); assert.equal(f.resumes, 1);
  f.advance(7000); assert.equal(f.resumes, 1);
});
test("repeated plot interactions reset the full inactivity interval", () => {
  const f = fixture();
  f.plot.begin(); f.plot.pause(true); f.plot.end(); f.advance(6000);
  f.plot.begin(); f.plot.pause(false); f.advance(10000);
  assert.equal(f.resumes, 0);
  f.plot.end(); f.advance(6999); assert.equal(f.resumes, 0);
  f.advance(1); assert.equal(f.resumes, 1);
});
test("manual pauses, explicit actions and lifecycle cancellation never auto-resume", () => {
  const f = fixture();
  f.plot.begin(); f.plot.pause(false); f.plot.end(); f.advance(7000);
  assert.equal(f.resumes, 0);
  f.plot.begin(); f.plot.pause(true); f.plot.end(); f.plot.cancel();
  f.advance(7000); assert.equal(f.resumes, 0);
});
