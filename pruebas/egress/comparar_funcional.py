#!/usr/bin/env python3
"""Compara lo que ve cada rol (referencia vs optimizada). Uso: python3 comparar_funcional.py [pc|movil]"""
import json, sys
m = sys.argv[1] if len(sys.argv) > 1 else 'pc'
B = json.load(open(f'resultados/funcional_referencia_{m}.json')); X = json.load(open(f'resultados/funcional_optimizada_{m}.json'))
for rol in B:
    if rol == 'escritura': continue
    b, x = B[rol], X[rol]; dif = []
    for k in ('planesVisibles', 'sinLeer', 'estados', 'errores'):
        if b.get(k) != x.get(k): dif.append(k)
    if b['avisos'] != x['avisos']: dif.append(f"avisos {b['avisos']} vs {x['avisos']} (esperado: la vista omite avisos de más de 45 días ya leídos por todos)")
    for v in b['vistas']:
        if b['vistas'][v].get('texto') != x['vistas'][v].get('texto'): dif.append(f'vista {v}: texto (solo si difiere por estados «Cargando…»/«Comprobando…» de llamadas a funciones; ver informe)')
        if b['vistas'][v].get('fotos') != x['vistas'][v].get('fotos'): dif.append(f"vista {v}: fotos {b['vistas'][v].get('fotos')} vs {x['vistas'][v].get('fotos')}")
    bd, xd = b.get('detalle'), x.get('detalle')
    if bd and (bd['texto'] != xd['texto'] or bd['fotos'] != xd['fotos']): dif.append('detalle del plan')
    print(f"{rol:13} planes={len(b['planesVisibles']):3} vistas={len(b['vistas']):2} ->", 'IDÉNTICO' if not dif else dif)
print('escritura (referencia):', json.dumps(B['escritura'])); print('escritura (optimizada):', json.dumps(X['escritura']))
