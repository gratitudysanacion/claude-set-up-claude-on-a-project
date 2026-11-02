# ISAMOR AI – Diseño de la administración de usuarios
## Versión 1 · 2 de noviembre de 2026 · Estado: **APROBADO por la usuaria el 2 nov 2026; IMPLEMENTADO y EN PRODUCCIÓN**

> No contiene contraseñas, claves ni valores de variables de entorno.

## 1. Objetivo y origen

Hasta el 2 de noviembre, crear un usuario o cambiar una clave exigía la terminal del servidor y reiniciar el asistente. Esa dependencia se hizo evidente cuando la usuaria no pudo entrar a producción por una clave equivocada. Su propuesta: un módulo en la propia página para **crear usuarios, cambiar contraseñas e inactivar usuarios**.

## 2. Decisiones de la usuaria

| Tema | Decisión |
|---|---|
| Alternativa elegida | **A**: módulo de administración dentro de la aplicación (frente a seguir con scripts por terminal o delegar en autenticación externa) |
| Aprobación | "Apruebo diseño usuarios; yo soy la administradora por ahora" |
| Administradoras | **Una por ahora**; el código admite varias |
| Claves temporales | **Sí**: la administradora pone una clave temporal y la persona debe cambiarla al entrar (nadie conoce la clave definitiva de otra persona) |

## 3. Funciones

| Función | Detalle |
|---|---|
| Menú **Usuarios** | Solo lo ven las administradoras, y aparece **después de iniciar sesión** en un módulo |
| Crear usuario | Usuario, clave temporal, módulos y rol (usuaria o administradora) |
| Restablecer clave | Clave temporal nueva; cierra las sesiones abiertas de esa persona; no sirve para la propia cuenta |
| **Cambiar mi clave** | Botón en la barra de sesión para todos los usuarios; pide la clave actual |
| Módulos y rol | Editables por usuaria |
| **Inactivar / Reactivar** | Nada se borra. Un usuario inactivo no puede entrar y sus sesiones se invalidan al instante |
| Lista | Usuario, rol, módulos, estado, último acceso y si tiene una clave temporal pendiente de cambio |

## 4. Reglas y salvaguardas

| Regla | Detalle |
|---|---|
| Nombre de usuario | De 3 a 32 caracteres: minúsculas, números, punto, guion y guion bajo |
| Clave | Mínimo 12 y máximo 200 caracteres; distinta del usuario; no un mismo carácter repetido |
| Clave temporal | Hasta cambiarla, solo se puede cambiarla o cerrar sesión: `/api/chat`, `/api/gestor/*` y `/api/admin/*` responden 403 con `codigo: cambiar_clave`. Vale también para una administradora con clave temporal |
| No inactivarte | Una administradora no puede inactivar su propia cuenta ni quitarse el rol |
| Siempre una administradora | No se puede dejar el sistema sin ninguna administradora activa |
| Mensaje de entrada genérico | Un usuario inactivo recibe el mismo mensaje y tarda lo mismo que uno con clave mala: no se revela si existe |
| Límite de intentos | Cinco fallos por IP en 10 minutos bloquean 15 minutos. **Cambiar la propia clave comparte ese contador** (con una sesión robada no se puede adivinar la clave actual) |
| Sesiones | Se cierran las de la persona al restablecer, inactivar o cuando ella cambia su clave (la sesión desde la que cambió se conserva) |
| Claves en pantalla | Campos de tipo contraseña que se vacían tras enviar; nunca se vuelven a mostrar |
| Auditoría | Cada acción (crear, actualizar, restablecer clave, cambio de clave propia) registra quién, qué y a quién en el registro de PM2 (`evento: admin_usuarios`), **sin claves** |
| CSRF | Las escrituras desde otro origen se rechazan |

## 5. Almacenamiento

- `data/usuarios.json` (permisos 600): por usuario, `alg`, `sal`, `hash` (scrypt), `modulos`, y opcionalmente `rol`, `activo`, `cambiar_clave`, `creado`, `ultimo_acceso`, `clave_cambiada`. Nunca contiene claves.
- Cada cambio se hace sobre una **copia**, se guarda y solo entonces se adopta: si el disco falla, no queda nada a medias.
- Escritura **atómica** (archivo temporal y renombrado) y copia de la versión anterior en `data/usuarios.json.anterior` (permisos 600).
- Las modificaciones se ejecutan de a una (cola): dos administradoras no se pisan.
- Los cambios aplican **en caliente**, sin reiniciar. Editar el archivo a mano sí exige reiniciar.

## 6. Interfaz

`public/usuarios.js`, `public/app.js`, `public/index.html` y `public/styles.css`. Todo el contenido dinámico se escribe con `textContent`; sin HTML ni estilos en línea (CSP estricta). Probada en escritorio y celular (390 px, sin desborde horizontal). Mejora anotada: un acceso de inicio de sesión visible desde la pantalla de inicio, porque hoy el menú Usuarios no aparece hasta iniciar sesión dentro de un módulo.

## 7. Pruebas

| Tipo | Detalle |
|---|---|
| Automáticas | 12 del núcleo (`test/usuarios.test.js`) y 5 de la API con servidor y archivo reales (`test/admin-api.test.js`), dentro de las 225 de la suite |
| Casos cubiertos | Creación y validaciones, duplicados, fallo al guardar, creaciones simultáneas del mismo nombre (con guardado lento), cambio de clave y límite por IP, restablecer, inactivar y reactivar, sesiones que dejan de valer, última administradora, lista sin hashes, permisos del archivo, auditoría sin claves |
| Navegador real | 18 comprobaciones (`verificacion/e2e-usuarios.js`): creación, cambio obligatorio de clave, errores, inactivar, reactivar, restablecer, edición de módulos, archivo sin claves en claro, CSP, celular |
| Mutaciones | Se rompió el código a propósito en 15 puntos; 14 detectados. La restante (no cerrar sesiones al inactivar) es una redundancia legítima: cada petición ya invalida la sesión de un usuario inactivo |

## 8. Despliegue

Probado el 2 nov en el servidor de pruebas (usuario de prueba creado desde la pantalla) y desplegado a producción con `deploy/actualizar.sh`, con respaldo completo previo. Ver `GUIA_DESPLIEGUE_Y_ACTUALIZACION.md`.

## 9. Riesgos y pendientes

| Riesgo | Mitigación |
|---|---|
| Pérdida de la única administradora | Una administradora no puede inactivarse ni quitarse el rol; si se perdiera su clave, se restablece con `scripts/crear-usuario.js` en el servidor (conserva el rol) |
| Editar `usuarios.json` a mano a la vez que la aplicación escribe | No editar a mano con la aplicación en marcha; existe `usuarios.json.anterior` |
| Claves temporales compartidas por canales inseguros | La pantalla lo advierte; se invalidan al primer cambio |
| Recuperación por correo | No existe: lo hace una administradora |
