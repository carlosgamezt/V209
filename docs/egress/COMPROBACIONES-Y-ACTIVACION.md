# Comprobaciones desde tu dispositivo y activación progresiva (v516 + super-api)
Todo lo de abajo está **apagado por omisión**. Cada paso se puede deshacer. Las comprobaciones 1–3 no cambian nada.

## 1. Miniaturas (E1) — 1 minuto
1. Abre NEXA en el navegador de tu computadora con tu cuenta de administrador.
2. Menú **Evidencias** (o **Historial de evidencias**) y baja por la lista.
3. Deben verse las miniaturas de las fotos de cada actividad (no cuadros grises ni vacíos). Si algunas se ven en blanco, avísame cuáles; si NINGUNA se ve, dímelo antes de cualquier otro paso.

## 2. ¿OneDrive acepta descargas directas desde el navegador (CORS)? — 1 minuto
1. Entra como administrador y espera a que carguen los planes. Presiona **F12** → pestaña **Console** (Consola).
2. Pega esto completo y presiona Enter (si Chrome pide escribir `allow pasting`, escríbelo y vuelve a pegar):
```js
(async()=>{const p=db.plans.find(x=>x.acts.some(a=>a.ev&&a.ev.o));if(!p)return'no hay un plan con foto original';const a=p.acts.find(a=>a.ev&&a.ev.o);const n=origName(a.ev.k,a.ev.x||'jpg');const u=await PhotoCloud.url(n);if(!u)return'la función no entregó enlace';const host=new URL(u).host;try{const r=await fetch(u,{credentials:'omit'});return 'LEE BIEN desde '+host+': HTTP '+r.status+', '+(await r.blob()).size+' bytes'}catch(e){return 'BLOQUEADO (CORS/red) desde '+host+': '+e}})()
```
3. Debe responder `LEE BIEN desde <algo>.sharepoint.com` (o `1drv`/`microsoftpersonalcontent`). **Cópiame la línea completa.** Si el dominio termina en `supabase.co` o dice `BLOQUEADO`, no se activa la descarga directa (todo sigue igual que hoy, sin pérdida).

## 3. ¿OneDrive acepta subidas directas (CORS)? — 1 minuto
Misma consola; pega esto y Enter:
```js
(async()=>{const n='prueba_cors_'+Date.now()+'.jpg';const b=await PhotoCloud.call({action:'put_begin',name:n,size:5});if(!b.ok)return'put_begin falló: '+b.error;const host=new URL(b.uploadUrl).host;try{const r=await fetch(b.uploadUrl,{method:'PUT',headers:{'Content-Range':'bytes 0-4/5'},body:new Uint8Array([1,2,3,4,5]),credentials:'omit',referrerPolicy:'no-referrer'});return 'SUBE BIEN en '+host+': HTTP '+r.status+' (borra el archivo '+n+' de la carpeta PlanesAccion/evidencias de OneDrive)'}catch(e){return 'BLOQUEADO (CORS/red) en '+host+': '+e}})()
```
Debe responder `SUBE BIEN … HTTP 201` (o 200). Cópiame la línea. Deja un archivo de 5 bytes llamado `prueba_cors_…jpg` en OneDrive: bórralo a mano.

## 4. Piloto de OneDrive directo SOLO en tu computadora (reversible)
Requisito: pasos 2 y 3 en verde. **Activar:** en la consola escribe `localStorage.setItem('nx_od_pilot','1')`, recarga la página (F5) y entra como administrador. **Probar:** (a) descarga un plan con fotos (botón de descarga del plan): debe bajar el ZIP completo; (b) abre **F12 → Network (Red)**, escribe `super-api` en el filtro, repite la descarga: antes veías muchas peticiones `photo_data` de varios MB; ahora no deben aparecer (o casi ninguna); (c) sube una foto a una actividad de prueba y comprueba que se ve completa al abrirla. **Apagar:** `localStorage.removeItem('nx_od_pilot')` y recarga. Si algo falla, la app usa sola el camino anterior; igual avísame. Para probar en Android hace falta activarlo por configuración (necesito tu autorización para publicar `odDirect: 'admin'`, solo administradores).

## 5. Piloto de la caché persistente SOLO en tu computadora (reversible)
**Activar:** consola → `localStorage.setItem('nx_cache_pilot','1')`, recarga y entra como administrador (la primera vez baja todo, como siempre). **Probar:** cierra la pestaña, ábrela de nuevo y entra: debe abrir más rápido, con los mismos planes. En F12 → Network, filtra `pa_docs`: la segunda entrada debe bajar mucho menos (unos KB). Al **cerrar sesión** (botón Salir) la copia se borra. **Apagar:** `localStorage.removeItem('nx_cache_pilot')`; la próxima vez que abras la app se borra la copia local. Solo funciona con cuentas de administrador.

## 6. Autorización de fotos: observar y luego obligar (super-api)
Al publicar, la función arranca en modo **registro** (no bloquea a nadie). **Observar:** supabase.com → tu proyecto → **Edge Functions** → `super-api` → pestaña **Logs**; busca (caja de búsqueda) `photo_auth_deny` y `push_auth_deny`. Cada línea indica el rol y el nombre de la foto que se habría negado. Lo normal es no ver ninguna durante 1–2 días de uso real. Si ves alguna de una persona que sí debía tener acceso, avísame y la corrijo antes de obligar. **Obligar:** **Edge Functions → Secrets** (o Project Settings → Edge Functions → Secrets) → **Add new secret** → nombre `PHOTO_AUTH`, valor `enforce` → Save. **Deshacer al instante:** cambia ese secreto a `off` (o bórralo para volver al modo registro).

## 7. Retirar el CRON_SECRET antiguo (verificado: nada lo usa)
Dependencias revisadas: `super-api` (código recibido) no lo usa; `recordatorios-de-nexa` ya no lo lee (usa el secreto de la base); las 4 tareas programadas leen el secreto de la base y ninguna lo tiene escrito (consultado en producción); `arqueos` y `supervision-sucursal` no lo usan. **Retirarlo:** Project Settings → Edge Functions → Secrets → fila `CRON_SECRET` → menú ⋮ → Delete. Después revisa que las tareas sigan en 200 (te lo confirmo yo en la verificación de las 12:22 UTC).

## 8. Consumo real (a los 3 días completos)
Supabase → **Project Settings → Usage** (o Organization → Usage) → **Egress** → rango «Last 7 days» o el ciclo actual. Anota el total diario de los últimos días. Nota: las tareas programadas leen por PostgreSQL → función (tráfico interno), que puede o no contarse como Egress; si el número baja pero no lo suficiente, lo medimos por rutas con los registros de la API.

## 9. Android: activación solo para administrador (v517, preparada, NO publicada)
**Qué cambia:** en la configuración de la app (`PA_CONFIG`) quedan `odDirect: 'admin'`, `cache: true` y `cacheRoles: ['admin']`. Solo las cuentas de administrador usan la descarga/subida directa de OneDrive y la copia local (modo sesión: se borra al cerrar sesión). Sucursal, supervisor, inventarios y los demás siguen exactamente igual que hoy. Probado: configuración real, por rol, en escritorio y en pantalla de teléfono (`activacion_test.cjs`).
**Antes de publicar:** tu piloto en PC (§4 y §5) sin problemas y los registros `photo_auth_deny` sin casos legítimos. Cuando me autorices, publico solo ese cambio (v517) y lo verifico.
**Comprobación en el Android (con tu cuenta de administrador):**
1. Cierra y abre NEXA (si la instalaste como app, ciérrala del todo y ábrela). En el encabezado debe verse **v517**. Si ves v516, abre NEXA en Chrome, espera unos segundos y vuelve a abrirla.
2. Descarga un plan con fotos: el archivo debe abrir completo, con las fotos nítidas (no miniaturas).
3. Sube una foto a una actividad de prueba; luego mira desde la computadora que se vea completa.
4. Cierra sesión (Salir), vuelve a entrar con el mismo usuario: debe cargar normal (la copia local se borró al salir).
5. Entra con una cuenta de sucursal en el mismo teléfono: debe verse y funcionar igual que antes (sin cambios).
**Confirmar que de verdad va directo (no por Supabase), desde la computadora:** (a) En el Android: Ajustes → Acerca del teléfono → toca 7 veces «Número de compilación»; luego Ajustes → Sistema → Opciones de desarrollador → activa «Depuración por USB». (b) Conecta el teléfono a la computadora por USB y acepta el aviso en el teléfono. (c) En Chrome de la computadora abre `chrome://inspect/#devices`, espera a que aparezca el teléfono con la pestaña de NEXA y presiona **inspect**. (d) En la ventana que abre: pestaña **Network**, escribe `super-api` en el filtro, haz la descarga del plan desde el teléfono: NO deben aparecer peticiones `photo_data` (sí pueden verse `get`, que son pequeñas); y las fotos deben bajar desde un dominio `sharepoint.com`. Si ves muchos `photo_data`, la descarga directa no se usó (el teléfono cayó al camino anterior): avísame con una captura.
**Reversión:** se publica `odDirect: false` y `cache: false` (cada una por separado si hace falta). Además, cada equipo se autoprotege 24 horas tras un fallo de OneDrive, y al apagar la copia local se borra sola en la siguiente apertura de la app. No pierde datos ni fotos.
