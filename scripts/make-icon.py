import os, struct, zlib, math

SIZE = 256
SS = 3  # 超采样倍数（抗锯齿）

def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

# ---------- 形状判定（归一化到 0..1 坐标） ----------
def inside_round_rect(x, y, radius):
    # 全幅圆角矩形
    if x < radius:
        cx, cy = radius, radius if y < radius else (1 - radius)
        if (x < radius and y < radius):
            return (x - radius) ** 2 + (y - radius) ** 2 <= radius * radius
        if (x < radius and y > 1 - radius):
            return (x - radius) ** 2 + (y - (1 - radius)) ** 2 <= radius * radius
    if x > 1 - radius:
        if y < radius:
            return (x - (1 - radius)) ** 2 + (y - radius) ** 2 <= radius * radius
        if y > 1 - radius:
            return (x - (1 - radius)) ** 2 + (y - (1 - radius)) ** 2 <= radius * radius
    return True

def point_in_poly(x, y, pts):
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside

# 笔尖（羽毛笔/钢笔尖）多边形 + 墨滴
NIB = [(0.30, 0.20), (0.62, 0.26), (0.72, 0.52), (0.52, 0.78), (0.40, 0.62)]
SLIT = [(0.44, 0.36), (0.60, 0.34), (0.52, 0.62), (0.46, 0.58)]
DROP_C = (0.60, 0.72)
DROP_R = 0.075

def render(size):
    rows = []
    inv = 1.0 / size
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) * inv
                    y = (py + (sy + 0.5) / SS) * inv
                    if not inside_round_rect(x, y, 0.22):
                        continue
                    # 背景：斜向渐变
                    t = min(1.0, max(0.0, (x + y) / 2))
                    col = lerp((30, 41, 59), (15, 23, 42), t)
                    # 笔尖
                    if point_in_poly(x, y, NIB):
                        if point_in_poly(x, y, SLIT):
                            col = (245, 233, 208)
                        else:
                            col = lerp((245, 233, 208), (214, 190, 150), x)
                    # 墨滴
                    dx, dy = x - DROP_C[0], y - DROP_C[1]
                    if (dx * dx + dy * dy) <= DROP_R * DROP_R:
                        col = (245, 158, 11)
                    r += col[0]
                    g += col[1]
                    b += col[2]
                    a += 255
            total = SS * SS
            if a <= 0:
                row += bytes((0, 0, 0, 0))
            else:
                cov = a / total
                row += bytes((int(round(r / (a / 255))), int(round(g / (a / 255))), int(round(b / (a / 255))), int(round(cov))))
        rows.append(bytes(row))
    return rows

def downsample(rows, src, dst):
    f = src // dst
    out = []
    for y in range(dst):
        row = bytearray()
        for x in range(dst):
            rs = gs = bs = as_ = 0
            for yy in range(f):
                base = rows[y * f + yy]
                for xx in range(f):
                    i = (x * f + xx) * 4
                    rs += base[i]; gs += base[i+1]; bs += base[i+2]; as_ += base[i+3]
            n = f * f
            row += bytes((rs // n, gs // n, bs // n, as_ // n))
        out.append(bytes(row))
    return out

def write_png(rows, size, path):
    raw = b''.join(b'\x00' + r for r in rows)
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as fh:
        fh.write(png)
    return len(png)

master = render(SIZE)
sizes = [256, 128, 64, 48, 32, 16]
images = []
for s in sizes:
    rows = master if s == SIZE else downsample(master, SIZE, s)
    images.append((s, rows))

os.makedirs('resources', exist_ok=True)
# 单张备用 PNG（窗口图标 / 关于页都能用）
write_png(master, SIZE, 'resources/icon.png')

# ICO：PNG 压缩条目（Vista+ 支持，体积最小）
tmphdr = b''.join(struct.pack('<II', 0, 0) for _ in images)
offset = 6 + 16 * len(images)
entries = b''
blobs = []
for size, rows in images:
    # 直接内存生成 PNG 字节
    raw = b''.join(b'\x00' + r for r in rows)
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    blobs.append(png)
    w = 0 if size == 256 else size
    entries += struct.pack('<BBBBHHII', w, w, 0, 0, 1, 32, len(png), offset)
    offset += len(png)

ico = struct.pack('<HHH', 0, 1, len(images)) + entries + b''.join(blobs)
with open('resources/icon.ico', 'wb') as fh:
    fh.write(ico)
print('icon.ico bytes =', len(ico))
print('icon.png bytes =', os.path.getsize('resources/icon.png'))
