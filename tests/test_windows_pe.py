"""Execute generated x64 instructions against Win32 API doubles (not a Windows OS test).
Requires: pip install unicorn pefile
Usage: python tests/test_windows_pe.py dist/*-windows-x64-setup.exe dist/*-windows-x64.zip
Catches command-buffer overflow, read-only command buffers, hidden processes,
incorrect API calls, and silent missing-file / CreateProcess failures.
"""
import sys, zipfile, struct, unittest
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE, UC_PROT_READ, UC_PROT_WRITE, UC_PROT_EXEC
from unicorn.x86_const import *

SETUP = open(sys.argv[1], 'rb').read()
with zipfile.ZipFile(sys.argv[2]) as z:
    LAUNCHER = z.read('OIVideoStudio.exe')
sys.argv = sys.argv[:1]


def execute(binary, missing=None, launch_ok=True):
    pe = pefile.PE(data=binary)
    uc = Uc(UC_ARCH_X86, UC_MODE_64)
    base = pe.OPTIONAL_HEADER.ImageBase
    uc.mem_map(base, pe.OPTIONAL_HEADER.SizeOfImage)
    uc.mem_write(base, pe.get_memory_mapped_image())
    api_base, stack = 0x70000000, 0x80000000
    uc.mem_map(api_base, 0x10000)
    uc.mem_map(stack, 0x10000)
    uc.reg_write(UC_X86_REG_RSP, stack + 0x10000 - 8)
    imports = {}
    for d in pe.DIRECTORY_ENTRY_IMPORT:
        for i in d.imports:
            address = api_base + len(imports) * 16
            imports[address] = i.name.decode()
            uc.mem_write(i.address, struct.pack('<Q', address))
    for s in pe.sections:
        prot = (UC_PROT_READ if s.Characteristics & 0x40000000 else 0) | (UC_PROT_WRITE if s.Characteristics & 0x80000000 else 0) | (UC_PROT_EXEC if s.Characteristics & 0x20000000 else 0)
        uc.mem_protect(base+s.VirtualAddress, (s.Misc_VirtualSize+4095)//4096*4096, prot)
    events = {'messages': [], 'checks': [], 'commands': []}
    exe_path = r'C:\用户目录\带空格 folder\OIVideoStudio.exe'
    def readw(address):
        data = bytearray()
        for i in range(32768):
            ch = uc.mem_read(address + 2*i, 2)
            if ch == b'\0\0': return data.decode('utf-16le')
            data.extend(ch)
        raise AssertionError('Unterminated command/path')
    def hook(uc, address, size, _):
        if address not in imports: return
        name = imports[address]
        rsp = uc.reg_read(UC_X86_REG_RSP)
        assert rsp % 16 == 8, 'Win64 ABI stack alignment'
        rcx, rdx, r8, r9 = [uc.reg_read(r) for r in (UC_X86_REG_RCX, UC_X86_REG_RDX, UC_X86_REG_R8, UC_X86_REG_R9)]
        ret = 1
        if name == 'GetModuleFileNameW':
            uc.mem_write(rdx, (exe_path+'\0').encode('utf-16le')); ret = len(exe_path)
        elif name == 'SetEnvironmentVariableW':
            assert readw(rdx) == exe_path
        elif name == 'SetCurrentDirectoryW':
            assert readw(rcx) == exe_path.rsplit('\\',1)[0]
        elif name == 'GetFileAttributesW':
            target = readw(rcx); events['checks'].append(target)
            ret = 0xffffffff if target == missing else 0x80
        elif name == 'CreateProcessW':
            command = readw(rdx)
            events['commands'].append(command)
            flags = struct.unpack('<Q', uc.mem_read(rsp+8+0x28,8))[0]
            assert not flags & 0x08000000, 'CREATE_NO_WINDOW hides installation errors'
            # Windows may mutate the command line; verify the addressed section/stack is writable.
            writable = stack <= rdx < stack+0x10000 or any(base+s.VirtualAddress <= rdx < base+s.VirtualAddress+s.Misc_VirtualSize and s.Characteristics&0x80000000 for s in pe.sections)
            assert writable, 'CreateProcessW command must be writable'
            assert '-WindowStyle Hidden' not in command
            pi = struct.unpack('<Q', uc.mem_read(rsp+8+0x48,8))[0]
            uc.mem_write(pi, struct.pack('<QQII', 123,124,1,2))
            ret = int(launch_ok)
        elif name == 'WaitForSingleObject': ret = 0
        elif name == 'GetExitCodeProcess': uc.mem_write(rdx, struct.pack('<I',0))
        elif name == 'MessageBoxW': events['messages'].append(readw(rdx))
        elif name == 'ExitProcess':
            events['exit'] = rcx; uc.emu_stop(); return
        else: raise AssertionError('Unexpected API '+name)
        uc.reg_write(UC_X86_REG_RAX, ret)
        uc.reg_write(UC_X86_REG_RIP, struct.unpack('<Q',uc.mem_read(rsp,8))[0])
        uc.reg_write(UC_X86_REG_RSP, rsp+8)
    uc.hook_add(UC_HOOK_CODE, hook)
    uc.emu_start(base+pe.OPTIONAL_HEADER.AddressOfEntryPoint, 0, count=200000)
    assert 'exit' in events, 'Executable did not exit'
    return events

class GeneratedPE(unittest.TestCase):
    def test_setup_command_does_not_overflow_and_is_visible(self):
        result = execute(SETUP)
        self.assertEqual(result['exit'], 0)
        self.assertEqual(len(result['commands']), 1)
    def test_launcher_starts_with_unicode_directory(self):
        result = execute(LAUNCHER)
        self.assertEqual(result['exit'], 0)
        self.assertEqual(len(result['checks']), 4)
        self.assertEqual(result['commands'], ['"runtime\\node.exe" "app\\scripts\\start.js"'])
    def test_missing_files_show_error(self):
        for target in ['runtime\\node.exe','runtime\\ffmpeg.exe','app\\scripts\\start.js','app\\server.js']:
            with self.subTest(target=target):
                result = execute(LAUNCHER, missing=target)
                self.assertEqual(result['exit'], 1)
                self.assertTrue(result['messages'])
                self.assertFalse(result['commands'])
    def test_process_creation_failure_shows_error(self):
        for binary in [LAUNCHER, SETUP]:
            result = execute(binary, launch_ok=False)
            self.assertEqual(result['exit'], 1)
            self.assertTrue(result['messages'])

unittest.main()
