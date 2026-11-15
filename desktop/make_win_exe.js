// Generates native Windows x64 GUI PE executables (.exe) with embedded multi-resolution ICO resources.
// No external compiler required — runs on macOS/Linux/Windows using pure Node.js.
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
// - If mode === 'launcher': sets current directory to exe's folder and invokes cmdLineTemplate
// - If mode === 'setup': sets OIVS_SETUP_EXE=<exe full path> and invokes cmdLineTemplate, then waits for child process to finish
function buildWin64GuiExe({ icoPath, cmdLineTemplate, outPath, mode = 'launcher' }) {
  const icoBuf = fs.readFileSync(icoPath);
  const FILE_ALIGN = 0x200;
  const SECT_ALIGN = 0x1000;

  const TEXT_RVA = 0x1000;
  const RDATA_RVA = 0x2000;

  const cmdBytes = Buffer.from(cmdLineTemplate + '\0', 'utf16le');
  const rdataSize = align(0x300 + cmdBytes.length, SECT_ALIGN);
  const RSRC_RVA = RDATA_RVA + rdataSize;

  // Imports from KERNEL32.dll:
  //   0: GetModuleFileNameW
  //   1: SetCurrentDirectoryW
  //   2: SetEnvironmentVariableW
  //   3: CreateProcessW
  //   4: WaitForSingleObject
  //   5: ExitProcess
  const fnNames = [
    'GetModuleFileNameW',
    'SetCurrentDirectoryW',
    'SetEnvironmentVariableW',
    'CreateProcessW',
    'WaitForSingleObject',
    'ExitProcess',
  ];
  const rdata = Buffer.alloc(0x300 + cmdBytes.length);
  const iltOff = 0x40;
  const iatOff = 0x80;
  const dllNameOff = 0xC0;
  const envNameOff = 0x1C0;
  const cmdOff = 0x200;

  rdata.writeUInt32LE(RDATA_RVA + iltOff, 0);
  rdata.writeUInt32LE(0, 4);
  rdata.writeUInt32LE(0, 8);
  rdata.writeUInt32LE(RDATA_RVA + dllNameOff, 12);
  rdata.writeUInt32LE(RDATA_RVA + iatOff, 16);

  rdata.write('KERNEL32.dll\0', dllNameOff, 'ascii');
  let hnCursor = 0xE0;
  for (let i = 0; i < fnNames.length; i++) {
    const hn = hnCursor;
    rdata.writeUInt16LE(0, hn);
    rdata.write(fnNames[i] + '\0', hn + 2, 'ascii');
    rdata.writeBigUInt64LE(BigInt(RDATA_RVA + hn), iltOff + i * 8);
    rdata.writeBigUInt64LE(BigInt(RDATA_RVA + hn), iatOff + i * 8);
    hnCursor = align(hn + 3 + fnNames[i].length, 4);
  }

  rdata.write('OIVS_SETUP_EXE\0', envNameOff, 'utf16le');
  cmdBytes.copy(rdata, cmdOff);

  // Stack allocation: 0x2688 bytes
  // [rsp + 0x50 .. 0x67]   : PROCESS_INFORMATION (24 bytes; hProcess is at [rsp + 0x50])
  // [rsp + 0x70 .. 0xD7]   : STARTUPINFOW (104 bytes)
  // [rsp + 0xE0 .. 0x4EF]  : WCHAR pathBuf[520]
  // [rsp + 0x500 .. 0x267F]: WCHAR cmdBuf[4200]
  const code = [];
  const push = (...b) => code.push(...b);
  const pushU32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v, 0); push(...b); };

  // sub rsp, 0x2688
  push(0x48, 0x81, 0xEC); pushU32(0x2688);

  // Zero [rsp + 0x50 .. rsp + 0x2680]
  push(0x48, 0x8D, 0x7C, 0x24, 0x50);
  push(0x31, 0xC0);
  push(0xB9); pushU32(0x2630);
  push(0xF3, 0xAA);

  // GetModuleFileNameW(NULL, &pathBuf [rsp+0xE0], 520)
  push(0x31, 0xC9);
  push(0x48, 0x8D, 0x94, 0x24); pushU32(0xE0);
  push(0x41, 0xB8); pushU32(520);
  const callGetModPos = code.length;
  push(0xFF, 0x15, 0, 0, 0, 0);
  // Save eax (length) in ebx
  push(0x89, 0xC3);

  // SetEnvironmentVariableW(L"OIVS_SETUP_EXE", &pathBuf [rsp+0xE0])
  const leaEnvNamePos = code.length;
  push(0x48, 0x8D, 0x0D, 0, 0, 0, 0);
  push(0x48, 0x8D, 0x94, 0x24); pushU32(0xE0);
  const callSetEnvPos = code.length;
  push(0xFF, 0x15, 0, 0, 0, 0);

  // Restore eax = ebx and strip last backslash in pathBuf
  push(0x89, 0xD8);
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
  const callSetDirPos = code.length;
  push(0xFF, 0x15, 0, 0, 0, 0);

  // Copy cmdBytes from .rdata into [rsp + 0x500]
  const leaCmdSrcPos = code.length;
  push(0x48, 0x8D, 0x35, 0, 0, 0, 0);
  push(0x48, 0x8D, 0xBC, 0x24); pushU32(0x500);
  push(0xB9); pushU32(cmdBytes.length);
  push(0xF3, 0xA4);

  // STARTUPINFOW.cb = 104
  push(0xC7, 0x44, 0x24, 0x70); pushU32(104);

  // CreateProcessW(NULL, &cmdBuf, NULL, NULL, FALSE, CREATE_NO_WINDOW (0x08000000), NULL, NULL, &si, &pi)
  push(0x31, 0xC9);
  push(0x48, 0x8D, 0x94, 0x24); pushU32(0x500);
  push(0x45, 0x31, 0xC0);
  push(0x45, 0x31, 0xC9);
  push(0x48, 0xC7, 0x44, 0x24, 0x20, 0, 0, 0, 0);
  push(0x48, 0xC7, 0x44, 0x24, 0x28); pushU32(0x08000000);
  push(0x48, 0xC7, 0x44, 0x24, 0x30, 0, 0, 0, 0);
  push(0x48, 0xC7, 0x44, 0x24, 0x38, 0, 0, 0, 0);
  push(0x48, 0x8D, 0x44, 0x24, 0x70);
  push(0x48, 0x89, 0x44, 0x24, 0x40);
  push(0x48, 0x8D, 0x44, 0x24, 0x50);
  push(0x48, 0x89, 0x44, 0x24, 0x48);
  const callCreateProcPos = code.length;
  push(0xFF, 0x15, 0, 0, 0, 0);

  let callWaitPos = -1;
  if (mode === 'setup') {
    // WaitForSingleObject(pi.hProcess [rsp+0x50], INFINITE (0xFFFFFFFF))
    push(0x48, 0x8B, 0x4C, 0x24, 0x50);
    push(0xBA, 0xFF, 0xFF, 0xFF, 0xFF);
    callWaitPos = code.length;
    push(0xFF, 0x15, 0, 0, 0, 0);
  }

  // ExitProcess(0)
  push(0x31, 0xC9);
  const callExitPos = code.length;
  push(0xFF, 0x15, 0, 0, 0, 0);

  const textBuf = Buffer.alloc(align(code.length, FILE_ALIGN));
  Buffer.from(code).copy(textBuf);

  const patchRip = (instrPos, instrLen, targetRva) => {
    const nextRip = TEXT_RVA + instrPos + instrLen;
    textBuf.writeInt32LE(targetRva - nextRip, instrPos + instrLen - 4);
  };
  patchRip(callGetModPos, 6, RDATA_RVA + iatOff + 0);
  patchRip(leaEnvNamePos, 7, RDATA_RVA + envNameOff);
  patchRip(callSetEnvPos, 6, RDATA_RVA + iatOff + 16);
  patchRip(callSetDirPos, 6, RDATA_RVA + iatOff + 8);
  patchRip(leaCmdSrcPos, 7, RDATA_RVA + cmdOff);
  patchRip(callCreateProcPos, 6, RDATA_RVA + iatOff + 24);
  if (callWaitPos >= 0) patchRip(callWaitPos, 6, RDATA_RVA + iatOff + 32);
  patchRip(callExitPos, 6, RDATA_RVA + iatOff + 40);

  const rsrcRaw = buildRsrcSection(icoBuf, RSRC_RVA);
  const rsrcBuf = Buffer.alloc(align(rsrcRaw.length, FILE_ALIGN));
  rsrcRaw.copy(rsrcBuf);

  const rdataBuf = Buffer.alloc(align(rdata.length, FILE_ALIGN));
  rdata.copy(rdataBuf);

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
  hdr.writeUInt16LE(2, opt + 68);
  hdr.writeUInt16LE(0x8140, opt + 70);
  hdr.writeBigUInt64LE(0x100000n, opt + 72);
  hdr.writeBigUInt64LE(0x10000n, opt + 80);
  hdr.writeBigUInt64LE(0x100000n, opt + 88);
  hdr.writeBigUInt64LE(0x10000n, opt + 96);
  hdr.writeUInt32LE(16, opt + 108);

  hdr.writeUInt32LE(RDATA_RVA, opt + 112 + 1 * 8);
  hdr.writeUInt32LE(40, opt + 112 + 1 * 8 + 4);
  hdr.writeUInt32LE(RSRC_RVA, opt + 112 + 2 * 8);
  hdr.writeUInt32LE(rsrcVirtSize, opt + 112 + 2 * 8 + 4);
  hdr.writeUInt32LE(RDATA_RVA + iatOff, opt + 112 + 12 * 8);
  hdr.writeUInt32LE(56, opt + 112 + 12 * 8 + 4);

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
  writeSec(1, '.rdata\0\0', rdata.length, RDATA_RVA, rdataBuf.length, ptrRdata, 0x40000040);
  writeSec(2, '.rsrc\0\0\0', rsrcVirtSize, RSRC_RVA, rsrcBuf.length, ptrRsrc, 0x40000040);

  const fullExe = Buffer.concat([hdr, textBuf, rdataBuf, rsrcBuf]);
  fs.writeFileSync(outPath, fullExe);
  return fullExe;
}

function buildWin64SetupInstallerExe({ icoPath, payloadZipPath, outPath }) {
  // PowerShell script invoked by the Setup.exe GUI stub:
  // Uses stream copy (fast & low memory even for 100MB+ ZIPs), extracts to %LOCALAPPDATA%\Programs\OIVideoStudio,
  // creates Desktop & Start Menu shortcuts, shows completion notice, and starts the app!
  const psScript = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$self=$env:OIVS_SETUP_EXE",
    "$dest=\"$env:LOCALAPPDATA\\Programs\\OIVideoStudio\"",
    "if(Test-Path $dest){Remove-Item -Recurse -Force $dest}",
    "New-Item -ItemType Directory -Force -Path $dest|Out-Null",
    "$in=[System.IO.File]::OpenRead($self)",
    "$in.Seek($in.Length-8,[System.IO.SeekOrigin]::Begin)|Out-Null",
    "$tr=New-Object byte[] 8",
    "$in.Read($tr,0,8)|Out-Null",
    "$len=[System.BitConverter]::ToInt32($tr,0)",
    "$in.Seek($in.Length-8-$len,[System.IO.SeekOrigin]::Begin)|Out-Null",
    "$zip=\"$env:TEMP\\oivs-setup-$PID.zip\"",
    "$out=[System.IO.File]::Create($zip)",
    "$buf=New-Object byte[] 65536;$rem=$len",
    "while($rem -gt 0){$n=$in.Read($buf,0,[Math]::Min($buf.Length,$rem));if($n -le 0){break};$out.Write($buf,0,$n);$rem-=$n}",
    "$out.Close();$in.Close()",
    "Expand-Archive -Path $zip -DestinationPath $dest -Force",
    "Remove-Item -Force $zip",
    "$exe=\"$dest\\信奥讲解视频工坊.exe\"",
    "$wsh=New-Object -ComObject WScript.Shell",
    "foreach($lnk in @(\"$Home\\Desktop\\信奥讲解视频工坊.lnk\",\"$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\信奥讲解视频工坊.lnk\")){",
    "  $s=$wsh.CreateShortcut($lnk);$s.TargetPath=$exe;$s.WorkingDirectory=$dest;$s.IconLocation=\"$exe,0\";$s.Save()",
    "}",
    "Start-Process $exe"
  ].join(';');
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  const cmdLine = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;

  const stubPath = outPath + '.stub';
  const stubBuf = buildWin64GuiExe({ icoPath, cmdLineTemplate: cmdLine, outPath: stubPath, mode: 'setup' });
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
