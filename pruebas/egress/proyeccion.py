#!/usr/bin/env python3
"""Proyección de consumo mensual por versión y número de usuarios a partir de las MEDICIONES por sesión de `escala.cjs` (resultados/escala_*.json).
Supuestos explícitos (cámbialos abajo): composición = 3 administradores + 5 supervisores + resto sucursales; 70 % de los usuarios activos mensuales usan la app cada día; 26 días hábiles al mes;
cada día: 1 inicio de sesión + 4 h con la app abierta; administradores y supervisores además 30 min en Arqueos. Los puntos no medidos se extrapolan (ajuste potencial sobre lo medido) y se marcan con *."""
import json, glob, math, sys
D = sys.argv[1] if len(sys.argv) > 1 else 'resultados'
ADM, SUP, DAU, DIAS, HORAS, ARQ_MIN = 3, 5, 0.7, 26, 4, 30
VERS = ['v512', 'v513_P0', 'v513_E1', 'v513_E1_E2', 'v514_completa']
ETQ = {'v512': 'v512 original', 'v513_P0': 'v513 (P0)', 'v513_E1': 'v513 + E1', 'v513_E1_E2': 'v513 + E1 + E2', 'v514_completa': 'v514 completa (+caché*)'}
R = {}
for f in glob.glob(f'{D}/escala_*.json'):
    for x in json.load(open(f))['resultados']:
        if 'error' in x and not x.get('admin'): continue
        R.setdefault(x['version'], {})[x['B']] = x
def met(v, B, rol, k):
    x = R.get(v, {}).get(B, {}).get(rol)
    if not x: return None
    if k == 'login': return (x['login_caliente'] if v == 'v514_completa' else x['login_frio'])['raw']
    if k == 'login_frio': return x['login_frio']['raw']
    if k == 'hora': return x['hora_visible']['raw']
    if k == 'arq': return x.get('arqueos_5min', {}).get('raw', 0)
    if k == 'n_login': return x['login_frio']['n']
def fit(v, rol, k, B):
    pts = [(b, met(v, b, rol, k)) for b in sorted(R.get(v, {})) if met(v, b, rol, k) is not None and met(v, b, rol, k) > 0]
    if B in dict(pts): return dict(pts)[B], False
    if len(pts) < 2: return None, True
    xs = [math.log(b) for b, _ in pts]; ys = [math.log(y) for _, y in pts]; n = len(xs); mx = sum(xs) / n; my = sum(ys) / n
    sl = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs); ic = my - sl * mx
    return math.exp(ic + sl * math.log(B)), True
def dia(v, rol, B):
    e = False; tot = 0
    for k, mult in (('login', 1), ('hora', HORAS), ('arq', ARQ_MIN / 5 if rol != 'sucursal' else 0)):
        if mult == 0: continue
        y, ex = fit(v, rol, k, B); e = e or ex
        if y is None: return None, True
        tot += mult * y
    return tot, e
def mes(v, U):
    B = U - ADM - SUP; e = False; tot = 0
    for rol, n in (('admin', ADM), ('supervisor', SUP), ('sucursal', B)):
        d, ex = dia(v, rol, B)
        if d is None: return None, True
        e = e or ex; tot += n * d
    return tot * DAU * DIAS, e
G = lambda b: f"{b/1e9:,.2f} GB" if b >= 1e8 else f"{b/1e6:,.0f} MB"
print('POR SESIÓN (medido; bytes brutos, sin comprimir)')
print(f"{'versión':26}{'B':>5}  {'inicio admin':>13}{'inicio suc.':>13}{'hora abierta admin':>20}{'hora abierta suc.':>19}")
for v in VERS:
    for B in sorted(R.get(v, {})):
        a, s = R[v][B].get('admin'), R[v][B].get('sucursal')
        if not a or not s: continue
        la = (a['login_caliente'] if v == 'v514_completa' else a['login_frio'])['raw']; ls = (s['login_caliente'] if v == 'v514_completa' else s['login_frio'])['raw']
        print(f"{ETQ[v]:26}{B:5}  {la/1e3:11,.0f}KB{ls/1e3:11,.0f}KB{a['hora_visible']['raw']/1e3:18,.0f}KB{s['hora_visible']['raw']/1e3:17,.0f}KB")
print('\nPROYECCIÓN MENSUAL (supuestos en la cabecera del archivo; * = extrapolado de lo medido)')
Us = (35, 100, 250, 500, 1000)
print(f"{'usuarios activos mensuales':28}" + ''.join(f"{u:>18}" for u in Us))
ref = {u: mes('v512', u)[0] for u in Us}
for v in VERS:
    row = ''
    for u in Us:
        m, e = mes(v, u); row += f"{(G(m) + ('*' if e else '')) if m is not None else 'n/d':>18}"
    print(f"{ETQ[v]:28}{row}")
print(f"{'Ahorro de v514 vs v512':28}" + ''.join(f"{(1-mes('v514_completa',u)[0]/ref[u])*100:17.1f}%" for u in Us if mes('v514_completa', u)[0] and ref[u]))
print(f"\nDefinición de usuarios: activos mensuales = U; activos diarios = {int(DAU*100)} % de U; concurrentes ≈ 20–25 % de los diarios (no cambian la cantidad total de datos, sí el pico de conexiones Realtime: límite gratuito 200).")

# ---- tiempo estimado de carga del inicio de sesión (solo red; sin contar el procesamiento local del navegador)
BW, RTT = 10e6, 0.08      # 4G típica: 10 Mbps y 80 ms por solicitud (cota superior: las solicitudes se ejecutan en secuencia)
print(f"\nINICIO DE SESIÓN: tiempo de red estimado en 4G ({BW/1e6:.0f} Mbps, {int(RTT*1000)} ms/solicitud, cota superior; el procesamiento local no está incluido)")
print(f"{'versión':26}{'usuarios':>9}{'admin':>12}{'sucursal':>12}")
for v in ('v512', 'v513_E1', 'v514_completa'):
    for u in (35, 250, 1000):
        B = u - ADM - SUP; row = []
        for rol in ('admin', 'sucursal'):
            by, _ = fit(v, rol, 'login', B)
            n = R[v][max(R[v], key=lambda b: -abs(b - B))][rol]['login_frio' if v != 'v514_completa' else 'login_caliente']['n']
            row.append(f"{by*8/BW + n*RTT:9.1f} s")
        print(f"{ETQ[v]:26}{u:9}{row[0]:>12}{row[1]:>12}")
print("\nDESCARGA DE PLANES (aparte de la matriz): con las fotos originales, v512–v513 mueven 1.33 MB de Supabase por cada MB de foto original descargada (base64) → 23.3 MB por un plan de 7 fotos de 2.5 MB (medido); v514 con OneDrive legible: ~0.")
