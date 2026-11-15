// Frame renderer worker.
//   node lib/render.js <jobDir> --from 0 --to 500      -> <jobDir>/frames/%05d.jpg (end exclusive)
//   node lib/render.js <jobDir> --times 1.5,8,20       -> <jobDir>/preview/p_<t>.jpg
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { launch } = require('./browser');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

function loadData(jobDir) {
  const rd = f => fs.readFileSync(path.join(jobDir, f), 'utf8');
  const character = JSON.parse(rd('character.json'));
  if (character.file && fs.existsSync(character.file)) {
    const ext = path.extname(character.file).toLowerCase();
    character.src = `data:${MIME[ext] || 'image/png'};base64,` + fs.readFileSync(character.file).toString('base64');
  }
  return { storyboard: JSON.parse(rd('storyboard.json')), timeline: JSON.parse(rd('timeline.json')), code: rd('code.txt'), character };
}

(async () => {
  const jobDir = path.resolve(process.argv[2]);
  const data = loadData(jobDir);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'player', 'player.html')).href);
  const info = await page.evaluate(d => window.init(d), data);
  const shot = async (tt, file) => { await page.evaluate(x => window.renderAt(x), tt); await page.screenshot({ path: file, type: 'jpeg', quality: 93 }); };

  const times = arg('times');
  if (times) {
    const dir = path.join(jobDir, 'preview'); fs.mkdirSync(dir, { recursive: true });
    for (const s of times.split(',')) {
      let tt = Number(s);                                   // "k:f" = fraction f of sentence k
      if (s.includes(':')) { const [k, f] = s.split(':').map(Number); const st = data.timeline.steps[k]; tt = f <= 1 ? st.s + (st.e - st.s) * f : st.e + (f - 1); }
      await shot(tt, path.join(dir, `p_${s.replace(':', '_')}.jpg`));
    }
  } else {
    const from = Number(arg('from', 0)), to = Number(arg('to', data.timeline.frames));
    const dir = path.join(jobDir, 'frames'); fs.mkdirSync(dir, { recursive: true });
    for (let f = from; f < to; f++) await shot(f / data.timeline.fps, path.join(dir, String(f).padStart(5, '0') + '.jpg'));
  }
  const perr = await page.evaluate(() => window.playerErrors());
  const all = [...new Set([...errors, ...(info.errors || []), ...perr])];
  if (all.length) console.log('PLAYER_WARNINGS ' + JSON.stringify(all.slice(0, 12)));
  if (errors.length) process.exitCode = 2;
  await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]);   // close() can hang; never block exit
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('RENDER_FAILED ' + e.message); process.exit(1); });
