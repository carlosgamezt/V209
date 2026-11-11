@echo off
rem Doble clic para abrir el agente de NEXA FEL. No hace falta escribir comandos.
chcp 65001 >nul
title Agente NEXA FEL
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js en este equipo.
  echo  Esta version de prueba lo necesita; la instalacion definitiva lo incluira.
  echo  Instala Node.js 22 desde https://nodejs.org y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
node "%~dp0panel.mjs" %*
if errorlevel 1 (
  echo.
  echo  El agente se cerro con un problema. Copia el mensaje de arriba y envialo a soporte.
  pause
)
