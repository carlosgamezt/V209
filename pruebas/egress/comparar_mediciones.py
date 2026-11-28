#!/usr/bin/env python3
"""Compara las mediciones de consumo (antes / solo P0 / P0+P1). Uso: python3 comparar_mediciones.py [carpeta=resultados]"""
import json, sys
d = sys.argv[1] if len(sys.argv) > 1 else 'resultados'
B, P0, P1 = [json.load(open(f'{d}/medicion_{n}.json'))['escenarios'] for n in ('base', 'p0', 'p1')]
mb = lambda x: f"{x/1e6:7.2f}"
print(f"{'escenario':34}{'ANTES n':>8}{'MB':>9}{'| P0 n':>8}{'MB':>9}{'| P0+P1 n':>10}{'MB':>9}{'  ahorro P0':>11}{'  ahorro P0+P1':>14}")
for k in B:
    if k.startswith('errores'): continue
    b = B[k].get('total'); a = P0.get(k, {}).get('total'); c = P1.get(k, {}).get('total')
    if not b: continue
    sv = lambda x: (f"{100*(1-x['raw']/b['raw']):.0f}%" if b['raw'] else '-') if x else '-'
    print(f"{k:34}{b['n']:8}{mb(b['raw']):>9}{a['n']:8}{mb(a['raw']):>9}{c['n']:10}{mb(c['raw']):>9}{sv(a):>11}{sv(c):>14}")
