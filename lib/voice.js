/**
 * Pure Node.js narration generator (zero Python dependency).
 * Usage: node lib/voice.js <jobDir> <voice> <fx 0|1> <rate> <pitch>
 * Progress lines on stdout: "TTS <done> <total>"
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tls = require('tls');
const { spawn } = require('child_process');

const [, , JOB, VOICE, FX_ARG, RATE, PITCH] = process.argv;
const USE_FX = FX_ARG === '1';
const FPS = 25;
const SR = 48000;
const SPF = Math.floor(SR / FPS);
const LEAD = 0.6, GAP = 0.4, SCENE_GAP = 0.9, TAIL = 1.6;
const MOUTH_WIN = 3;
const AUD = path.join(JOB, 'audio');
const FFMPEG = process.env.OIVS_FFMPEG || 'ffmpeg';

const TRIM = 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.02,areverse,' +
             'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.02,areverse';
const FX = "aresample=48000,asplit=2[dry][wet];" +
           "[wet]afftfilt=real='hypot(re,im)':imag='0':win_size=512:overlap=0.75,volume=1.15[rob];" +
           "[dry]volume=0.80[d];" +
           "[d][rob]amix=inputs=2:normalize=0,aecho=0.9:0.9:9:0.22,highpass=f=110,alimiter=limit=0.95";
const PLAIN = 'aresample=48000,highpass=f=80,alimiter=limit=0.95';

const BASE_HOST = 'speech.platform.bing.com';
const BASE_PATH = '/consumer/speech/synthesize/readaloud/edge/v1';
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;

// ---------- Edge TTS Sec-MS-GEC v2 DRM ----------
const SHA256_INITIAL = [
  0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
  0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
];
const SHA256_STATE = [
  0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A,
  0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2,
];
const SHA256_SCHEDULE = [
  0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA,
  0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6,
  0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33,
  0xD258B060, 0x72766564,
];
const SHA256_ROUND_CONSTANTS = [
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
];
const SHA256_ADJUSTMENT = 0xC9DC06A7;
const SHA256_BLOCK_CONSTANTS = SHA256_ROUND_CONSTANTS.slice();
SHA256_BLOCK_CONSTANTS[14] = SHA256_ADJUSTMENT;
const SHA256_SIGMA0_ADJUSTMENT = 0x059C0B80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000B92C0;

const CS64_COEFFICIENTS = [
  [0xE82E91B1, 0xB32700D0], [0x44DE24C6, 0x88DFF51D],
  [0x3BEB65BC, 0x29514038], [0xC89C5933, 0xB328CBDF],
  [0x8D1EC211, 0xD405B4D5], [0x314EF5D5, 0x26E55F3C],
  [0xE92491B1, 0x607801C6], [0xF0A5B9D5, 0x82B2C1FB],
  [0x06064CF3, 0xFA51A3DA], [0xDA79FA60, 0x207CC464],
  [0xBED20560, 0x3C3C74F3], [0x89F9C9F8, 0xD2D14B61],
  [0x35FA38C6, 0xBB04A2C1], [0xCB49E3C6, 0xC5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xF2F90B1A;
const CS64_ADJUSTMENT1 = 0x0B1A0000;

const u32 = x => (x >>> 0);
const imul = (a, b) => (Math.imul(a, b) >>> 0);
const rotr = (v, n) => (((v >>> n) | (v << (32 - n))) >>> 0);
const rol16 = v => (((v << 16) | (v >>> 16)) >>> 0);
const sigma0 = v => (rotr(v, 7) ^ rotr(v, 18) ^ (v >>> 3)) >>> 0;
const sigma1 = v => (rotr(v, 17) ^ rotr(v, 19) ^ (v >>> 10)) >>> 0;
const bigSigma0 = v => (rotr(v, 2) ^ rotr(v, 13) ^ rotr(v, 22)) >>> 0;
const bigSigma1 = v => (rotr(v, 6) ^ rotr(v, 11) ^ rotr(v, 25)) >>> 0;

let clockSkewSeconds = 0;

function sha256Rounds(state, words, firstRound = 0) {
  let [a, b, c, d, e, f, g, h] = state.map(u32);
  const constants = firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  for (let i = firstRound; i < 64; i++) {
    const t1 = u32(h + bigSigma1(e) + ((g ^ (e & (f ^ g))) >>> 0) + constants[i] + words[i]);
    const t2 = u32(bigSigma0(a) + (((a & b) | (c & (a | b))) >>> 0));
    h = g; g = f; f = e; e = u32(d + t1);
    d = c; c = b; b = a; a = u32(t1 + t2);
  }
  return [a, b, c, d, e, f, g, h];
}

function expandSha256Schedule(words, firstWord = 16) {
  for (let i = firstWord; i < 64; i++) {
    words[i] = u32(sigma1(words[i - 2]) + words[i - 7] + sigma0(words[i - 15]) + words[i - 16]);
  }
}

function sha256Init(data7) {
  const words = new Array(64).fill(0);
  words[14] = ((data7[0] << 16) | (data7[1] << 8) | data7[2]) >>> 0;
  words[15] = data7.readUInt32BE(3);
  for (let i = 16; i < 30; i++) {
    let val = SHA256_SCHEDULE[i - 16];
    if (i - 2 >= 14) val = u32(val + (i === 16 ? (sigma1(words[i - 2]) ^ SHA256_SIGMA1_ADJUSTMENT) : sigma1(words[i - 2])));
    if (i - 7 >= 14) val = u32(val + words[i - 7]);
    if (i - 15 >= 14) val = u32(val + (i === 29 ? (sigma0(words[i - 15]) ^ SHA256_SIGMA0_ADJUSTMENT) : sigma0(words[i - 15])));
    words[i] = u32(val);
  }
  words[30] = u32(sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + SHA256_ADJUSTMENT - SHA256_ROUND_CONSTANTS[14]);
  expandSha256Schedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((x, idx) => u32(x + working[idx]));
}

function sha256Digest(data) {
  const length = 57 + data.length;
  const rem = data.subarray(7);
  const padZeroLen = (((55 - length) % 64) + 64) % 64;
  const padded = Buffer.alloc(rem.length + 1 + padZeroLen + 8);
  rem.copy(padded, 0);
  padded[rem.length] = 0x80;
  padded.writeBigUInt64BE(BigInt(length) * 8n, padded.length - 8);
  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Array(64).fill(0);
    for (let j = 0; j < 16; j++) words[j] = padded.readUInt32BE(offset + j * 4);
    expandSha256Schedule(words, 16);
    const working = sha256Rounds(state, words, 0);
    state = state.map((x, idx) => u32(x + working[idx]));
  }
  const out = Buffer.alloc(32);
  state.forEach((v, idx) => out.writeUInt32BE(v, idx * 4));
  return out;
}

function wordsLe4Even(data) {
  const rem = (4 - (data.length % 4)) % 4;
  const padded = rem ? Buffer.concat([data, Buffer.alloc(rem)]) : data;
  const words = [];
  for (let i = 0; i < padded.length; i += 4) words.push(padded.readUInt32LE(i));
  if (words.length % 2 === 1) words.push(0);
  return words;
}

function cs64Digest(data, digest) {
  const keyA = (digest.readUInt32LE(0) | 1) >>> 0;
  const keyB = (digest.readUInt32LE(4) | 1) >>> 0;
  const factors = [imul(keyA, CS64_FACTOR), imul(keyB, CS64_FACTOR)];
  const terms = CS64_COEFFICIENTS.map(([c], idx) => imul(c, factors[idx % 2]));
  const offsets = CS64_COEFFICIENTS.map(([, o]) => u32(o));
  const dataWords = wordsLe4Even(Buffer.concat([Buffer.from([0]), data]));
  dataWords.forEach((word, index) => {
    let term = imul(word, index % 2 === 0 ? keyA : keyB);
    let offset = imul(rol16(word), index % 2 === 0 ? 0xEF0569FB : 0xC31713DB);
    if (index === 0) {
      term = u32(term + imul(CS64_ADJUSTMENT0, factors[0]));
      offset = u32(offset + CS64_ADJUSTMENT1);
    }
    terms.push(term);
    offsets.push(offset);
  });
  let swapAcc = 0, swapLast = 0, state = 0, acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1];
    let t = rol16(u32(offsets[i] + x));
    let q = imul(t, 0x76F50F34);
    swapAcc = u32(swapAcc + u32(imul(rol16(q), 0xC3EFEA97) + q));
    t = rol16(u32(offsets[i + 1] + y));
    q = imul(t, 0x1881CE3C);
    swapLast = u32(imul(rol16(q), 0x35BD1EC9) + q);
    swapAcc = u32(swapAcc + swapLast);

    state = u32(imul(state, keyA) + x);
    state = imul(rol16(state), 0xCF98B111);
    state = imul(rol16(state), 0x87085B9F);
    state = imul(rol16(state), 0x12CEB96D);
    state = imul(rol16(state), 0x257E1D83);
    acc = u32(acc + state);
    t = u32(imul(state, keyB) + y);
    t = imul(rol16(t), 0xA27416F5);
    t = imul(rol16(t), 0xD38396FF);
    state = imul(rol16(imul(rol16(t), 0x7C932B89)), 0xBFA49F69);
    acc = u32(acc + state);
  }
  return [u32(swapLast ^ state), u32(swapAcc ^ acc)];
}

function generateSecMsGec() {
  let ticks = (Date.now() / 1000) + clockSkewSeconds + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= S_TO_NS / 100;
  const data = Buffer.from(`${Math.round(ticks)}${TRUSTED_CLIENT_TOKEN}`, 'ascii');
  const digest = sha256Digest(data);
  const [c0, c1] = cs64Digest(data, digest);
  const csBuf = Buffer.alloc(8);
  csBuf.writeUInt32LE(c0, 0);
  csBuf.writeUInt32LE(c1, 4);
  return `${csBuf.toString('hex').toUpperCase()}-${digest.toString('hex').toUpperCase()}`;
}

function escapeXml(str) {
  return String(str)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function makeWsFrame(payload, opcode = 0x01) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const mask = crypto.randomBytes(4);
  let header;
  if (data.length < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | data.length;
    mask.copy(header, 2);
  } else if (data.length < 65536) {
    header = Buffer.alloc(8);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
    mask.copy(header, 4);
  } else {
    header = Buffer.alloc(14);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
    mask.copy(header, 10);
  }
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i & 3];
  return Buffer.concat([header, masked]);
}

function edgeTtsRequestOnce(text, voice, rate, pitch) {
  return new Promise((resolve, reject) => {
    const connId = crypto.randomUUID().replace(/-/g, '');
    const muid = crypto.randomBytes(16).toString('hex').toUpperCase();
    const wsKey = crypto.randomBytes(16).toString('base64');
    const gec = generateSecMsGec();
    const reqPath = `${BASE_PATH}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connId}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    const sock = tls.connect({ host: BASE_HOST, port: 443, servername: BASE_HOST });
    let settled = false;
    const done = (err, res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch (e) { /* ignore */ }
      if (err) reject(err); else resolve(res);
    };
    const timer = setTimeout(() => done(new Error('Edge TTS timeout')), 45000);

    let upgraded = false;
    let buf = Buffer.alloc(0);
    const audioChunks = [];
    let fragOpcode = 0;
    let fragChunks = [];

    sock.on('secureConnect', () => {
      const headers = [
        `GET ${reqPath} HTTP/1.1`,
        `Host: ${BASE_HOST}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Version: 13',
        'Pragma: no-cache',
        'Cache-Control: no-cache',
        'Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
        'Accept-Language: en-US,en;q=0.9',
        `Cookie: muid=${muid};`,
        '', ''
      ].join('\r\n');
      sock.write(headers);
    });

    const handleMessage = (opcode, msgBuf) => {
      if (opcode === 0x01) { // text
        const s = msgBuf.toString('utf8');
        if (s.includes('Path:turn.end')) {
          const out = Buffer.concat(audioChunks);
          if (out.length < 500) return done(new Error('Edge TTS returned empty audio'));
          return done(null, out);
        }
      } else if (opcode === 0x02) { // binary
        if (msgBuf.length < 2) return;
        const hlen = msgBuf.readUInt16BE(0);
        if (msgBuf.length < 2 + hlen) return;
        const head = msgBuf.subarray(2, 2 + hlen).toString('utf8');
        const body = msgBuf.subarray(2 + hlen);
        if (head.includes('Path:audio') && body.length > 0) {
          audioChunks.push(body);
        }
      } else if (opcode === 0x08) { // close
        const out = Buffer.concat(audioChunks);
        if (out.length > 1500) return done(null, out);
        return done(new Error('WebSocket closed before turn.end'));
      } else if (opcode === 0x09) { // ping
        sock.write(makeWsFrame(msgBuf, 0x0A));
      }
    };

    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx < 0) return;
        const headStr = buf.subarray(0, idx).toString('utf8');
        buf = buf.subarray(idx + 4);
        const statusLine = headStr.split('\r\n')[0] || '';
        if (!statusLine.includes('101')) {
          const m = /^Date:\s*(.+)$/mi.exec(headStr);
          if (m) {
            const srv = Date.parse(m[1]);
            if (!Number.isNaN(srv)) clockSkewSeconds = (srv - Date.now()) / 1000;
          }
          return done(new Error(`Handshake failed: ${statusLine}`));
        }
        upgraded = true;
        const nowStr = new Date().toUTCString();
        const cfgMsg =
          `X-Timestamp:${nowStr}\r\n` +
          'Content-Type:application/json; charset=utf-8\r\n' +
          'Path:speech.config\r\n\r\n' +
          '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';
        const ssml =
          `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
          `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;
        const reqId = crypto.randomUUID().replace(/-/g, '');
        const ssmlMsg =
          `X-RequestId:${reqId}\r\n` +
          'Content-Type:application/ssml+xml\r\n' +
          `X-Timestamp:${nowStr}Z\r\n` +
          'Path:ssml\r\n\r\n' +
          ssml;
        sock.write(makeWsFrame(cfgMsg, 0x01));
        sock.write(makeWsFrame(ssmlMsg, 0x01));
      }

      while (buf.length >= 2) {
        const b0 = buf[0], b1 = buf[1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          offset = 10;
        }
        const maskLen = masked ? 4 : 0;
        if (buf.length < offset + maskLen + len) return;
        let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
        if (masked) {
          const m = buf.subarray(offset, offset + 4);
          payload = Buffer.from(payload);
          for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3];
        }
        buf = buf.subarray(offset + maskLen + len);

        if (opcode === 0x00) {
          fragChunks.push(payload);
          if (fin) {
            handleMessage(fragOpcode, Buffer.concat(fragChunks));
            fragChunks = [];
            fragOpcode = 0;
          }
        } else if (opcode >= 0x08) {
          handleMessage(opcode, payload);
        } else if (!fin) {
          fragOpcode = opcode;
          fragChunks = [payload];
        } else {
          handleMessage(opcode, payload);
        }
      }
    });

    sock.on('error', err => done(err));
    sock.on('end', () => {
      if (!settled) {
        const out = Buffer.concat(audioChunks);
        if (out.length > 1500) done(null, out);
        else done(new Error('Socket ended unexpectedly'));
      }
    });
  });
}

function ff(...args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-y', '-v', 'error', ...args]);
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited ${code}`)));
  });
}

async function synth(i, text, doneCounter, total) {
  const num = String(i).padStart(3, '0');
  const raw = path.join(AUD, `raw_${num}.mp3`);
  const trim = path.join(AUD, `trim_${num}.wav`);
  const out = path.join(AUD, `fx_${num}.wav`);
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const mp3 = await edgeTtsRequestOnce(text, VOICE, RATE, PITCH);
      fs.writeFileSync(raw, mp3);
      if (mp3.length > 1500) { lastErr = null; break; }
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
  }
  if (lastErr) throw new Error(`配音失败（第 ${i + 1} 句）：${lastErr.message || lastErr}`);
  await ff('-i', raw, '-af', TRIM, '-ac', '1', trim);
  await ff('-i', trim, USE_FX ? '-filter_complex' : '-af', USE_FX ? FX : PLAIN, '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', out);
  doneCounter.count += 1;
  console.log(`TTS ${doneCounter.count} ${total}`);
}

function readWavPcm16(file) {
  const buf = fs.readFileSync(file);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.subarray(off, off + 4).toString('ascii');
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const dataBuf = buf.subarray(off + 8, off + 8 + sz);
      const samples = new Int16Array(Math.floor(dataBuf.length / 2));
      for (let i = 0; i < samples.length; i++) samples[i] = dataBuf.readInt16LE(i * 2);
      return samples;
    }
    off += 8 + sz + (sz % 2);
  }
  throw new Error('Invalid WAV file: ' + file);
}

function writeWavPcm16(file, samples, sampleRate) {
  const dataLen = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  const pcmBuf = Buffer.alloc(dataLen);
  for (let i = 0; i < samples.length; i++) pcmBuf.writeInt16LE(samples[i], i * 2);
  fs.writeFileSync(file, Buffer.concat([header, pcmBuf]));
}

function rms(arr, start, end) {
  const n = Math.min(arr.length, end) - start;
  if (n <= 0) return 0;
  let sum = 0;
  for (let i = start; i < start + n; i++) sum += arr[i] * arr[i];
  return Math.sqrt(sum / n);
}

function ts(t) {
  const hh = String(Math.floor(t / 3600)).padStart(2, '0');
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const ss = String(Math.floor(t % 60)).padStart(2, '0');
  const ms = String(Math.round((t % 1) * 1000) % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss},${ms}`;
}

async function main() {
  const sb = JSON.parse(fs.readFileSync(path.join(JOB, 'storyboard.json'), 'utf8'));
  const steps = [];
  sb.scenes.forEach((sc, si) => {
    (sc.steps || []).forEach(st => {
      steps.push({ text: st.say, tts: st.tts || st.say, scene: si });
    });
  });
  fs.mkdirSync(AUD, { recursive: true });
  const doneCounter = { count: 0 };
  const concurrency = 4;
  let idx = 0;
  async function worker() {
    while (idx < steps.length) {
      const i = idx++;
      await synth(i, steps[i].tts, doneCounter, steps.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, steps.length) }, () => worker()));

  const clips = steps.map((_, k) => readWavPcm16(path.join(AUD, `fx_${String(k).padStart(3, '0')}.wav`)));
  let totalSamples = 0;
  const meta = steps.map((st, k) => {
    const clip = clips[k];
    const leadN = k === 0 ? Math.round(LEAD * FPS) : 0;
    const last = k === steps.length - 1;
    const pause = last ? TAIL : (steps[k + 1].scene === st.scene ? GAP : SCENE_GAP);
    const speechN = Math.ceil(clip.length / SPF);
    const pauseN = Math.round(pause * FPS);
    const f0 = Math.floor(totalSamples / SPF);
    const segSamples = (leadN + speechN + pauseN) * SPF;
    totalSamples += segSamples;
    return { clip, leadN, speechN, pauseN, f0, segSamples };
  });

  const track = new Int16Array(totalSamples);
  const mouth = [];
  const outSteps = [];
  let writePos = 0;

  meta.forEach((m, k) => {
    const st = steps[k];
    const { clip, leadN, speechN, pauseN, f0, segSamples } = m;
    track.set(clip, writePos + leadN * SPF);
    writePos += segSamples;

    const winCount = Math.ceil(speechN / MOUTH_WIN);
    const wins = [];
    for (let i = 0; i < winCount; i++) {
      wins.push(rms(clip, i * SPF * MOUTH_WIN, (i + 1) * SPF * MOUTH_WIN));
    }
    const loud = wins.filter(w => w > 0).sort((a, b) => a - b);
    const thr = loud.length ? 0.55 * loud[Math.floor(loud.length / 2)] : 1e9;
    const states = [];
    let run = 0;
    for (const w of wins) {
      let o = w > thr ? 1 : 0;
      run = o ? run + 1 : 0;
      if (run > 2) { o = 0; run = 0; }
      states.push(o);
    }
    for (let i = 0; i < leadN; i++) mouth.push(0);
    for (let i = 0; i < speechN; i++) mouth.push(states[Math.floor(i / MOUTH_WIN)]);
    for (let i = 0; i < pauseN; i++) mouth.push(0);

    const s = (f0 + leadN) / FPS;
    outSteps.push({
      s: +s.toFixed(3),
      e: +(s + clip.length / SR).toFixed(3),
      n: +((f0 + leadN + speechN + pauseN) / FPS).toFixed(3),
      text: st.text,
      scene: st.scene,
    });
  });

  const totalFrames = Math.floor(track.length / SPF);
  writeWavPcm16(path.join(JOB, 'narration.wav'), track, SR);
  fs.writeFileSync(path.join(JOB, 'timeline.json'), JSON.stringify({ fps: FPS, frames: totalFrames, steps: outSteps, mouth }));
  const srtLines = outSteps.map((st, i) => `${i + 1}\n${ts(st.s)} --> ${ts(st.e)}\n${st.text}\n`).join('\n');
  fs.writeFileSync(path.join(JOB, 'subtitles.srt'), srtLines + '\n');
  console.log(`TIMELINE ${totalFrames} ${(totalFrames / FPS).toFixed(2)}`);
}

main().catch(e => {
  console.log('VOICE_FAILED', String(e.message || e));
  process.exit(1);
});
