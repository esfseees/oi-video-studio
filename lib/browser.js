// Launch a headless browser: CHROME_PATH if given, else installed Chrome, then Edge.
const { chromium } = require('playwright-core');

async function launch() {
  const args = process.env.CHROME_NO_SANDBOX ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
  const tries = process.env.CHROME_PATH ? [{ executablePath: process.env.CHROME_PATH }] : [{ channel: 'chrome' }, { channel: 'msedge' }, {}];
  let last;
  for (const o of tries) { try { return await chromium.launch({ ...o, headless: true, args }); } catch (e) { last = e; } }
  throw new Error('找不到可用的 Chrome / Edge 浏览器，请先安装 Google Chrome：' + String(last.message).split('\n')[0]);
}

module.exports = { launch };
