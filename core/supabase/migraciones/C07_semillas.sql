-- NEXA CORE · C07 · semillas: módulo «core» (permisos, roles plantilla y eventos de plataforma). Los demás módulos se registran con su manifiesto (core/manifiestos/*.json) mediante api.pla_modulo_registrar.
begin;
select core.registrar_manifiesto($m$
{"modulo":"core","nombre":"NEXA CORE","descripcion":"Identidad, empresas, usuarios, permisos, suscripciones y módulos","version_api":1,"aprovisionable":false,
 "permisos":[
  {"codigo":"empresa.ver","descripcion":"Ver los datos de la empresa"},
  {"codigo":"empresa.editar","descripcion":"Editar los datos de la empresa"},
  {"codigo":"miembros.ver","descripcion":"Ver las personas de la empresa"},
  {"codigo":"miembros.gestionar","descripcion":"Invitar, cambiar roles y suspender personas","sensible":true},
  {"codigo":"roles.gestionar","descripcion":"Crear y editar roles propios de la empresa","sensible":true},
  {"codigo":"suscripcion.ver","descripcion":"Ver el plan y la suscripción"},
  {"codigo":"modulos.ver","descripcion":"Ver los módulos de la empresa"},
  {"codigo":"modulos.gestionar","descripcion":"Activar y desactivar módulos del plan","sensible":true},
  {"codigo":"config.ver","descripcion":"Ver la configuración de la empresa y de sus módulos"},
  {"codigo":"config.editar","descripcion":"Cambiar la configuración","sensible":true},
  {"codigo":"auditoria.ver","descripcion":"Ver la auditoría de la empresa"}],
 "roles":[
  {"codigo":"propietario","nombre":"Propietario","permisos":["empresa.ver","empresa.editar","miembros.ver","miembros.gestionar","roles.gestionar","suscripcion.ver","modulos.ver","modulos.gestionar","config.ver","config.editar","auditoria.ver"]},
  {"codigo":"administrador","nombre":"Administrador","permisos":["empresa.ver","empresa.editar","miembros.ver","miembros.gestionar","suscripcion.ver","modulos.ver","config.ver","config.editar","auditoria.ver"]},
  {"codigo":"lector","nombre":"Lector","permisos":["empresa.ver","miembros.ver","suscripcion.ver","modulos.ver"]}],
 "eventos":[
  {"tipo":"empresa_creada","descripcion":"Se creó una empresa"},{"tipo":"empresa_estado_cambiado","descripcion":"Cambió el estado de una empresa"},
  {"tipo":"miembro_agregado","descripcion":"Una persona se unió a la empresa"},{"tipo":"miembro_roles_cambiados","descripcion":"Cambiaron los roles de una persona"},{"tipo":"miembro_estado_cambiado","descripcion":"Se suspendió o reactivó a una persona"},
  {"tipo":"suscripcion_cambiada","descripcion":"Cambió el plan o la suscripción"},
  {"tipo":"modulo_activacion_solicitada","descripcion":"Se pidió activar un módulo (el módulo debe aprovisionarlo)"},{"tipo":"modulo_desactivacion_solicitada","descripcion":"Se pidió desactivar un módulo"},
  {"tipo":"modulo_activado","descripcion":"El módulo confirmó su activación"},{"tipo":"modulo_desactivado","descripcion":"El módulo confirmó su desactivación"},{"tipo":"modulo_error_aprovisionamiento","descripcion":"El aprovisionamiento de un módulo falló tras los reintentos"},
  {"tipo":"config_cambiada","descripcion":"Cambió la configuración"}]}
$m$::jsonb);
commit;
