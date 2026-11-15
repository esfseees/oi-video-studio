#!/usr/bin/env python3
"""
Create a ZIP archive where each non-ASCII filename sets General Purpose Bit Flag
bit 11 (0x0800 = UTF-8 filename encoding) and preserves POSIX permissions and symlinks.
Usage:
  python3 make_utf8_zip.py <src_dir> <out_zip> [--prefix <folder_name>] [--exclude a,b,c]
"""
import argparse
import os
import stat
import time
import zipfile

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("src_dir")
    parser.add_argument("out_zip")
    parser.add_argument("--prefix", default="")
    parser.add_argument("--exclude", default=".git,.venv,data,dist,.env,.DS_Store,__pycache__")
    args = parser.parse_args()

    src_dir = os.path.abspath(args.src_dir)
    out_zip = os.path.abspath(args.out_zip)
    excludes = set(x.strip() for x in args.exclude.split(",") if x.strip())

    os.makedirs(os.path.dirname(out_zip), exist_ok=True)
    if os.path.exists(out_zip):
        os.remove(out_zip)

    with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(src_dir):
            dirs[:] = sorted([d for d in dirs if d not in excludes])
            files = sorted([f for f in files if f not in excludes and not f.endswith(".pyc")])
            for fname in files:
                full_path = os.path.join(root, fname)
                rel_path = os.path.relpath(full_path, src_dir).replace(os.sep, "/")
                arcname = f"{args.prefix.strip('/')}/{rel_path}" if args.prefix else rel_path

                st = os.lstat(full_path)
                dt = time.localtime(st.st_mtime)[:6]
                zi = zipfile.ZipInfo(filename=arcname, date_time=dt)
                # zipfile encodes non-ASCII paths as UTF-8 and sets bit 11 in both headers.
                zi.create_system = 3  # Unix / cross-platform attributes
                zi.external_attr = (st.st_mode & 0xFFFF) << 16
                if os.path.islink(full_path):
                    zi.compress_type = zipfile.ZIP_STORED
                    target = os.readlink(full_path).encode("utf-8")
                    zf.writestr(zi, target, compress_type=zipfile.ZIP_STORED)
                else:
                    zi.compress_type = zipfile.ZIP_DEFLATED
                    with open(full_path, "rb") as f:
                        zf.writestr(zi, f.read(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)

if __name__ == "__main__":
    main()
