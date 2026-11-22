import base64,re,os
E='elem/elementos/'
h=open('src/head_body.html').read()
b=lambda p: base64.b64encode(open(p,'rb').read()).decode()
h=h.replace('__LOBSTER__',b('fonts/fontsource-lobster-5.3.0/files/lobster-latin-400-normal.woff2')).replace('__NUNITO7__',b('fonts/nunito/files/nunito-latin-700-normal.woff2')).replace('__NUNITO8__',b('fonts/nunito/files/nunito-latin-800-normal.woff2')).replace('__LILITA__',b('fonts/fontsource-lilita-one-5.3.0/files/lilita-one-latin-400-normal.woff2'))
def mini(f):
    s=open(E+f,encoding='utf-8').read()
    s=re.sub(r'<\?xml[^>]*\?>','',s); s=re.sub(r'\s+data-name="[^"]*"','',s)
    s=re.sub(r'>\s+<','><',s); s=re.sub(r'\n\s*',' ',s)
    assert '</script' not in s
    return s.strip()
files={'vert':'fondo_vertical.svg','horiz':'fondo-horizontal.svg','luces':'luces.svg','entera':'pinata_entera.svg','rota':'pinata_rota.svg','rota2':'pinata_rota2.svg','frutas':'frutas.svg'}

# --- letrero final (Feliz Navidad + deseos)
L=open(E+'letras.svg',encoding='utf-8').read()
cls=dict(re.findall(r'\.(st\d+)\s*\{\s*fill:\s*(#[0-9a-fA-F]+);',L))
for k in ['st1','st2','st3','st5','st6']: cls[k]=cls['st4']   # todos los deseos del color de Alegría
L=re.sub(r'<\?xml[^>]*\?>','',L); L=re.sub(r'<!--.*?-->','',L,flags=re.S); L=re.sub(r'<defs>.*?</defs>','',L,flags=re.S)
L=re.sub(r'class="(st\d+)"',lambda m:f'fill="{cls[m.group(1)]}"'+('' if m.group(1)=='st7' else ' fill-rule="evenodd"'),L)
L=L.replace(' id="Capa_1"','')
names=iter(['w-Amor','w-Alegria','w-Salud'])
L=re.sub(r'<g>',lambda m:f'<g id="{next(names)}">',L)
for i,d in enumerate(['M139.8','M313.5','M442.9'],1):
    L=re.sub(r'(<path[^>]*d="'+re.escape(d)+r'[^"]*"/>)',rf'<g id="c{i}" class="cm">\1</g>',L)
L=L.replace('<g id="coma-abundancia">','<g id="c4" class="cm">').replace('<g id="abundancia">','<g id="w-Abundancia">').replace('<g id="amistad">','<g id="w-Amistad">')
L=re.sub(r'>\s+<','><',L).strip()
for k in ['w-Amor','w-Alegria','w-Salud','w-Abundancia','w-Amistad','c1','c2','c3','c4']: assert f'id="{k}"' in L, k
iw=L.index('<g id="w-Amor"'); ie=L.index('<g id="encabezado"')
VB=re.search(r'viewBox="[^"]*"',L).group(0)
title=(L[:iw]+'</svg>').replace(VB,'viewBox="0 0 470.1 116" class="title-svg" aria-hidden="true"')
words=(L[:ie]+L[iw:]).replace(VB,'viewBox="6 206 452 104" class="words-svg" aria-hidden="true"')
h=h.replace('__TITLE_SVG__',title).replace('__WORDS_SVG__',words)
svgs=''.join(f'<script type="text/plain" id="svg-{k}">{mini(v)}</script>\n' for k,v in files.items())+f'<script type="text/plain" id="svg-letras">{L}</script>\n'
aud=''.join(f'<script type="text/plain" id="aud-{k}">{base64.b64encode(open("audio/"+k+".mp3","rb").read()).decode()}</script>\n' for k in ['cancion','porra','jingle'])
out=h+svgs+aud+'<script>\n'+open('src/game.js').read()+'</script>\n</body>\n</html>\n'
open('index.html','w').write(out); print(len(out))
