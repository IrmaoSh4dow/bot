# Bot de ventas

Bot de Discord para registrar las compras de un servidor de rol. El departamento paga el saldo global de todos los agentes.

Las ventas se crean solo con `/venta`, dentro del hilo de un agente activo. El bot no lee los mensajes del foro: el intent de contenido de mensajes permanece desactivado.

## Requisitos

- Node.js 20.19 o superior, 22.12 o superior, o 24 o superior
- PostgreSQL 14 o superior
- Una aplicación de bot en el [Discord Developer Portal](https://discord.com/developers/applications)

## Entorno local

```bash
npm install
copy .env.example .env
```

En macOS o Linux: `cp .env.example .env`.

Completa `.env` con tus valores. Ese archivo está en `.gitignore`. El ejemplo solo contiene marcadores vacíos y nombres ficticios (`USUARIO`, `CONTRASENA`, `HOST`).

| Variable | Obligatoria | Predeterminado |
| --- | --- | --- |
| `DISCORD_TOKEN` | Sí | Ninguno. Sin ella el proceso termina |
| `DATABASE_URL` | Sí | Ninguno. Debe empezar por `postgresql://` o `postgres://` |
| `NODE_ENV` | No | `development`. También admite `production` y `test` |
| `FORUM_CHANNEL_ID` | No | Vacío: `/venta` acepta cualquier hilo asociado a un agente |
| `DISCORD_GUILD_ID` | No | Vacío: los comandos se registran de forma global y pueden tardar hasta una hora |
| `DEPARTMENT_TIMEZONE` | No | `America/Bogota`. La semana va de lunes 00:00 al lunes siguiente |
| `ADMIN_ROLE_ID` | No | Vacío. Quien tenga el permiso Administrador de Discord también puede gestionar el departamento |
| `ADMIN_USER_IDS` | No | Vacío. Varios IDs se separan con comas |
| `WEEKLY_SUMMARY_ENABLED` | No | `true` |
| `WEEKLY_SUMMARY_CHANNEL_ID` | No | Vacío: no se publica el resumen automático. `/cobro resumen` sigue disponible |
| `WEEKLY_SUMMARY_HOUR` | No | `23` |
| `WEEKLY_SUMMARY_MINUTE` | No | `0` |

Crea una base vacía, escribe su cadena en `DATABASE_URL` y aplica las migraciones versionadas:

```bash
createdb bot_ventas
npm run db:migrate:deploy
```

Arranque en desarrollo, con recarga al guardar:

```bash
npm run dev
```

Compilación y ejecución de producción:

```bash
npm run build
npm start
```

Al arrancar, el proceso valida las variables obligatorias, conecta con PostgreSQL y comprueba que las migraciones ya están aplicadas. Si falta alguna, termina con error y no inicia sesión en Discord. Los mensajes de error no incluyen el token ni la cadena de conexión.

`SIGINT` y `SIGTERM` cierran el cliente de Discord y la conexión a PostgreSQL.

## Aplicación de Discord

1. Crea una aplicación en el Developer Portal.
2. Abre **Bot**, crea el token y cópialo solo en `.env` o en las variables de Railway. No lo pegues en el chat, en Git ni en los registros.
3. Deja desactivados los intents privilegiados. El bot solo usa el intent de servidores (`Guilds`).
4. En **OAuth2 > URL Generator** marca los alcances `bot` y `applications.commands`.
5. Marca solo estos permisos: Ver canales, Enviar mensajes y Enviar mensajes en hilos.
6. Abre la URL generada e invita el bot al servidor.

El número de permisos de esa combinación es `274877910016`. La URL tiene esta forma, con el ID de tu aplicación:

```text
https://discord.com/api/oauth2/authorize?client_id=ID_DE_LA_APLICACION&permissions=274877910016&scope=bot%20applications.commands
```

`ID_DE_LA_APLICACION` es el Application ID del portal, no el token.

Con `DISCORD_GUILD_ID`, el bot publica `/venta`, `/agente`, `/cobro` y `/pago` solo en ese servidor y aparecen enseguida. Sin esa variable, el registro es global. `commands.set` sustituye la lista de comandos de esta aplicación en el ámbito elegido. No modifica los comandos de otros bots. Si en el pasado registraste los mismos comandos en el otro ámbito, Discord puede mostrarlos duplicados: deja un solo ámbito y borra la copia antigua desde el portal, en la aplicación, no desde otro bot.

`/agente`, `/cobro` y `/pago` quedan ocultos para quien no es administrador del servidor. Si autorizas `ADMIN_ROLE_ID` o `ADMIN_USER_IDS`, en **Ajustes del servidor > Integraciones > bot** permite a ese rol o a esos usuarios usar esos tres comandos. El proceso también comprueba el permiso en cada uso.

## Precios y agentes

La migración crea Vendas, Botiquines y Chalecos sin precio. No inventes importes. Cuando conozcas cada precio real:

```sql
UPDATE products
SET unit_price = <precio>, updated_at = CURRENT_TIMESTAMP
WHERE normalized_name = 'vendas';
```

Repite el `UPDATE` para `botiquines` y `chalecos`. Una venta solo acepta productos activos con precio. El artículo guarda el precio de ese momento; un cambio posterior del catálogo no reescribe las ventas ya hechas.

Da de alta cada agente dentro de su publicación del foro:

```text
/agente alta placa: <placa> nombre: <nombre>
/agente consultar placa: <placa>
/agente desactivar placa: <placa>
```

Si omites el hilo, `/agente alta` usa el hilo actual. La placa y el hilo son únicos. Desactivar conserva las ventas y rechaza ventas nuevas. Si `FORUM_CHANNEL_ID` está definido, el hilo tiene que pertenecer a ese foro.

También puedes insertar el agente con SQL, usando un id propio y el id real del hilo:

```sql
INSERT INTO agents (id, badge_number, discord_thread_id, display_name, active, created_at, updated_at)
VALUES ('<id>', '<placa>', '<id del hilo>', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

## Ventas, resúmenes y pagos

Dentro del hilo del agente:

```text
/venta pedido: 2 vendas, 1 chaleco, 3 botiquines
```

El pedido admite varios productos separados por comas, saltos de línea o `y`. El bot muestra cantidades, precios y total. La venta y sus artículos se escriben en una transacción al pulsar **Confirmar**. El aviso del hilo indica quién la registró. Si Discord no publica ese aviso, **Reintentar aviso** lo envía otra vez sin crear otra venta. `operation_id` impide que un reintento de la misma confirmación duplique la venta.

```text
/cobro resumen
/cobro resumen fecha: AAAA-MM-DD
```

Muestra las ventas de esa semana por agente, los pagos del departamento, el saldo arrastrado y el saldo pendiente actual. Consultarlo no crea pagos ni marca la semana como pagada.

```text
/pago
/pago modalidad: Abono parcial importe: <importe>
```

La modalidad predeterminada es el total del saldo pendiente. Antes de guardar, el bot muestra el saldo anterior, el importe y el saldo restante. El pago se escribe solo al pulsar **Confirmar**. No admite cero, negativos ni un importe mayor que el saldo. Un pago no se asigna a un agente. Lo que no se abona sigue pendiente la semana siguiente.

El domingo, a la hora de `DEPARTMENT_TIMEZONE`, el proceso publica el resumen en `WEEKLY_SUMMARY_CHANNEL_ID` si la automatización está activa y el canal existe. Ese canal debe ser un canal de texto en el que el bot pueda escribir, no el foro de los agentes. Si el proceso estaba apagado, al volver publica los resúmenes vencidos de los últimos 14 días que aún no tienen mensaje, sin duplicarlos y sin registrar pagos. Railway debe mantener una sola réplica: un reinicio vuelve a intentar el envío, y la base conserva el identificador del mensaje ya publicado.

## Railway y GitHub

`railway.toml` define un solo proceso:

- compilación: `npm run build` (`prisma generate` y `tsc`)
- inicio: `npm start` (`node dist/index.js`)
- una réplica y reinicio solo si el proceso falla

Al arrancar, el proceso consulta si `public` ya tiene tablas. Si no hay ninguna, ejecuta `prisma migrate deploy` y solo después abre la sesión de Discord. Si ya hay tablas, no vuelve a ejecutar las migraciones. Una migración que termina con error cierra el proceso con código distinto de cero y el bot no se conecta. El bot tampoco abre un puerto HTTP: no configures un healthcheck ni un comando previo al arranque.

Railway deja de leer `railway.toml` en servicios nuevos y, desde el 1 de diciembre de 2026, también en los antiguos. Si el panel no toma el archivo, escribe a mano: build `npm run build`, start `npm start`. Deja vacío el comando previo al arranque.

`package-lock.json` fija las dependencias. `prisma` está en las dependencias de producción para que la migración pueda ejecutarse en la imagen. `src/generated/` y `dist/` no se versionan: el build los crea en el contenedor. La base vive en PostgreSQL, no en archivos locales del contenedor.

Pasos, cuando autorices la publicación:

1. Crea el repositorio en GitHub y súbelo. Los comandos están al final de este documento.
2. En Railway, crea un proyecto desde ese repositorio.
3. Añade PostgreSQL y referencia su `DATABASE_URL` en el servicio del bot.
4. Define `DISCORD_TOKEN`. Añade el resto de variables solo si quieres cambiar el valor predeterminado.
5. Confirma que no hay comando previo al arranque ni healthcheck. El proceso aplica las migraciones solo si la base está vacía.
6. Despliega. El primer arranque aplica las tres migraciones. Los siguientes ven las tablas y no las vuelven a crear.

No ejecutes `migrate reset` ni borres las migraciones ya versionadas.

## Errores habituales

| Síntoma | Qué revisar |
| --- | --- |
| Faltan variables de entorno | `DISCORD_TOKEN` y `DATABASE_URL` en `.env` o en Railway |
| Token inválido | Genera otro token en el portal y sustituye el anterior. El registro solo dice que el token no es válido |
| No se pudo conectar a PostgreSQL | La cadena, el host y que la base exista. El mensaje no imprime la URL |
| La base no tiene las migraciones | La base estaba vacía y la migración automática falló, o ya había tablas ajenas al bot. Revisa el registro del arranque |
| No aparece `/venta` | Con `DISCORD_GUILD_ID`, reinicia el bot. Sin él, el registro global puede tardar una hora |
| Comandos duplicados | Hay una copia global y otra del servidor. Conserva un solo ámbito |
| Missing Permissions o `50013` | Ver canales, Enviar mensajes y Enviar mensajes en hilos, en el foro y en el canal del resumen |
| Canal desconocido o `10003` | `FORUM_CHANNEL_ID` o `WEEKLY_SUMMARY_CHANNEL_ID` no es el id del canal |
| El producto no tiene precio | El `UPDATE` del catálogo todavía no se ha ejecutado |
| Este hilo no está asociado a un agente | `/agente alta` dentro de esa publicación |
| El resumen dominical no sale | `WEEKLY_SUMMARY_ENABLED`, el canal y la hora. `/cobro resumen` no depende de ese envío |

## Estructura

```text
prisma/
  schema.prisma          Productos, agentes, ventas, periodos y pagos
  migrations/            Tres migraciones reproducibles
prisma.config.ts         Conexión que usa la CLI de Prisma
src/
  index.ts               Arranque, cierre y errores
  config/env.ts          Validación de variables
  discord/               Cliente, comandos y resumen dominical
  database/              Conexión y migraciones del primer arranque
  services/              Catálogo, ventas, agentes, saldo y periodos
railway.toml
```

## Scripts

| Script | Acción |
| --- | --- |
| `npm run dev` | Arranca en desarrollo |
| `npm run build` | Genera el cliente de Prisma y compila TypeScript |
| `npm start` | Ejecuta `dist/index.js` |
| `npm run db:generate` | Regenera el cliente de Prisma |
| `npm run db:migrate` | Crea una migración nueva durante el desarrollo |
| `npm run db:migrate:deploy` | Aplica las migraciones ya existentes |
| `npm run db:validate` | Comprueba el esquema |
| `npm test` | Pruebas unitarias. Las de PostgreSQL solo corren si existe `TEST_DATABASE_URL` |

`TEST_DATABASE_URL` es una base aparte, no `DATABASE_URL`. Si esa base ya tiene ventas o pagos que no sean de prueba, la suite contable se detiene sin modificarlos.

## Publicar

Desde la carpeta del proyecto, cuando quieras subirlo:

```powershell
git init
git add .
git status
git commit -m "Publica el bot de ventas."
gh repo create bot-ventas --private --source=. --remote=origin
git push -u origin HEAD
```

Antes del commit, `git status` no debe mostrar `.env`, `node_modules/`, `dist/` ni `src/generated/`. Después conecta el repositorio en Railway como se describe arriba.
