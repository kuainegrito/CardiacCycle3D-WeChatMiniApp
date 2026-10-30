// Render the actual Mini App SvgPainter on a native Chrome 2D canvas.
// This checks drawing compatibility, not WeChat device performance.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.codex-work/rhythm2d-20261030');
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  if (route === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<body style="margin:0;background:#0b1625"><canvas id="heart" width="640" height="800" style="width:390px;height:488px"></canvas>'); }
  if (!/^\/(engine|data)\/[\w.-]+\.js$/.test(route)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(root, route)));
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 500 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const [{ Heart2DView }, { SvgElement }, { SvgPainter }, { createModel }, { default: baseline }, { default: scenarios }, { default: atrial }] = await Promise.all([
        import('/engine/heart2d.js'), import('/engine/mp-dom.js'), import('/engine/svg-canvas.js'), import('/engine/waveforms.js'),
        import('/data/baseline.js'), import('/data/scenarios.js'), import('/data/atrial-volume.js')]);
      const host = new SvgElement('div');
      const view = new Heart2DView(host, { language: 'zh', readJSON: async () => atrial });
      await view.init();
      const painter = new SvgPainter(host.children[0]);
      const ctx = document.querySelector('canvas').getContext('2d');
      window.renderMini = (id, t, beat = 2) => {
        const model = createModel(baseline, scenarios.find(s => s.id === (id === 'pvc' ? 'normal' : id)));
        if (id === 'pvc') { model.ectopy.stimulate(2, 380, 75); beat = 3; }
        const sample = model.sample(t, 75, {}, beat);
        view.update({ model, sample, t, hr: 75, beatIndex: beat, modifiers: {} });
        ctx.clearRect(0, 0, 640, 800);
        painter.paint(ctx, { x: 0, y: 0, w: 640, h: 800 }, 1);
        return { pixels: ctx.canvas.toDataURL(), cue: view.rhythmText.textContent };
      };
    });
    for (const id of ['af', 'vf', 'pvc']) {
      const t = id === 'pvc' ? 290 : 200;
      const first = await page.evaluate(({id,t}) => renderMini(id,t), {id,t});
      await page.screenshot({ path: path.join(out, `mini-${id}.png`) });
      const second = await page.evaluate(({id,t}) => renderMini(id,t+47), {id,t});
      assert.notEqual(first.pixels, second.pixels, id + ' moving canvas');
      assert.deepEqual(await page.evaluate(({id,t}) => renderMini(id,t), {id,t}), first);
      console.log(`Mini App native canvas passed: ${id}, two different frames and deterministic backward scrub; ${first.cue}`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
