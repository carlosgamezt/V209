@echo off
title NEXA FEL - demostracion SIMULADA (acceso desde el telefono)
echo Modo TELEFONO: el telefono debe estar en la MISMA red Wi-Fi que esta computadora.
echo Windows puede preguntar si permites el acceso a la red: elige "Redes privadas".
echo Las contrasenas de esta sesion son ALEATORIAS y aparecen abajo (cambian cada vez que inicias).
echo En el telefono abre  http://IP-DE-ESTA-COMPUTADORA:8787/   (la IP aparece abajo)
echo.
ipconfig | findstr /i "IPv4"
echo.
"%~dp0nexa-fel-demo.exe" --lan --abrir
pause
