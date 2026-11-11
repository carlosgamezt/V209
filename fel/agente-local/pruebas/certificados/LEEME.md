# Certificados SOLO PARA PRUEBAS
Certificados autofirmados de prueba (válidos 100 años) para probar la validación estricta de TLS del agente contra un servidor HTTPS local:
- `localhost.*`: nombre `localhost` / IP `127.0.0.1` (el agente lo acepta solo si se le indica explícitamente como CA de prueba).
- `otro.*`: nombre `otro.example` (sirve para probar que un certificado de OTRO nombre se rechaza aunque se confíe en él).
Las claves privadas de esta carpeta **no protegen nada real**: se generaron para las pruebas y no se usan en ningún otro sitio.
