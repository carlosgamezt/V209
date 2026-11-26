# NEXA FEL · Plan de arquitectura multiempresa para comercialización (PROPUESTA · 26/11/2026)

Reglas: solo `fel-proveedores-diseno`; sin migraciones, publicaciones ni producción sin autorización expresa; Digifact solo TEST hasta nueva orden. Este plan sale de revisar el código y las migraciones existentes; el estado de la base hospedada no se pudo verificar desde la sesión de desarrollo.

## 1. Lo que ya existe (se aprovecha)
| Tema | Existe hoy |
|---|---|
| Modelo multiempresa | Tablas `empresas`, `establecimientos` (código SAT por empresa), `miembros`, `perfiles`, `invitaciones`, `cuentas_comerciales`, `empresa_canales` + `proveedores_emision` (canal y ambiente por empresa), `empresa_tipos_documento`, `regimenes_fiscales`; RLS en todas; `empresa_id` en documentos, operaciones, consumos, auditoría. |
| Aislamiento fiscal | Operaciones con escritura previa (`operaciones_fiscales`, `digifact_operaciones`) por empresa; referencia única; concurrencia e idempotencia con pruebas de 2 empresas; límites por empresa (`limites_peticiones`). |
| Digifact por empresa | `ServicioFelGt` ya pide `clienteDe(empresaId)` y `emisorDe(empresaId)` por empresa; el token vive dentro de cada cliente (no se comparte). |
| Administración de plataforma | `plataforma_admins`, panel «Plataforma» (empresas, planes, tarifas, contratos, consumo, bolsón) y `autorizaciones_maestro` (permiso con motivo ≥10 caracteres, vence en 24 h, auditado). Todo simulado en pagos. |
| Interfaz | Facturación completa y adaptada a 360–1100 px; MFA TOTP y usuarios/invitaciones en `fel/app` (cliente de Supabase Auth). |

## 2. Lo que hay que modificar
| Hoy | Problema | Cambio |
|---|---|---|
| Credenciales y emisor de Digifact en variables de entorno de la función (`FEL_DIGIFACT_TEST_EMPRESA` = UNA empresa) | Hay que redesplegar para cada empresa | Configuración por empresa en la base, credenciales cifradas, cliente creado a demanda |
| Consulta NIT/CUI y correo: interruptores `FEL_DIGIFACT_*_EMPRESA` (una empresa) | Igual | Interruptores por empresa en la base; el interruptor global del entorno queda como freno de emergencia |
| `empresa_canales`: solo canales simulados pueden habilitarse (cerrojo de la fase) y `digifact` figura «sin integración» | Impide el canal real | Relajar el cerrojo solo para `pruebas` y solo con configuración aprobada |
| Inicio de sesión propio de la demostración (`demo_credenciales`) | No es apto para clientes reales | Decidir identidad (ver decisiones) |
| Panel maestro puede, por diseño de la demo, ver todo | Debe no ver datos fiscales | Separar vistas: agregados sin contenido; datos fiscales solo con acceso excepcional |

## 3. Lo que falta desarrollar
Almacén cifrado de credenciales por empresa · asistente «Conectar Digifact» para el administrador de la empresa · aprobación y huella de los datos del emisor por empresa · alta de empresas sin código ni despliegue · acceso excepcional del maestro con motivo, vencimiento, auditoría y aviso · consumo y límites reales por plan · envío de invitaciones · procedimiento de alta/baja de empresas · monitoreo y alertas por empresa.

## 4. Decisiones previas (necesito tu respuesta)
1. **Identidad:** (a) Supabase Auth con MFA, como `fel/app`, o (b) mantener el inicio de sesión propio. Recomiendo (a): ya existen las claves a `auth.users`, MFA y recuperación.
2. **Credenciales de Digifact:** cifrado de sobre en la función (AES-GCM con una llave maestra como secreto de la función, `empresa_id` como dato asociado y versión de llave para rotarla; sin costo nuevo) frente a Supabase Vault. Recomiendo el cifrado de sobre: la base solo guarda texto cifrado y el maestro, aun con acceso a SQL, no lo puede leer. No verifiqué si Vault está disponible en tu proyecto.
3. **Migración 30** (tipos de documento): su aplicación sigue pendiente de tu autorización y la numeración de las siguientes (la propuesta de la 31 para NCRE) debe ordenarse.
4. **Cada empresa necesita su propia cuenta de Digifact** (usuario, contraseña y NIT). Confirma que el modelo comercial lo permite.

## 5. Etapas
| # | Etapa | Contenido | Pruebas / condición |
|---|---|---|---|
| 0 | Decisiones | Las 4 de arriba; lista de datos que pide cada empresa | Sin código |
| 1 | Datos (migración aditiva, NO ejecutada) | `empresa_digifact_config` (nit, usuario, secreto cifrado + versión de llave, ambiente, banderas NIT/CUI/correo/certificar, estado, aprobación); `empresa_emisor_fiscal` (datos y huella aprobada por una persona); `acceso_maestro_datos` (permisos excepcionales); auditoría. Secretos solo de escritura: ningún `select` devuelve el cifrado. Maestro sin permiso sobre documentos, clientes ni credenciales. | PostgreSQL temporal y CI; pruebas de RLS cruzada entre empresas y del maestro; reversión probada |
| 2 | Servicio por empresa | `crearDigifactDesdeEntorno` pasa a un resolvedor por empresa con caché corta (60 s) e invalidación al editar; descifra solo al usarlo; falla cerrado. NIT/CUI/correo/certificación según la empresa. Se conserva el freno global y TEST-only | Dos o más empresas: tokens, credenciales y referencias no se mezclan; concurrencia e idempotencia intactas; ningún secreto en registros ni encabezados |
| 3 | Administración de la empresa (teléfono y computadora) | Asistente «Conectar Digifact»: credenciales (solo escritura), prueba de conexión sin certificar, datos del emisor con aprobación, establecimientos, usuarios, roles e invitaciones, prueba de NIT/CUI | e2e a 360/412/1100 px; permisos por rol |
| 4 | Panel del maestro | Alta de empresa + administrador por invitación + plan sin código ni despliegue; suspender/reactivar; consumo agregado (cantidades, no contenido); acceso excepcional (motivo, 24 h, auditoría, aviso a la empresa) | Pruebas negativas: el maestro no lee documentos ni credenciales |
| 5 | Operación comercial | Límites y consumo reales por plan; pasarela de pago (decisión aparte); correo de invitaciones; límites de uso de Digifact por empresa; alertas; respaldo y alta/baja de empresas; piloto con 1–2 empresas en TEST | Piloto controlado |
| 6 | Producción (BLOQUEADA) | Firma electrónica del emisor, credenciales de producción por empresa, matriz de frases SAT V2.2, pruebas SAT, contingencia | Solo con tu autorización expresa |

## 6. Riesgos abiertos
- Con N empresas habrá N inicios de sesión de Digifact por instancia de la función; no se conocen los límites de login de Digifact (pregunta abierta en `docs/digifact/integracion-pendiente.md`).
- Se necesita la matriz de frases SAT V2.2 y el catálogo de códigos de Digifact para cubrir otros regímenes.
- El primer costo variable real es Supabase (instancias y base); sin otros servicios nuevos en este plan.
