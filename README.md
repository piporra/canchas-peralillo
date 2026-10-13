# App de canchas · Club de Tenis Peralillo

App web para arrendar las canchas del club. Se instala en el celular desde el navegador.
Usa **Supabase** (base de datos y cuentas) y se publica gratis en **Vercel** desde **GitHub**.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `app.js`, `styles.css` | La app |
| `config.js` | La conexión con tu proyecto de Supabase (lo completas en el paso 3) |
| `supabase/schema.sql` | Crea las tablas, las reglas del club y la seguridad |
| `manifest.webmanifest`, `sw.js`, íconos | Permiten instalarla como app en el celular |

---

## Paso 1 · Crear el proyecto en Supabase

1. En supabase.com, entra a **Projects → New project**.
2. Nombre: `club-tenis-peralillo`. Región: **South America (São Paulo)**, que es la más cercana a Chile.
3. Anota la contraseña de la base de datos en un lugar seguro y espera a que el proyecto termine de crearse.

## Paso 2 · Crear la base de datos

1. En el proyecto nuevo, abre **SQL Editor → New query**.
2. Copia y pega **todo** el contenido de `supabase/schema.sql`.
3. Toca **Run**. Debe decir *Success*.

Esto deja cargados los horarios, los precios, los feriados y las reglas que definimos.

## Paso 3 · Configurar las cuentas

1. Abre **Authentication → Sign In / Providers → Email**.
2. Desactiva **Confirm email** y guarda.
   Así cada persona crea su cuenta y entra de inmediato. El correo gratuito de Supabase
   permite enviar muy pocos correos por hora, y con la confirmación activa el registro se trabaría.
3. Abre **Project Settings → API** (o **API Keys**) y copia:
   - **Project URL**
   - La clave **anon** o **publishable** (nunca la *service_role* ni la *secret*).
4. Pégalas en `config.js`.

## Paso 4 · Subir a GitHub

La forma más simple es desde el navegador:

1. En github.com, crea un repositorio nuevo (por ejemplo `canchas-peralillo`).
2. En el repositorio vacío, toca **uploading an existing file**.
3. Arrastra **todos los archivos y la carpeta `supabase`** (no la carpeta contenedora) y toca **Commit changes**.

Si prefieres la terminal en Windows, abre **PowerShell** dentro de la carpeta del proyecto y ejecuta:

```powershell
git init
git add .
git commit -m "App de canchas Club de Tenis Peralillo"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/canchas-peralillo.git
git push -u origin main
```

## Paso 5 · Publicar en Vercel

1. En vercel.com, toca **Add New → Project** e importa el repositorio `canchas-peralillo`.
2. En **Framework Preset** elige **Other**. No hace falta configurar nada más.
3. Toca **Deploy**. Quedará en una dirección como `canchas-peralillo.vercel.app`.

## Paso 6 · Avisar a Supabase la dirección de la app

1. En Supabase, abre **Authentication → URL Configuration**.
2. En **Site URL** pon la dirección de Vercel (por ejemplo `https://canchas-peralillo.vercel.app`) y agrégala también en **Redirect URLs**.

Esto hace que los enlaces de "¿Olvidaste tu contraseña?" lleven a la app.

## Paso 7 · Hacerte administrador

1. Abre la app y toca **Perfil → Ingresar o crear cuenta → Crear cuenta**.
2. En Supabase, abre **SQL Editor** y ejecuta (con tu correo):

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'tu-correo@ejemplo.cl';
```

3. Cierra y vuelve a abrir la app. Aparecerá la pestaña **Admin**.

Para sumar otro administrador, repite el paso 2 con su correo (esa persona debe haber creado su cuenta antes).
Para quitar uno:

```sql
delete from public.admins
where user_id = (select id from auth.users where email = 'correo@ejemplo.cl');
```

## Paso 8 · Instalar en el celular

- **Android (Chrome):** abre la dirección y toca **⋮ → Agregar a la pantalla principal** (o **Instalar app**).
- **iPhone (Safari):** abre la dirección y toca **Compartir → Agregar a inicio**.

Queda con el logo del club como ícono y se abre como una app.

---

## Qué protege la base de datos

- Nadie puede tomar una cancha ya reservada, aunque dos personas toquen confirmar al mismo tiempo.
- Las reglas se revisan en el servidor: anticipación máxima, horarios del día, límite de fin de semana y feriados, y precio.
- Cada jugador ve solo sus propias reservas y sus datos. La grilla de disponibilidad muestra horarios ocupados, sin nombres.
- Solo los administradores ven los datos de contacto, liberan canchas y cambian precios, horarios y feriados.

## Notas

- Ser socio lo marca cada persona al crear su cuenta. Se puede verificar al momento del pago en la Municipalidad.
- Supabase gratis pausa un proyecto tras 1 semana sin uso. Con reservas frecuentes no debería pasar.
  Si ocurre, se reactiva desde el panel de Supabase.
- Para recuperar contraseñas sin el límite de correos de Supabase, se puede conectar un servicio de correo propio
  en **Authentication → Emails → SMTP Settings**.
