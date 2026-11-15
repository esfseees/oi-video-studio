// Launcher used by the double-click start files (macOS / Windows / Linux).
//   node scripts/start.js          -> this computer only
//   node scripts/start.js --lan    -> other computers on the same network can open it (asks for an access password)
//   node scripts/start.js --self-test -> run automated self-test and exit
// It checks what the site needs, then starts the server.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..'), WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const LAN = process.argv.includes('--lan'), SELFTEST = process.argv.includes('--self-test'), PORT = Number(process.env.PORT || 5178);
if (!WIN) process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].join(path.delimiter);
const say = s => console.log(s);
const ok = (cmd, args) => { try { return spawnSync(cmd, args, { stdio: 'ignore', timeout: 20000 }).status === 0; } catch (e) { return false; } };

function showFatalError(title, msg) {
  say('\n' + title + '\n' + msg);
  if (WIN) {
    try {
      const literal = value => "'" + value.replace(/'/g, "''") + "'";
      const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(${literal(msg)}, ${literal(title)}, 'OK', 'Error') | Out-Null`;
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { stdio: 'inherit' });
    } catch (e) { /* ignore if messagebox fails */ }
  }
}

function findFfmpeg() {
  if (!process.env.OIVS_DATA_DIR && fs.existsSync(path.join(ROOT, '..', 'runtime', WIN ? 'node.exe' : 'node'))) {
    process.env.OIVS_DATA_DIR = WIN
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'OIVideoStudio')
      : path.join(os.homedir(), 'Library', 'Application Support', 'OIVideoStudio');
  }
  if (process.env.OIVS_FFMPEG && fs.existsSync(process.env.OIVS_FFMPEG)) return process.env.OIVS_FFMPEG;
  const bundled = path.join(ROOT, '..', 'runtime', WIN ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(bundled)) { process.env.OIVS_FFMPEG = bundled; return bundled; }
  if (ok('ffmpeg', ['-version'])) return 'ffmpeg';
  return null;
}
function hasBrowser() {
  if (process.env.CHROME_PATH) return fs.existsSync(process.env.CHROME_PATH);
  const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const list = MAC ? ['/Applications/Google Chrome.app', '/Applications/Microsoft Edge.app', path.join(os.homedir(), 'Applications/Google Chrome.app')]
    : WIN ? pf.flatMap(d => [path.join(d, 'Google/Chrome/Application/chrome.exe'), path.join(d, 'Microsoft/Edge/Application/msedge.exe')])
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome', '/usr/bin/microsoft-edge'];
  return list.some(f => fs.existsSync(f));
}
function askHidden(prompt) {                                  // read a line without showing it
  return new Promise(resolve => {
    process.stdout.write(prompt);
    const stdin = process.stdin; let buf = '';
    if (!stdin.isTTY) { stdin.setEncoding('utf8'); stdin.once('data', d => resolve(String(d).split(/\r?\n/)[0])); return; }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const on = ch => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); return resolve(buf); }
        if (c === '\u0003') process.exit(1);
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on('data', on);
  });
}

(async () => {
  if (SELFTEST) {
    require('./selftest');
    return;
  }
  say('信奥讲解视频工坊 · 正在检查运行环境…');
  const serverFile = path.join(ROOT, 'server.js');
  if (!fs.existsSync(serverFile)) {
    showFatalError('信奥讲解视频工坊 - 启动失败', '找不到服务入口文件：' + serverFile + '\n请确认安装包已完整解压。');
    process.exit(1);
  }
  const miss = [];
  if (Number(process.versions.node.split('.')[0]) < 20) miss.push(['Node.js 20 或更新版本（当前是 ' + process.versions.node + '）', MAC ? 'brew install node' : 'https://nodejs.org 下载安装 LTS 版']);
  if (!findFfmpeg()) miss.push(['ffmpeg（合成视频用）', MAC ? 'brew install ffmpeg' : WIN ? 'winget install Gyan.FFmpeg（装完重新打开本窗口）' : 'sudo apt install ffmpeg']);
  if (!hasBrowser()) miss.push(['Google Chrome 或 Microsoft Edge 浏览器（画动画用）', 'https://www.google.cn/chrome/ 下载安装']);
  if (miss.length) {
    const lines = miss.map(([n, how], i) => `${i + 1}. ${n}\n   安装方法：${how}`).join('\n\n');
    showFatalError('信奥讲解视频工坊 - 缺少运行组件', '还缺少下面的软件，请装好后再重新启动：\n\n' + lines);
    if (MAC && miss.some(m => /^brew/.test(m[1]))) say('\n  提示：brew 是 macOS 的软件安装工具，没有的话先到 https://brew.sh 按首页说明安装。');
    process.exit(1);
  }

  if (LAN) {
    if (!process.env.ACCESS_PASSWORD) {
      say('\n局域网共享：同一网络里的其他电脑可以打开这个网站，并使用这台电脑上配置的 AI 模型。');
      const pw = (await askHidden('请设置访问密码（至少 6 位，输入时不显示）：')).trim();
      if (pw.length < 6) { say('密码太短，已取消启动。'); process.exit(1); }
      process.env.ACCESS_PASSWORD = pw;
    }
    process.env.HOST = '0.0.0.0';
  }

  const child = spawn(process.execPath, [serverFile], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: process.env });
  const openUrl = () => { if (!process.env.NO_OPEN) try { spawn(MAC ? 'open' : WIN ? 'cmd' : 'xdg-open', WIN ? ['/c', 'start', '', `http://127.0.0.1:${PORT}`] : [`http://127.0.0.1:${PORT}`], { stdio: 'ignore', detached: true }).unref(); } catch (e) { /* no browser opener */ } };
  child.on('message', m => {
    if (m !== 'ready') return;
    if (LAN) {
      const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
      say('\n把下面的地址和访问密码发给同事（需要在同一个网络里）：');
      ips.forEach(ip => say(`  http://${ip}:${PORT}`));
      if (!ips.length) say('  （没有找到局域网地址，请检查网络连接）');
      if (MAC) say('  如果 macOS 弹窗询问“是否允许 node 接受传入网络连接”，请点“允许”，否则同事打不开。');
      if (WIN) say('  如果 Windows 防火墙弹窗询问是否允许 Node.js 访问网络，请点“允许访问”。');
    }
    say('\n网站运行中。关闭这个窗口，网站就会停止。');
    openUrl();
  });
  child.on('error', error => {
    showFatalError('信奥讲解视频工坊 - 启动失败', error.message);
    process.exit(1);
  });
  child.on('exit', code => {
    if (code === 3) { openUrl(); process.exit(0); }
    if (code && code !== 0) {
      showFatalError('信奥讲解视频工坊 - 服务异常退出', '后台服务异常退出（错误码 ' + code + '）。请检查端口 ' + PORT + ' 是否被其他软件占用。');
    }
    process.exit(code || 0);
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill());
})().catch(error => {
  showFatalError('信奥讲解视频工坊 - 启动失败', error.message || String(error));
  process.exit(1);
});
