// Automated self-test for OI Video Studio desktop & CLI builds.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WIN = process.platform === 'win32';
const FFMPEG = process.env.OIVS_FFMPEG || (fs.existsSync(path.join(ROOT, '..', 'runtime', WIN ? 'ffmpeg.exe' : 'ffmpeg')) ? path.join(ROOT, '..', 'runtime', WIN ? 'ffmpeg.exe' : 'ffmpeg') : 'ffmpeg');

(async () => {
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'oivs-selftest-'));
  const testPort = 15178 + Math.floor(Math.random() * 1000);
  const report = { ok: false, platform: process.platform, arch: process.arch, node: process.version, checks: {} };

  try {
    // 1. Check ffmpeg executable
    const ff = spawnSync(FFMPEG, ['-version'], { encoding: 'utf8', timeout: 10000 });
    if (ff.status !== 0) throw new Error('ffmpeg check failed: ' + (ff.stderr || ff.error));
    report.checks.ffmpeg = (ff.stdout.split('\n')[0] || 'ok').trim();

    // 2. Check storyboard normalize + builtin sample storyboard
    const SBD = require(path.join(ROOT, 'lib', 'storyboard'));
    const sampleSb = JSON.parse(fs.readFileSync(path.join(ROOT, 'builtin', 'demo_storyboard.json'), 'utf8'));
    const norm = SBD.normalize(sampleSb, { lang: 'cpp', codeLines: 30 });
    if (!norm || !norm.sb || norm.sentences < 3) throw new Error('storyboard normalize failed');
    report.checks.storyboardSentences = norm.sentences;

    // 3. Check server startup & HTTP API
    const env = { ...process.env, PORT: String(testPort), HOST: '127.0.0.1', OIVS_DATA_DIR: tmpData, OIVS_FFMPEG: FFMPEG, NO_OPEN: '1' };
    const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('server start timeout')), 10000);
      srv.on('message', m => { if (m === 'ready') { clearTimeout(t); resolve(); } });
      srv.on('exit', c => { clearTimeout(t); reject(new Error('server exited early: ' + c)); });
    });

    const apiState = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${testPort}/api/state`, res => {
        let b = ''; res.on('data', d => b += d);
        res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
    srv.kill();
    if (!apiState || !Array.isArray(apiState.voices) || !Array.isArray(apiState.characters)) throw new Error('/api/state invalid response');
    report.checks.apiState = { voices: apiState.voices.length, characters: apiState.characters.length };

    report.ok = true;
    console.log('SELFTEST_OK ' + JSON.stringify(report));
    try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch (e) {}
    process.exit(0);
  } catch (e) {
    report.error = String(e.message || e);
    console.error('SELFTEST_FAILED ' + JSON.stringify(report));
    try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch (e2) {}
    process.exit(1);
  }
})();
