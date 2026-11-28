# NEXA CORE
Infraestructura común de NEXA: **identidad centralizada, empresas, usuarios con una o varias empresas, roles y permisos por empresa y módulo, planes y suscripciones, activación/aprovisionamiento de módulos, configuración, auditoría y eventos**. Cada módulo (NEXA, FEL, POS, Hotel, Colegios…) conserva su proyecto de Supabase, sus tablas y su lógica; CORE solo decide quién es la persona, a qué empresa pertenece, qué módulos tiene contratados y qué puede hacer en cada uno.
Reglas: `CLAUDE.md` y `docs/egress/ESTANDAR-DESARROLLO-NEXA.md` §8 (obligatorios). Estado: **desarrollo local, sin publicar, sin proyecto de Supabase** (ver decisiones pendientes).
- `docs/AUDITORIA-COMPATIBILIDAD.md` — qué existe hoy (NEXA v517, NEXA FEL), qué se reutiliza y qué decisiones faltan.
- `docs/ARQUITECTURA.md` — modelo de datos, contratos de API/eventos, seguridad, escalabilidad y cómo se agrega un módulo.
- `supabase/migraciones/C00…C07` y `reversion.sql` — esquema `core` (interno), `api` (personas), `core_sys` (módulos); idempotentes y reversibles.
- `manifiestos/*.json` — borradores de manifiesto de NEXA, FEL, POS, Hotel y Colegios (cada módulo los confirma).
- Pruebas: `pruebas/core/suite_core.sh` (PostgreSQL local + mutaciones). **No toca ningún proyecto real.**
