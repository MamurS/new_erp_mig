"""
Builds public/fonts/uz-marks-<weight>.woff2: two glyphs of Golos Text (SIL OFL 1.1) for the
Uzbek Latin marks that Golos, Rubik and JetBrains Mono lack or draw differently:
  U+02BB ʻ (oʻ, gʻ)  ← Golos's left quotation mark glyph
  U+02BC ʼ (tutuq)   ← Golos's own U+02BC glyph
Run: pip install fonttools brotli && python3 scripts/build-uz-marks.py
"""
from fontTools import subset
from fontTools.ttLib import TTFont

SRC = 'node_modules/@fontsource/golos-text/files/golos-text-latin-{w}-normal.woff2'
OUT = 'public/fonts/uz-marks-{w}.woff2'
for w in (400, 500, 600, 700):
    font = TTFont(SRC.format(w=w))
    cmap = font.getBestCmap()
    left, mod = cmap[0x2018], cmap[0x2BC]
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = []
    opts.drop_tables += ['GPOS', 'GSUB', 'STAT', 'vhea', 'vmtx', 'gasp', 'prep']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(glyphs=[left, mod])
    sub.subset(font)
    for table in font['cmap'].tables:
        table.cmap = {0x2BB: left, 0x2BC: mod}
    for rec in font['name'].names:
        if rec.nameID in (1, 4, 16):
            rec.string = 'MIG Uz Marks'
        elif rec.nameID == 6:
            rec.string = 'MIGUzMarks'
    font.flavor = 'woff2'
    font.save(OUT.format(w=w))
    print(OUT.format(w=w))
