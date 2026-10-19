# The ground under each road test place: Mapzen's terrain tiles (Terrarium, z15, AWS open data: SRTM, GMTED, ETOPO1,
# GEBCO and others) sampled on a grid of ~4 m in the place's own metres (x east, z south from its centre), the same
# heights the device's terrain draws. → data/packs/roads/<place>.dem.json (header) + .dem.f32 (rows north to south)
import io, json, math, os, sys, urllib.request
from PIL import Image
import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'data')
RAW = os.path.join(ROOT, 'raw-dem'); os.makedirs(RAW, exist_ok=True)
OUT = os.path.join(ROOT, 'packs', 'roads')
Z, STEP, PAD = 15, 4.0, 0.004
def tile(x, y):
    f = os.path.join(RAW, f'{Z}_{x}_{y}.png')
    if not os.path.exists(f):
        with urllib.request.urlopen(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png', timeout=60) as r: open(f, 'wb').write(r.read())
    a = np.asarray(Image.open(f).convert('RGB'), dtype=np.float64)
    return a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
cache = {}
def height(lon, lat):
    n = 2 ** Z; fx = (lon + 180) / 360 * n; fy = (1 - math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) / math.pi) / 2 * n
    tx, ty = int(fx), int(fy); px, py = (fx - tx) * 256 - 0.5, (fy - ty) * 256 - 0.5
    def at(i, j):
        X, Y = tx, ty
        if i < 0: X -= 1; i += 256
        if i > 255: X += 1; i -= 256
        if j < 0: Y -= 1; j += 256
        if j > 255: Y += 1; j -= 256
        k = (X, Y)
        if k not in cache: cache[k] = tile(X, Y)
        return cache[k][j, i]
    i0, j0 = math.floor(px), math.floor(py); u, v = px - i0, py - j0
    return (at(i0, j0) * (1 - u) + at(i0 + 1, j0) * u) * (1 - v) + (at(i0, j0 + 1) * (1 - u) + at(i0 + 1, j0 + 1) * u) * v
for name in sys.argv[1:] or [f[:-8] for f in os.listdir(OUT) if f.endswith('.geojson')]:
    doc = json.load(open(os.path.join(OUT, f'{name}.geojson'))); b = doc['bbox']
    # (the place's own origin when it has one: the street place's is the city tiles' corner, so the tiles line up)
    lon0, lat0 = doc.get('origin') or ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
    kx, kz = 111320 * math.cos(math.radians(lat0)), 110574
    x0, x1 = (b[0] - PAD - lon0) * kx, (b[2] + PAD - lon0) * kx
    z0, z1 = -(b[3] + PAD - lat0) * kz, -(b[1] - PAD - lat0) * kz
    nx, nz = int((x1 - x0) / STEP) + 1, int((z1 - z0) / STEP) + 1
    g = np.zeros((nz, nx), dtype=np.float32)
    for j in range(nz):
        for i in range(nx):
            x, z = x0 + i * STEP, z0 + j * STEP
            g[j, i] = height(lon0 + x / kx, lat0 - z / kz)
    # spikes out (no-data holes, a tower's top): a value far from its 5 × 5 neighbourhood's median takes the median
    from numpy.lib.stride_tricks import sliding_window_view
    pad = np.pad(g, 2, mode='edge'); med = np.median(sliding_window_view(pad, (5, 5)), axis=(2, 3)).astype(np.float32)
    bad = np.abs(g - med) > 6; g[bad] = med[bad]; g = np.clip(g, -5, 400)
    # buildings out (the radar saw roofs: a city's blocks stand up as hills): a grey opening 100 m across (the lowest
    # within, then the highest of those) keeps the land and drops what is narrower than a block; then smoothed a little
    from numpy.lib.stride_tricks import sliding_window_view as sw
    def filt(a, k, f):
        p = np.pad(a, ((0, 0), (k // 2, k // 2)), mode='edge'); a = f(sw(p, k, axis=1), axis=2)
        p = np.pad(a, ((k // 2, k // 2), (0, 0)), mode='edge'); return f(sw(p, k, axis=0), axis=2)
    g = filt(filt(g, 25, np.min), 25, np.max).astype(np.float32)
    g = filt(g, 5, np.mean).astype(np.float32)
    # the ground: one grid for the bake and for the device's terrain (terrain.grid: a local frame, row 0 north)
    g.tofile(os.path.join(OUT, f'{name}.ground.f32'))
    json.dump({'origin': {'lon': lon0, 'lat': lat0}, 'cols': nx, 'rows': nz, 'west_e': x0 - STEP / 2, 'north_n': -z0 + STEP / 2, 'cell': STEP,
               'x0': x0, 'z0': z0, 'step': STEP, 'nx': nx, 'nz': nz, 'zoom': Z,
               'source': 'Mapzen terrain tiles (Terrarium), AWS Open Data: SRTM, GMTED2010, ETOPO1, GEBCO and others; buildings taken out (a 100 m grey opening)'}, open(os.path.join(OUT, f'{name}.ground.json'), 'w'))
    for old in ('dem.f32', 'dem.json'):
        if os.path.exists(os.path.join(OUT, f'{name}.{old}')): os.remove(os.path.join(OUT, f'{name}.{old}'))
    print(name, nx, nz, f'{g.min():.1f}..{g.max():.1f} m')
