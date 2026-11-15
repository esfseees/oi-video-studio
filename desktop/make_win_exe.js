// Generates native Windows x64 GUI PE executables (.exe) with embedded multi-resolution ICO resources,
// pre-launch target file verification, and native MessageBoxW error dialogs instead of silent failure.
// Runs on macOS/Linux/Windows using pure Node.js.
const fs = require('fs');

function align(v, a) { return Math.ceil(v / a) * a; }

function parseIco(icoBuf) {
  const count = icoBuf.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    entries.push({
      w: icoBuf[off], h: icoBuf[off + 1], colors: icoBuf[off + 2], reserved: icoBuf[off + 3],
      planes: icoBuf.readUInt16LE(off + 4), bitCount: icoBuf.readUInt16LE(off + 6),
      bytesInRes: icoBuf.readUInt32LE(off + 8), imageOffset: icoBuf.readUInt32LE(off + 12),
      id: i + 1,
    });
  }
  return entries.map(e => ({ ...e, data: icoBuf.subarray(e.imageOffset, e.imageOffset + e.bytesInRes) }));
}

function buildRsrcSection(icoBuf, rsrcRva) {
  const icons = parseIco(icoBuf);
  const grp = Buffer.alloc(6 + icons.length * 14);
  grp.writeUInt16LE(0, 0);
  grp.writeUInt16LE(1, 2);
  grp.writeUInt16LE(icons.length, 4);
  icons.forEach((ic, idx) => {
    const o = 6 + idx * 14;
    grp[o] = ic.w; grp[o + 1] = ic.h; grp[o + 2] = ic.colors; grp[o + 3] = ic.reserved;
    grp.writeUInt16LE(ic.planes || 1, o + 4);
    grp.writeUInt16LE(ic.bitCount || 32, o + 6);
    grp.writeUInt32LE(ic.bytesInRes, o + 8);
    grp.writeUInt16LE(ic.id, o + 12);
  });

  const N = icons.length;
  const offRoot = 0;
  const offType3 = 32;
  const offType14 = offType3 + 16 + N * 8;
  const offLangStart = offType14 + 24;
  const offDataEntries = offLangStart + (N + 1) * 24;
  const offRawData = align(offDataEntries + (N + 1) * 16, 16);

  let rawCursor = offRawData;
  const rawChunks = [];
  const dataMeta = [];
  for (let i = 0; i < N; i++) {
    const d = icons[i].data;
    dataMeta.push({ rva: rsrcRva + rawCursor, size: d.length });
    rawChunks.push({ offset: rawCursor, buf: d });
    rawCursor = align(rawCursor + d.length, 8);
  }
  dataMeta.push({ rva: rsrcRva + rawCursor, size: grp.length });
  rawChunks.push({ offset: rawCursor, buf: grp });
  rawCursor = align(rawCursor + grp.length, 8);

  const buf = Buffer.alloc(rawCursor);

  buf.writeUInt16LE(0, offRoot + 12);
  buf.writeUInt16LE(2, offRoot + 14);
  buf.writeUInt32LE(3, offRoot + 16);
  buf.writeUInt32LE((0x80000000 | offType3) >>> 0, offRoot + 20);
  buf.writeUInt32LE(14, offRoot + 24);
  buf.writeUInt32LE((0x80000000 | offType14) >>> 0, offRoot + 28);

  buf.writeUInt16LE(0, offType3 + 12);
  buf.writeUInt16LE(N, offType3 + 14);
  for (let i = 0; i < N; i++) {
    const langOff = offLangStart + i * 24;
    buf.writeUInt32LE(i + 1, offType3 + 16 + i * 8);
    buf.writeUInt32LE((0x80000000 | langOff) >>> 0, offType3 + 20 + i * 8);
  }

  buf.writeUInt16LE(0, offType14 + 12);
  buf.writeUInt16LE(1, offType14 + 14);
  const grpLangOff = offLangStart + N * 24;
  buf.writeUInt32LE(1, offType14 + 16);
  buf.writeUInt32LE((0x80000000 | grpLangOff) >>> 0, offType14 + 20);

  for (let i = 0; i < N + 1; i++) {
    const lOff = offLangStart + i * 24;
    const dOff = offDataEntries + i * 16;
    buf.writeUInt16LE(0, lOff + 12);
    buf.writeUInt16LE(1, lOff + 14);
    buf.writeUInt32LE(1033, lOff + 16);
    buf.writeUInt32LE(dOff, lOff + 20);

    buf.writeUInt32LE(dataMeta[i].rva, dOff);
    buf.writeUInt32LE(dataMeta[i].size, dOff + 4);
    buf.writeUInt32LE(0, dOff + 8);
    buf.writeUInt32LE(0, dOff + 12);
  }

  for (const c of rawChunks) c.buf.copy(buf, c.offset);
  return buf;
}

// Build a 64-bit Windows GUI PE executable:
// - Checks required relative files before starting (via GetFileAttributesW) and pops up MessageBoxW if missing
// - Launches child process WITHOUT hiding errors, and pops up MessageBoxW if CreateProcessW fails
function buildWin64GuiExe({
  icoPath,
  cmdLineTemplate,
  outPath,
  mode = 'launcher',
  checkFiles = [],
  errTitle = '信奥讲解视频工坊 - 启动错误',
  errMissingMsg = '找不到核心运行文件（runtime\\node.exe 或 app\\scripts\\start.js），请确保压缩包已完整解压后再运行。',
  errLaunchMsg = '启动进程失败，请检查系统权限或杀毒软件拦截设置。',
  showConsole = true,
}) {
  const icoBuf = fs.readFileSync(icoPath);
  const FILE_ALIGN = 0x200;
  const SECT_ALIGN = 0x1000;

  const TEXT_RVA = 0x1000;
  const RDATA_RVA = 0x2000;

  if (cmdLineTemplate.length >= 32767) throw new Error('Windows command line exceeds 32767 UTF-16 code units');
  const cmdBytes = Buffer.from(cmdLineTemplate + '\0', 'utf16le');
  const titleBytes = Buffer.from(errTitle + '\0', 'utf16le');
  const missingBytes = Buffer.from(errMissingMsg + '\0', 'utf16le');
  const launchBytes = Buffer.from(errLaunchMsg + '\0', 'utf16le');
  const checkFileBuffers = checkFiles.map(f => Buffer.from(f + '\0', 'utf16le'));

  // Imports:
  // Descriptor 0: KERNEL32.dll (7 functions)
  //   0: GetModuleFileNameW
  //   1: SetCurrentDirectoryW
  //   2: SetEnvironmentVariableW
  //   3: GetFileAttributesW
  //   4: CreateProcessW
  //   5: WaitForSingleObject
  //   6: ExitProcess
  // Descriptor 1: USER32.dll (1 function)
  //   0: MessageBoxW
  const k32Fns = [
    'GetModuleFileNameW',
    'SetCurrentDirectoryW',
    'SetEnvironmentVariableW',
    'GetFileAttributesW',
    'CreateProcessW',
    'WaitForSingleObject',
    'ExitProcess',
  ];
  const u32Fns = ['MessageBoxW'];

  const rdata = Buffer.alloc(0x600 + cmdBytes.length + titleBytes.length + missingBytes.length + launchBytes.length + 512);
  // 3 Import descriptors (KERNEL32, USER32, NULL) -> 60 bytes at 0x00..0x3B
  const k32IltOff = 0x40;  // 8 * 8 = 64 bytes (0x40..0x7F)
  const u32IltOff = 0x80;  // 2 * 8 = 16 bytes (0x80..0x8F)
  const k32IatOff = 0xA0;  // 8 * 8 = 64 bytes (0xA0..0xDF)
  const u32IatOff = 0xE0;  // 2 * 8 = 16 bytes (0xE0..0xEF)
  const dllNamesOff = 0x100;

  // Descriptor 0: KERNEL32.dll
  rdata.writeUInt32LE(RDATA_RVA + k32IltOff, 0);
  rdata.writeUInt32LE(0, 4);
  rdata.writeUInt32LE(0, 8);
  rdata.writeUInt32LE(RDATA_RVA + dllNamesOff, 12);
  rdata.writeUInt32LE(RDATA_RVA + k32IatOff, 16);

  // Descriptor 1: USER32.dll
  rdata.writeUInt32LE(RDATA_RVA + u32IltOff, 20);
  rdata.writeUInt32LE(0, 24);
  rdata.writeUInt32LE(0, 28);
  rdata.writeUInt32LE(RDATA_RVA + dllNamesOff + 16, 32);
  rdata.writeUInt32LE(RDATA_RVA + u32IatOff, 36);

  rdata.write('KERNEL32.dll\0', dllNamesOff, 'ascii');
  rdata.write('USER32.dll\0', dllNamesOff + 16, 'ascii');

  let cursor = 0x130;
  for (let i = 0; i < k32Fns.length; i++) {
    const hn = cursor;
    rdata.writeUInt16LE(0, hn);
    rdata.write(k32Fns[i] + '\0', hn + 2, 'ascii');
    rdata.writeBigUInt64LE(BigInt(RDATA_RVA + hn), k32IltOff + i * 8);
    rdata.writeBigUInt64LE(BigInt(RDATA_RVA + hn), k32IatOff + i * 8);
    cursor = align(hn + 3 + k32Fns[i].length, 4);
  }
  for (let i = 0; i < u32Fns.length; i++) {
    const hn = cursor;
    rdata.writeUInt16LE(0, hn);
    rdata.write(u32Fns[i] + '\0', hn + 2, 'ascii');
    rdata.writeBigUInt64LE(BigInt(RDATA_RVA + hn), u32IltOff + i * 8);
    rdata.writeBigUInt64LE(BigInt(RDATA_RVA + hn), u32IatOff + i * 8);
    cursor = align(hn + 3 + u32Fns[i].length, 4);
  }

  const writeStr = buf => {
    cursor = align(cursor, 4);
    const off = cursor;
    buf.copy(rdata, off);
    cursor += buf.length;
    return off;
  };

  const envNameOff = writeStr(Buffer.from('OIVS_SETUP_EXE\0', 'utf16le'));
  const titleOff = writeStr(titleBytes);
  const missingOff = writeStr(missingBytes);
  const launchOff = writeStr(launchBytes);
  const checkFileOffs = checkFileBuffers.map(b => writeStr(b));
  const cmdOff = writeStr(cmdBytes);

  const rdataTrimmed = rdata.subarray(0, cursor);
  const rdataSize = align(rdataTrimmed.length, SECT_ALIGN);
  const RSRC_RVA = RDATA_RVA + rdataSize;

  // Assemble .text x86_64 machine code
  const code = [];
  const push = (...b) => code.push(...b);
  const pushU32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v, 0); push(...b); };
  const ripPatches = []; // { pos, len, targetRva }
  const rel32Jumps = []; // { pos, label }
  const labels = {};

  const callIat = iatTargetRva => {
    const pos = code.length;
    push(0xFF, 0x15, 0, 0, 0, 0);
    ripPatches.push({ pos, len: 6, targetRva: iatTargetRva });
  };
  const leaRipRcx = targetRva => {
    const pos = code.length;
    push(0x48, 0x8D, 0x0D, 0, 0, 0, 0);
    ripPatches.push({ pos, len: 7, targetRva });
  };
  const leaRipRdx = targetRva => {
    const pos = code.length;
    push(0x48, 0x8D, 0x15, 0, 0, 0, 0);
    ripPatches.push({ pos, len: 7, targetRva });
  };
  const leaRipRsi = targetRva => {
    const pos = code.length;
    push(0x48, 0x8D, 0x35, 0, 0, 0, 0);
    ripPatches.push({ pos, len: 7, targetRva });
  };
  const jeLabel = label => {
    const pos = code.length;
    push(0x0F, 0x84, 0, 0, 0, 0);
    rel32Jumps.push({ pos, len: 6, label });
  };

  const IAT_GetModuleFileNameW = RDATA_RVA + k32IatOff + 0;
  const IAT_SetCurrentDirectoryW = RDATA_RVA + k32IatOff + 8;
  const IAT_SetEnvironmentVariableW = RDATA_RVA + k32IatOff + 16;
  const IAT_GetFileAttributesW = RDATA_RVA + k32IatOff + 24;
  const IAT_CreateProcessW = RDATA_RVA + k32IatOff + 32;
  const IAT_WaitForSingleObject = RDATA_RVA + k32IatOff + 40;
  const IAT_ExitProcess = RDATA_RVA + k32IatOff + 48;
  const IAT_MessageBoxW = RDATA_RVA + u32IatOff + 0;

  // Keep the stack frame below one page; command data stays in writable .data.
  push(0x48, 0x81, 0xEC); pushU32(0x588);

  // Zero process structures and executable-path buffer.
  push(0x48, 0x8D, 0x7C, 0x24, 0x50);
  push(0x31, 0xC0);
  push(0xB9); pushU32(0x530);
  push(0xF3, 0xAA);

  // GetModuleFileNameW(NULL, &pathBuf [rsp+0xE0], 520)
  push(0x31, 0xC9);
  push(0x48, 0x8D, 0x94, 0x24); pushU32(0xE0);
  push(0x41, 0xB8); pushU32(520);
  callIat(IAT_GetModuleFileNameW);
  push(0x89, 0xC3); // mov ebx, eax

  // SetEnvironmentVariableW(L"OIVS_SETUP_EXE", &pathBuf [rsp+0xE0])
  leaRipRcx(RDATA_RVA + envNameOff);
  push(0x48, 0x8D, 0x94, 0x24); pushU32(0xE0);
  callIat(IAT_SetEnvironmentVariableW);

  // Strip last backslash in pathBuf
  push(0x89, 0xD8); // mov eax, ebx
  push(0x48, 0x8D, 0xB4, 0x24); pushU32(0xE0);
  const loopBackPos = code.length;
  push(0x85, 0xC0);
  push(0x74, 0x0F);
  push(0xFF, 0xC8);
  push(0x66, 0x83, 0x3C, 0x46, 0x5C);
  const jneRel = loopBackPos - (code.length + 2);
  push(0x75, jneRel & 0xFF);
  push(0x66, 0xC7, 0x04, 0x46, 0x00, 0x00);

  // SetCurrentDirectoryW(&pathBuf)
  push(0x48, 0x8D, 0x8C, 0x24); pushU32(0xE0);
  callIat(IAT_SetCurrentDirectoryW);

  // Verify each required relative file exists via GetFileAttributesW
  for (const off of checkFileOffs) {
    leaRipRcx(RDATA_RVA + off);
    callIat(IAT_GetFileAttributesW);
    // cmp eax, -1 (INVALID_FILE_ATTRIBUTES)
    push(0x83, 0xF8, 0xFF);
    jeLabel('err_missing');
  }

  // STARTUPINFOW.cb = 104
  push(0xC7, 0x44, 0x24, 0x70); pushU32(104);

  // CreateProcessW(NULL, writable command data, NULL, NULL, FALSE, creationFlags, NULL, NULL, &si, &pi)
  const creationFlags = showConsole ? 0x00000000 : 0x08000000;
  push(0x31, 0xC9);
  leaRipRdx(RDATA_RVA + cmdOff);
  push(0x45, 0x31, 0xC0);
  push(0x45, 0x31, 0xC9);
  push(0x48, 0xC7, 0x44, 0x24, 0x20, 0, 0, 0, 0);
  push(0x48, 0xC7, 0x44, 0x24, 0x28); pushU32(creationFlags);
  push(0x48, 0xC7, 0x44, 0x24, 0x30, 0, 0, 0, 0);
  push(0x48, 0xC7, 0x44, 0x24, 0x38, 0, 0, 0, 0);
  push(0x48, 0x8D, 0x44, 0x24, 0x70);
  push(0x48, 0x89, 0x44, 0x24, 0x40);
  push(0x48, 0x8D, 0x44, 0x24, 0x50);
  push(0x48, 0x89, 0x44, 0x24, 0x48);
  callIat(IAT_CreateProcessW);
  // test eax, eax; jz err_launch
  push(0x85, 0xC0);
  jeLabel('err_launch');

  if (mode === 'setup') {
    // WaitForSingleObject(pi.hProcess [rsp+0x50], INFINITE)
    push(0x48, 0x8B, 0x4C, 0x24, 0x50);
    push(0xBA, 0xFF, 0xFF, 0xFF, 0xFF);
    callIat(IAT_WaitForSingleObject);
  }

  // ExitProcess(0)
  push(0x31, 0xC9);
  callIat(IAT_ExitProcess);

  // Label: err_missing
  labels['err_missing'] = code.length;
  // MessageBoxW(NULL, errMissingMsg, errTitle, MB_OK | MB_ICONERROR (0x10))
  push(0x31, 0xC9);
  leaRipRdx(RDATA_RVA + missingOff);
  const posTitle1 = code.length;
  push(0x4C, 0x8D, 0x05, 0, 0, 0, 0); // lea r8, [rip + titleOff]
  ripPatches.push({ pos: posTitle1, len: 7, targetRva: RDATA_RVA + titleOff });
  push(0x41, 0xB9, 0x10, 0x00, 0x00, 0x00); // mov r9d, 0x10
  callIat(IAT_MessageBoxW);
  push(0xB9, 0x01, 0x00, 0x00, 0x00); // mov ecx, 1
  callIat(IAT_ExitProcess);

  // Label: err_launch
  labels['err_launch'] = code.length;
  push(0x31, 0xC9);
  leaRipRdx(RDATA_RVA + launchOff);
  const posTitle2 = code.length;
  push(0x4C, 0x8D, 0x05, 0, 0, 0, 0); // lea r8, [rip + titleOff]
  ripPatches.push({ pos: posTitle2, len: 7, targetRva: RDATA_RVA + titleOff });
  push(0x41, 0xB9, 0x10, 0x00, 0x00, 0x00); // mov r9d, 0x10
  callIat(IAT_MessageBoxW);
  push(0xB9, 0x01, 0x00, 0x00, 0x00);
  callIat(IAT_ExitProcess);

  const textBuf = Buffer.alloc(align(code.length, FILE_ALIGN));
  Buffer.from(code).copy(textBuf);

  for (const p of ripPatches) {
    const nextRip = TEXT_RVA + p.pos + p.len;
    textBuf.writeInt32LE(p.targetRva - nextRip, p.pos + p.len - 4);
  }
  for (const j of rel32Jumps) {
    const targetPos = labels[j.label];
    const nextPos = j.pos + j.len;
    textBuf.writeInt32LE(targetPos - nextPos, j.pos + j.len - 4);
  }

  const rsrcRaw = buildRsrcSection(icoBuf, RSRC_RVA);
  const rsrcBuf = Buffer.alloc(align(rsrcRaw.length, FILE_ALIGN));
  rsrcRaw.copy(rsrcBuf);

  const rdataBuf = Buffer.alloc(align(rdataTrimmed.length, FILE_ALIGN));
  rdataTrimmed.copy(rdataBuf);

  const rsrcVirtSize = rsrcRaw.length;
  const sizeOfImage = RSRC_RVA + align(rsrcVirtSize, SECT_ALIGN);

  const hdr = Buffer.alloc(0x400);
  hdr.write('MZ', 0, 'ascii');
  hdr.writeUInt32LE(0x80, 0x3C);

  const pe = 0x80;
  hdr.write('PE\0\0', pe, 'ascii');
  hdr.writeUInt16LE(0x8664, pe + 4);
  hdr.writeUInt16LE(3, pe + 6);
  hdr.writeUInt32LE(Math.floor(Date.now() / 1000), pe + 8);
  hdr.writeUInt16LE(0xF0, pe + 20);
  hdr.writeUInt16LE(0x0022, pe + 22);

  const opt = pe + 24;
  hdr.writeUInt16LE(0x020B, opt + 0);
  hdr[opt + 2] = 14;
  hdr.writeUInt32LE(textBuf.length, opt + 4);
  hdr.writeUInt32LE(rdataBuf.length + rsrcBuf.length, opt + 8);
  hdr.writeUInt32LE(TEXT_RVA, opt + 16);
  hdr.writeUInt32LE(TEXT_RVA, opt + 20);
  hdr.writeBigUInt64LE(0x140000000n, opt + 24);
  hdr.writeUInt32LE(SECT_ALIGN, opt + 32);
  hdr.writeUInt32LE(FILE_ALIGN, opt + 36);
  hdr.writeUInt16LE(6, opt + 40);
  hdr.writeUInt16LE(0, opt + 42);
  hdr.writeUInt16LE(6, opt + 48);
  hdr.writeUInt16LE(0, opt + 50);
  hdr.writeUInt32LE(sizeOfImage, opt + 56);
  hdr.writeUInt32LE(hdr.length, opt + 60);
  hdr.writeUInt16LE(2, opt + 68); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  hdr.writeUInt16LE(0x8140, opt + 70);
  hdr.writeBigUInt64LE(0x100000n, opt + 72);
  hdr.writeBigUInt64LE(0x10000n, opt + 80);
  hdr.writeBigUInt64LE(0x100000n, opt + 88);
  hdr.writeBigUInt64LE(0x10000n, opt + 96);
  hdr.writeUInt32LE(16, opt + 108);

  hdr.writeUInt32LE(RDATA_RVA, opt + 112 + 1 * 8);
  hdr.writeUInt32LE(60, opt + 112 + 1 * 8 + 4); // 3 Import Descriptors = 60 bytes
  hdr.writeUInt32LE(RSRC_RVA, opt + 112 + 2 * 8);
  hdr.writeUInt32LE(rsrcVirtSize, opt + 112 + 2 * 8 + 4);
  hdr.writeUInt32LE(RDATA_RVA + k32IatOff, opt + 112 + 12 * 8);
  hdr.writeUInt32LE(80, opt + 112 + 12 * 8 + 4);

  const secBase = opt + 240;
  const writeSec = (idx, name, virtSize, rva, rawSize, rawPtr, chars) => {
    const s = secBase + idx * 40;
    hdr.write(name, s, 'ascii');
    hdr.writeUInt32LE(virtSize, s + 8);
    hdr.writeUInt32LE(rva, s + 12);
    hdr.writeUInt32LE(rawSize, s + 16);
    hdr.writeUInt32LE(rawPtr, s + 20);
    hdr.writeUInt32LE(chars, s + 36);
  };

  const ptrText = hdr.length;
  const ptrRdata = ptrText + textBuf.length;
  const ptrRsrc = ptrRdata + rdataBuf.length;

  writeSec(0, '.text\0\0\0', code.length, TEXT_RVA, textBuf.length, ptrText, 0x60000020);
  writeSec(1, '.data\0\0\0', rdataTrimmed.length, RDATA_RVA, rdataBuf.length, ptrRdata, 0xC0000040);
  writeSec(2, '.rsrc\0\0\0', rsrcVirtSize, RSRC_RVA, rsrcBuf.length, ptrRsrc, 0x40000040);

  const fullExe = Buffer.concat([hdr, textBuf, rdataBuf, rsrcBuf]);
  fs.writeFileSync(outPath, fullExe);
  return fullExe;
}

// Build a self-extracting Windows GUI Setup Installer (.exe) that:
// 1. Explicitly extracts all ZIP entries with UTF-8 encoding (`[System.IO.Compression.ZipFile]::ExtractToDirectory(..., [System.Text.Encoding]::UTF8)`)
// 2. Does not depend on any hardcoded Chinese executable filename (`OIVideoStudio.exe` is ASCII; also searches fallback if needed)
// 3. Verifies target executable and `runtime\node.exe` + `app\scripts\start.js` exist before launching
// 4. Catches any installation or launch error and displays a visible `MessageBox` error dialog instead of failing silently
function buildWin64SetupInstallerExe({ icoPath, payloadZipPath, outPath }) {
  const psScript = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.IO.Compression",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    "try {",
    "  $self=$env:OIVS_SETUP_EXE",
    "  if(-not $self -or -not (Test-Path -LiteralPath $self)){ throw '找不到安装包自身路径 (OIVS_SETUP_EXE)' }",
    "  $dest=Join-Path $env:LOCALAPPDATA 'Programs\\OIVideoStudio'",
    "  Get-Process -Name 'OIVideoStudio' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
    "  if(Test-Path -LiteralPath $dest){ Remove-Item -LiteralPath $dest -Recurse -Force }",
    "  New-Item -ItemType Directory -Force -Path $dest | Out-Null",
    "  $in=[System.IO.File]::OpenRead($self)",
    "  if($in.Length -lt 1024){ $in.Close(); throw '安装包文件不完整或已损坏' }",
    "  $in.Seek($in.Length-8,[System.IO.SeekOrigin]::Begin) | Out-Null",
    "  $tr=New-Object byte[] 8",
    "  $in.Read($tr,0,8) | Out-Null",
    "  $magic=[System.Text.Encoding]::ASCII.GetString($tr,4,4)",
    "  if($magic -ne 'OIVS'){ $in.Close(); throw '安装包校验标志不匹配，请重新下载完整安装包' }",
    "  $len=[System.BitConverter]::ToInt32($tr,0)",
    "  if($len -le 0 -or $len -ge $in.Length){ $in.Close(); throw '安装包内置压缩包长度异常' }",
    "  $in.Seek($in.Length-8-$len,[System.IO.SeekOrigin]::Begin) | Out-Null",
    "  $zip=Join-Path $env:TEMP (\"oivs-setup-$PID.zip\")",
    "  $out=[System.IO.File]::Create($zip)",
    "  $buf=New-Object byte[] 65536; $rem=$len",
    "  while($rem -gt 0){ $n=$in.Read($buf,0,[Math]::Min($buf.Length,$rem)); if($n -le 0){break}; $out.Write($buf,0,$n); $rem-=$n }",
    "  $out.Close(); $in.Close()",
    "  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest, [System.Text.Encoding]::UTF8)",
    "  Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue",
    "  $exe = Join-Path $dest 'OIVideoStudio.exe'",
    "  if(-not (Test-Path -LiteralPath $exe)){",
    "    $found = Get-ChildItem -LiteralPath $dest -Filter '*.exe' -File | Select-Object -First 1",
    "    if($found){ $exe = $found.FullName }",
    "  }",
    "  $nodeExe = Join-Path $dest 'runtime\\node.exe'",
    "  $startJs = Join-Path $dest 'app\\scripts\\start.js'",
    "  if(-not (Test-Path -LiteralPath $exe)){ throw (\"安装后未找到启动程序: \" + $exe) }",
    "  if(-not (Test-Path -LiteralPath $nodeExe)){ throw (\"安装后未找到内置 Node 运行时: \" + $nodeExe) }",
    "  if(-not (Test-Path -LiteralPath $startJs)){ throw (\"安装后未找到应用启动脚本: \" + $startJs) }",
    "  $wsh = New-Object -ComObject WScript.Shell",
    "  $desktopDir = [Environment]::GetFolderPath('Desktop')",
    "  $startMenuDir = [Environment]::GetFolderPath('Programs')",
    "  foreach($dir in @($desktopDir, $startMenuDir)){",
    "    if($dir -and (Test-Path -LiteralPath $dir)){",
    "      $lnk = Join-Path $dir '信奥讲解视频工坊.lnk'",
    "      $s = $wsh.CreateShortcut($lnk)",
    "      $s.TargetPath = $exe",
    "      $s.WorkingDirectory = $dest",
    "      $s.IconLocation = \"$exe,0\"",
    "      $s.Description = '信奥讲解视频工坊 (OI Video Studio)'",
    "      $s.Save()",
    "    }",
    "  }",
    "  Start-Process -FilePath $exe -WorkingDirectory $dest",
    "} catch {",
    "  [System.Windows.Forms.MessageBox]::Show(\"安装或启动过程中出现错误：`r`n`r`n\" + $_.Exception.Message, '信奥讲解视频工坊 - 安装失败', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null",
    "  exit 1",
    "}"
  ].join('\r\n');
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  const cmdLine = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;

  const stubPath = outPath + '.stub';
  const stubBuf = buildWin64GuiExe({
    icoPath,
    cmdLineTemplate: cmdLine,
    outPath: stubPath,
    mode: 'setup',
    showConsole: true,
    checkFiles: [],
    errTitle: '信奥讲解视频工坊 - 安装程序错误',
    errLaunchMsg: '无法调用系统 PowerShell 执行安装，请检查系统组件是否完整。',
  });
  fs.unlinkSync(stubPath);

  const zipStat = fs.statSync(payloadZipPath);
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(zipStat.size, 0);
  trailer.write('OIVS', 4, 'ascii');

  const outStream = fs.createWriteStream(outPath);
  outStream.write(stubBuf);
  const inStream = fs.createReadStream(payloadZipPath);
  return new Promise((resolve, reject) => {
    inStream.on('error', reject);
    outStream.on('error', reject);
    inStream.on('end', () => {
      outStream.write(trailer, () => {
        outStream.end(() => resolve(stubBuf.length + zipStat.size + 8));
      });
    });
    inStream.pipe(outStream, { end: false });
  });
}

module.exports = { buildWin64GuiExe, buildWin64SetupInstallerExe };
