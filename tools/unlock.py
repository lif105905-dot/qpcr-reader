#!/usr/bin/env python3
"""从 Bio-Rad 程序文件里挖出 ZipCrypto 密码，并解密 .pcrd / .pltd / .prcl。

用法:
    unlock.py <要扫描的二进制> [更多二进制 ...] --pcrd <某个 .pcrd> [-o 输出.xml]

原理:
    Bio-Rad 标准版 .pcrd 是单条目 ZipCrypto(加密) + Deflate 的 ZIP。
    固定密码只是程序里的一条字符串字面量。把程序文件里所有可能的
    字符串都拿来试一次: 先用 12 字节加密头的 check byte 快速筛，
    通过者再整段解密 + raw inflate + CRC32 校验，命中即为真密码。
"""
import sys, struct, zlib, argparse, re

TBL = []
for _i in range(256):
    _c = _i
    for _ in range(8):
        _c = (_c >> 1) ^ 0xEDB88320 if _c & 1 else _c >> 1
    TBL.append(_c)

PW_MIN, PW_MAX = 4, 64


def zip_parse(data):
    """返回 (payload, crc, csize, usize, flag, method)。payload 含 12 字节加密头。"""
    off = data.find(b"PK\x03\x04")
    if off < 0:
        raise SystemExit("不是 ZIP 局部头")
    (_sig, _ver, flag, method, t, d, crc, csize, usize,
     nlen, elen) = struct.unpack_from("<IHHHHHIIIHH", data, off)
    start = off + 30 + nlen + elen
    return data[start:start + csize], crc, csize, usize, flag, method, t, d


def check_bytes(crc, t, d):
    """12 字节加密头的最后一个明文字节。
    置了 flag bit3 时 Info-ZIP 写的是 DOS 时间高位，否则写 CRC 高位；两个都试。"""
    return {(crc >> 24) & 0xFF, (t >> 8) & 0xFF, (d >> 8) & 0xFF}


def partial_ok(pw, payload):
    """先用前 200 字节试解压：错密码几乎立刻报 invalid stored block lengths。"""
    plain = decrypt(pw, payload[:212])[12:]
    try:
        zlib.decompressobj(-15).decompress(plain)
    except zlib.error:
        return False
    return True


def extract(pw, payload, usize, crc, method):
    """返回解密后的原始数据，失败返回 None。"""
    plain = decrypt(pw, payload)
    body = plain[12:]
    if method == 0:
        raw = body
    elif method == 8:
        try:
            raw = zlib.decompress(body, -15)
        except zlib.error:
            return None
    else:
        return None   # method 9 = Deflate64，标准 zlib 不支持
    if len(raw) != usize or (zlib.crc32(raw) & 0xFFFFFFFF) != crc:
        return None
    return raw


def keys_init(pw):
    k0, k1, k2 = 0x12345678, 0x23456789, 0x34567890
    for b in pw:
        k0 = (k0 >> 8) ^ TBL[(k0 ^ b) & 0xFF]
        k1 = ((k1 + (k0 & 0xFF)) * 134775813 + 1) & 0xFFFFFFFF
        k2 = (k2 >> 8) ^ TBL[(k2 ^ ((k1 >> 24) & 0xFF)) & 0xFF]
    return [k0, k1, k2]


def _upd(K, p):
    K[0] = (K[0] >> 8) ^ TBL[(K[0] ^ p) & 0xFF]
    K[1] = ((K[1] + (K[0] & 0xFF)) * 134775813 + 1) & 0xFFFFFFFF
    K[2] = (K[2] >> 8) ^ TBL[(K[2] ^ ((K[1] >> 24) & 0xFF)) & 0xFF]


def decrypt(pw, payload):
    K = keys_init(pw)
    out = bytearray()
    for c in payload:
        tt = (K[2] | 2) & 0xFFFF
        p = c ^ (((tt * (tt ^ 1)) >> 8) & 0xFF)
        out.append(p)
        _upd(K, p)
    return bytes(out)


def head_ok(pw, payload, wants):
    """只解 12 字节头，看最后一个字节是否等于期望的 check byte。"""
    K = keys_init(pw)
    last = 0
    for c in payload[:12]:
        tt = (K[2] | 2) & 0xFFFF
        p = c ^ (((tt * (tt ^ 1)) >> 8) & 0xFF)
        last = p
        _upd(K, p)
    return last in wants


def candidates_from(buf, max_window=0):
    """一段二进制里所有可能的字符串字面量。
    覆盖三种存法：ASCII（含 UTF-16 错位）、UTF-16LE（偶/奇两种对齐）。
    默认只取整串；max_window>0 时再把长串拆成滑窗子串。"""
    out = set()
    win = _windows if not max_window else (lambda bs: _windows(bs, max_window))

    # 1) 纯 ASCII 连续可打印
    for m in re.finditer(rb"[\x20-\x7e]{%d,64}" % PW_MIN, buf):
        out.update(win(m.group()))

    # 2) UTF-16LE：低字节是可打印 ASCII、高字节是 0
    pat_even = rb"(?:[\x20-\x7e]\x00){%d,64}" % PW_MIN
    for m in re.finditer(pat_even, buf):
        out.update(win(m.group()[0::2]))
    pat_odd = rb"[\x00-\xff](?:[\x20-\x7e]\x00){%d,63}" % PW_MIN
    for m in re.finditer(pat_odd, buf):
        out.update(win(m.group()[1::2]))
    return out


def _windows(bs, max_len=PW_MAX):
    """把一个长串拆成所有 PW_MIN..max_len 长度的子串。"""
    out = []
    n = len(bs)
    for i in range(n):
        for L in range(PW_MIN, min(max_len, n - i) + 1):
            out.append(bs[i:i + L])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("binaries", nargs="+")
    ap.add_argument("--pcrd", required=True)
    ap.add_argument("-o", "--out")
    ap.add_argument("--max-window", type=int, default=0,
                    help="0=只试整串（默认）；大于 0 时再把长串拆成该长度的滑窗子串")
    a = ap.parse_args()

    data = open(a.pcrd, "rb").read()
    payload, crc, csize, usize, flag, method, t, d = zip_parse(data)
    wants = check_bytes(crc, t, d)
    print(f"目标: {a.pcrd}")
    print(f"  flag=0x{flag:04X} method={method} csize={csize} usize={usize} crc=0x{crc:08X}")
    print(f"  check byte 候选: {sorted(wants)}")

    cands = set()
    for path in a.binaries:
        buf = open(path, "rb").read()
        got = candidates_from(buf, a.max_window)
        print(f"  {path}: {len(got):,} 个候选")
        cands |= got
    print(f"候选总数: {len(cands):,}")

    hit, raw = None, None
    for pw in cands:
        if head_ok(pw, payload, wants) and partial_ok(pw, payload):
            raw = extract(pw, payload, usize, crc, method)
            if raw is not None:
                hit = pw
                break

    if not hit:
        print("❌ 没找到密码。")
        return 1
    print(f"✅ 找到密码: {hit!r}  (utf-8: {hit.decode('utf-8', 'replace')!r})")
    out = a.out or (a.pcrd.rsplit(".", 1)[0] + ".decrypted.xml")
    open(out, "wb").write(raw)
    print(f"已解密 → {out}  ({len(raw):,} 字节)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
