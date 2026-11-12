# NEXA FEL · demostración PRIVADA en línea (SIMULADA, sin valor fiscal). Contexto de construcción: la carpeta «fel/».
#   docker build -f demo-facturacion/Dockerfile -t nexa-fel-demo .
# Variables OBLIGATORIAS (secretos del servicio, nunca en la imagen): FEL_DEMO_CLAVES, FEL_DEMO_MFA_SEMILLAS, FEL_DEMO_HOSTS. Ver docs/demostracion-en-linea-seguridad-y-costos.md.
FROM denoland/deno:2.9.6
WORKDIR /app
COPY . /app
WORKDIR /app/demo-facturacion
RUN deno cache servidor.ts && chown -R deno:deno /deno-dir /app
USER deno
ENV PORT=8080 FEL_DEMO_PUBLICADO=1 FEL_DEMO_LOGIN=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD ["deno", "eval", "fetch('http://127.0.0.1:'+Deno.env.get('PORT')+'/salud').then(r=>Deno.exit(r.ok?0:1)).catch(()=>Deno.exit(1))"]
# permisos mínimos: red, lectura de la aplicación y entorno; sin escritura en disco ni subprocesos
CMD ["run", "--allow-net", "--allow-read=/app,/deno-dir", "--allow-env", "servidor.ts"]
