# ── Guitar-tab PDF → Resonote sketch steps ───────────────────────────
# Extracts fret positions from Guitar-Pro-style PDF exports (text layer +
# vector staff lines). Handles multi-track scores (Guitar 1/2), triplet
# markers, ties '(n)', whole-note bars, and bar anchoring by printed numbers.
# What it can't recover: articulations (H/P/sl./PM play as plain notes),
# muted X chugs (skipped), repeat expansion, exotic tuplets.
#
#   python tools/tab-pdf-extract.py "path\to\tab.pdf" out.json
#
# Output: [{track, bar, steps:[{notes:[[si,fret]..], dur}]}] — si 0 = high e.
import io, sys, json, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import fitz
from collections import defaultdict

PDF = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else 'tab-extract.json'
doc = fitz.open(PDF)

# 1) staves from vector drawings: aggregate horizontal segment length per y.
# Dense tabs punch holes in their lines (digits overprint), so the threshold
# is generous (250) and group SIZE (5 vs 6 lines) does the real filtering.
tabs_all = []       # {page, ytop, lines, nota_top, track, tokens, anchors, trips}
for pno, page in enumerate(doc):
    tot = defaultdict(float)
    for d in page.get_drawings():
        for item in d['items']:
            if item[0] == 'l':
                p1, p2 = item[1], item[2]
                if abs(p1.y - p2.y) < 0.3: tot[round((p1.y+p2.y)/2, 1)] += abs(p2.x - p1.x)
    long_ys = sorted(y for y, L in tot.items() if L > 250)
    # Staff lines are EVENLY spaced — tab ~6.4pt, notation ~4.25pt — and ledger
    # rows continue notation spacing. Maximal uniform-spacing runs separate all
    # three cleanly (clustering by proximity alone merges notation + ledgers
    # into fake 6-line "tabs").
    def maximal_runs(lo, hi):
        runs, cur = [], long_ys[:1]
        for a, b in zip(long_ys, long_ys[1:]):
            if lo <= b - a <= hi: cur.append(b)
            else:
                if len(cur) > 1: runs.append(cur)
                cur = [b]
        if len(cur) > 1: runs.append(cur)
        return runs
    notas = [r for r in maximal_runs(3.7, 4.9) if 5 <= len(r) <= 9]     # staff ± ledger rows
    tabs  = [r[-6:] for r in maximal_runs(5.7, 7.1) if len(r) >= 6]     # exactly six strings
    tabbands = [(g[0]-5, g[-1]+5) for g in tabs]   # no anchor may live inside a tab's digit zone
    words = page.get_text('words')
    # per-character stream for the tab zones: dense engravings FUSE colliding numbers
    # into single words/spans ('11'+'21' → '1121'), so fret capture works from chars
    chars = []
    for blk in page.get_text('rawdict')['blocks']:
        for line in blk.get('lines', []):
            for span in line.get('spans', []):
                for ch in span['chars']:
                    c = ch['c']
                    if c.isdigit() or c in '()':
                        bx = ch['bbox']
                        chars.append({'c': c, 'x': (bx[0]+bx[2])/2, 'x0': bx[0], 'y': (bx[1]+bx[3])/2})
    for g in tabs:
        ys = g; top, bot = ys[0], ys[-1]
        above = [n for n in notas if n[-1] < top]
        nota = max(above, key=lambda n: n[-1]) if above else None
        rec = {'page': pno+1, 'ytop': top, 'lines': ys, 'nota_top': nota[0] if nota else None,
               'tokens': [], 'anchors': [], 'trips': []}
        # (anchors are validated below: the bar-number row is the longest left-to-right
        #  run of consecutive integers — tuplet digits and stray marks don't form one)
        for w in words:
            wx = (w[0]+w[2])/2; wy = (w[1]+w[3])/2; t = w[4].strip()
            if not re.fullmatch(r'\(?\d{1,2}\)?', t): continue
            if top - 5 <= wy <= bot + 5:
                continue                             # tab frets come from the char stream below
            elif nota and (nota[0]-45) < wy < (nota[0]-3) and '(' not in t \
                    and not any(a <= wy <= b for a, b in tabbands):
                rec['anchors'].append((int(t), round(wx,1)))
            elif t == '3' and (top-16) < wy < (top-4):
                rec['trips'].append(round(wx,1))
        # ── fret capture from chars, with fused-run splitting ──
        # group digit chars per staff line, break runs at x-advance > 5.4, then
        # segment each run into 1-2 digit numbers. Clean runs (≤2 chars) seed the
        # onset-column grid; fused runs are split to best match those columns.
        by_line = {}
        for c in chars:
            if not (top - 3 <= c['y'] <= bot + 3): continue
            si = min(range(6), key=lambda i: abs(ys[i]-c['y']))
            # digits sit ON their line (±~2pt); halfway between lines is 3.2 —
            # a strict 3.0 keeps tuplet marks above the staff out of string 1
            if abs(ys[si]-c['y']) < 3.0: by_line.setdefault(si, []).append(c)
        runs2 = []                                  # (si, [chars]) contiguous same-line runs
        for si, cl in by_line.items():
            cl.sort(key=lambda c: c['x0'])
            cur = [cl[0]]
            for c in cl[1:]:
                if c['x0'] - cur[-1]['x0'] <= 5.4: cur.append(c)
                else: runs2.append((si, cur)); cur = [c]
            runs2.append((si, cur))
        def emit(si, grp, tied):
            digs = ''.join(c['c'] for c in grp if c['c'].isdigit())
            if digs and int(digs) <= 24:
                rec['tokens'].append({'t': ('(%s)' % digs) if tied else digs, 'x': round(sum(c['x'] for c in grp)/len(grp), 1), 'si': si})
        clean, fused = [], []
        for si, cr in runs2:
            tied = any(c['c'] == '(' for c in cr)
            digits = [c for c in cr if c['c'].isdigit()]
            if not digits: continue
            if len(digits) <= 2 and not (len(digits) == 2 and digits[0]['c'] not in '12'):
                clean.append((si, digits, tied))
            elif len(digits) == 2:                   # e.g. '46' = two single-digit onsets fused
                fused.append((si, digits, tied))
            else:
                fused.append((si, digits, tied))
        cols = sorted(sum(c['x'] for c in d)/len(d) for _, d, _ in clean)
        def col_dist(x):
            return min((abs(x - c) for c in cols), default=3.0)
        for si, digits, tied in clean: emit(si, digits, tied)
        for si, digits, tied in fused:
            # DP: partition into 1-2 digit groups (2-digit must start '1'/'2'),
            # minimising total distance of group centers to the column grid
            n2 = len(digits); INF = 1e9
            best = [(INF, None)] * (n2 + 1); best[0] = (0.0, None)
            for i in range(n2):
                if best[i][0] >= INF: continue
                for size in (1, 2):
                    j = i + size
                    if j > n2: continue
                    if size == 2 and digits[i]['c'] not in '12': continue
                    grp = digits[i:j]
                    cost = best[i][0] + col_dist(sum(c['x'] for c in grp)/len(grp)) + (0.4 if size == 1 else 0)
                    if cost < best[j][0]: best[j] = (cost, i)
            cuts, j = [], n2
            while j > 0 and best[j][1] is not None: cuts.append((best[j][1], j)); j = best[j][1]
            if j != 0:                               # DP failed (shouldn't) — fall back greedy 2s
                cuts = [(k, min(k+2, n2)) for k in range(0, n2, 2)]
            for i2, j2 in reversed(cuts): emit(si, digits[i2:j2], tied)
        tabs_all.append(rec)

tabs_all.sort(key=lambda r: (r['page'], r['ytop']))

# 2) validate anchors FIRST: within a system, bar numbers are the longest run of
# CONSECUTIVE integers ascending left-to-right (strays never form one), then a
# global monotonic pass (gaps allowed — percussion bars never anchor a tab staff)
def longest_consecutive_run(cands):
    best = []
    for i in range(len(cands)):
        run = [cands[i]]
        for j in range(i+1, len(cands)):
            if cands[j][0] == run[-1][0] + 1 and cands[j][1] > run[-1][1]: run.append(cands[j])
        if len(run) > len(best): best = run
    return best
last = 0
for r in tabs_all:
    if not r['anchors']: continue
    cands = sorted(set(r['anchors']), key=lambda p: p[1])
    run = longest_consecutive_run(cands)
    # a single candidate is only trusted if it continues the global sequence exactly
    if len(run) == 1 and run[0][0] != last + 1: run = []
    good = [(num, x) for num, x in run if last < num <= last + 12]
    for num, x in good: last = max(last, num)
    r['anchors'] = good

# 3) track id: bar numbers print once per system, above the FIRST part's
# notation staff — so an anchored tab is track 0; unanchored tabs belong to
# the nearest anchored tab above them, and their ordinal below it (1st, 2nd…)
# is their track number (3+ part scores).
track0 = [r for r in tabs_all if r['anchors']]
for r in tabs_all:
    if r['anchors']: r['track'] = 0; continue
    # host must be in THIS system — cap the vertical distance so an anchor-less
    # system never chains onto the previous one with runaway ordinals
    prev0 = [q for q in track0 if q['page'] == r['page'] and 0 < r['ytop'] - q['ytop'] < 320]
    r['host'] = max(prev0, key=lambda q: q['ytop']) if prev0 else None
    r['track'] = None if r['host'] else 0
for r in tabs_all:
    if r['track'] is None:
        sibs = [q for q in tabs_all if q.get('host') is r.get('host') and q['ytop'] < r['ytop']]
        r['track'] = 1 + len(sibs)
print('staves:', len(tabs_all), '| tracks:', sorted({r['track'] for r in tabs_all}), '| last bar:', last)

# 4) onsets → bars per track (same-x digits stack into one onset)
bars = defaultdict(list)
tripmarks = defaultdict(list)
for r in tabs_all:
    ax = r['anchors'] if r['track'] == 0 else (r.get('host') or {}).get('anchors', [])
    if not ax: continue
    toks = sorted(r['tokens'], key=lambda t: t['x'])
    onsets = []
    for t in toks:
        tied = '(' in t['t']; fret = int(t['t'].strip('()'))
        if onsets and t['x'] - onsets[-1]['x'] <= 3.2: onsets[-1]['notes'].append((t['si'], fret, tied))
        else: onsets.append({'x': t['x'], 'notes': [(t['si'], fret, tied)]})
    def bar_of(x, ax=ax):
        num = ax[0][0]
        for k, (bn, bx) in enumerate(ax):
            nxt = ax[k+1][1] if k+1 < len(ax) else 1e9
            if bx - 7 <= x < nxt - 7: num = bn
        return num
    for o in onsets: bars[(r['track'], bar_of(o['x']))].append(o)
    for tx in r['trips']: tripmarks[(r['track'], bar_of(tx))].append(tx)

# 5) durations per bar (sum 4 beats): triplet trios from markers first, then
# straight 8ths, with 16ths on the tightest gaps / quarters on the widest.
songs = defaultdict(list); tiecont = defaultdict(set)
for (trk, num), ons_all in sorted(bars.items()):
    ons = [o for o in ons_all if any(not td for (_, _, td) in o['notes'])]
    if not ons: tiecont[trk].add(num); continue
    n = len(ons)
    if n == 1:      # a single strike = whole-note bar
        songs[trk].append({'bar': num, 'steps': [{'notes': [[si, fr] for (si, fr, td) in ons[0]['notes'] if not td], 'dur': 4}]})
        continue
    durs = [None]*n
    for mx in tripmarks.get((trk, num), []):
        free = [i for i in range(n) if durs[i] is None]
        trio = sorted(free, key=lambda i: abs(ons[i]['x'] - mx))[:3]
        if len(trio) == 3:
            a, b, c = sorted(trio)
            durs[a], durs[b], durs[c] = 0.33, 0.33, 0.34   # thirds that still sum to a clean beat
    rem = [i for i in range(n) if durs[i] is None]
    R = 4 - sum(d for d in durs if d is not None)
    if rem:
        m = len(rem)
        base = [0.5]*m
        s16 = round(2*m - 4*R)
        gaps = {i: (ons[i+1]['x'] - ons[i]['x']) if i+1 < n else 60 for i in rem}
        if s16 > 0:
            for j in sorted(range(m), key=lambda j: gaps[rem[j]])[:min(s16, m)]: base[j] = 0.25
        elif s16 < 0:
            q = round(2*R - m)
            for j in sorted(range(m), key=lambda j: -gaps[rem[j]])[:max(0, q)]: base[j] = 1.0
        # any remaining shortfall (halves, dotted values) lands on the widest-gap note
        short = R - sum(base)
        if abs(short) > 0.01 and m:
            j = max(range(m), key=lambda j: gaps[rem[j]])
            base[j] = max(0.25, round(base[j] + short, 2))
        for j, i in enumerate(rem): durs[i] = base[j]
    # bars denser than the 16th/triplet grid (32nds, sextuplets, boundary bleed)
    # get scaled so every bar closes at exactly 4 beats — relative lengths kept
    total = sum(durs)
    if abs(total - 4) > 0.01 and total > 0:
        durs = [round(d * 4 / total, 3) for d in durs]
    songs[trk].append({'bar': num, 'steps': [{'notes': [[si, fr] for (si, fr, td) in o['notes'] if not td], 'dur': d} for o, d in zip(ons, durs)]})

# 6) whole-note + tie-continuation bar = 8 beats; fill true gaps as rests
out = []
for trk in sorted(songs):
    song = songs[trk]
    by = {b['bar']: b for b in song}
    for num in list(by):
        if num+1 in tiecont[trk] and len(by[num]['steps']) == 1 and by[num]['steps'][0]['dur'] == 4:
            by[num]['steps'][0]['dur'] = 8; tiecont[trk].discard(num+1)
    have = set(by) | {n+1 for n in by if by[n]['steps'][0].get('dur') == 8}
    for m in range(1, max(have)+1):
        if m not in have and m not in tiecont[trk]:
            song.append({'bar': m, 'steps': [{'notes': [], 'dur': 4}]})
    song.sort(key=lambda b: b['bar'])
    total = sum(st['dur'] for b in song for st in b['steps'])
    print(f'track {trk}: {len(song)} bars, {round(total, 2)} beats (bar-perfect = bars x 4, minus triplet rounding)')
    for b in song: out.append({'track': trk, 'bar': b['bar'], 'steps': b['steps']})
json.dump(out, open(OUT, 'w'))
print('wrote', OUT)
