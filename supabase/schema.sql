-- =====================================================================
-- Club de Tenis Peralillo · Base de datos para la app de arriendo
-- Pegar completo en Supabase → SQL Editor → Run (una sola vez).
-- =====================================================================

-- ---------- Administradores ----------
-- Se agregan a mano desde el SQL Editor (ver README).
create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade
);
alter table public.admins enable row level security;
-- Sin políticas: nadie la lee ni la modifica desde la app.

create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- Perfiles de jugadores ----------
create table if not exists public.perfiles (
  id        uuid primary key references auth.users on delete cascade,
  nombre    text not null check (char_length(nombre) between 2 and 80),
  telefono  text not null check (char_length(telefono) between 8 and 20),
  socio     boolean not null default false,
  creado    timestamptz not null default now()
);
alter table public.perfiles enable row level security;

drop policy if exists "perfil: ver propio o admin" on public.perfiles;
create policy "perfil: ver propio o admin" on public.perfiles
  for select using (id = auth.uid() or public.es_admin());

drop policy if exists "perfil: crear propio" on public.perfiles;
create policy "perfil: crear propio" on public.perfiles
  for insert with check (id = auth.uid());

drop policy if exists "perfil: editar propio" on public.perfiles;
create policy "perfil: editar propio" on public.perfiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------- Configuración del club (precios, horarios, feriados, reglas) ----------
create table if not exists public.config (
  id          int primary key default 1 check (id = 1),
  datos       jsonb not null,
  actualizado timestamptz not null default now()
);
alter table public.config enable row level security;

drop policy if exists "config: todos leen" on public.config;
create policy "config: todos leen" on public.config
  for select using (true);

drop policy if exists "config: admin edita" on public.config;
create policy "config: admin edita" on public.config
  for update using (public.es_admin()) with check (public.es_admin());

insert into public.config (id, datos) values (1, '{
  "precioSemana": 16000,
  "precioFinde": 16000,
  "mananaHasta": 12,
  "diasAnticipacion": 7,
  "limiteFinde": 2,
  "jornadaSemana": [{"ini":8,"fin":10},{"ini":10,"fin":12},{"ini":16,"fin":18},{"ini":18,"fin":20},{"ini":20,"fin":21}],
  "jornadaFinde":  [{"ini":8,"fin":10},{"ini":10,"fin":12},{"ini":12,"fin":14},{"ini":14,"fin":16},{"ini":16,"fin":18}],
  "feriados": [
    {"fecha":"2026-10-31","nombre":"Día de las Iglesias Evangélicas"},
    {"fecha":"2026-11-01","nombre":"Todos los Santos"},
    {"fecha":"2026-12-08","nombre":"Inmaculada Concepción"},
    {"fecha":"2026-12-25","nombre":"Navidad"},
    {"fecha":"2027-01-01","nombre":"Año Nuevo"},
    {"fecha":"2027-03-26","nombre":"Viernes Santo"},
    {"fecha":"2027-03-27","nombre":"Sábado Santo"},
    {"fecha":"2027-05-01","nombre":"Día del Trabajo"},
    {"fecha":"2027-05-21","nombre":"Glorias Navales"},
    {"fecha":"2027-06-21","nombre":"Día de los Pueblos Indígenas"},
    {"fecha":"2027-06-28","nombre":"San Pedro y San Pablo"},
    {"fecha":"2027-07-16","nombre":"Virgen del Carmen"},
    {"fecha":"2027-08-15","nombre":"Asunción de la Virgen"},
    {"fecha":"2027-09-18","nombre":"Independencia Nacional"},
    {"fecha":"2027-09-19","nombre":"Glorias del Ejército"},
    {"fecha":"2027-10-11","nombre":"Encuentro de Dos Mundos"},
    {"fecha":"2027-10-31","nombre":"Día de las Iglesias Evangélicas"},
    {"fecha":"2027-11-01","nombre":"Todos los Santos"},
    {"fecha":"2027-12-08","nombre":"Inmaculada Concepción"},
    {"fecha":"2027-12-25","nombre":"Navidad"}
  ]
}'::jsonb)
on conflict (id) do nothing;

-- ---------- Reservas ----------
create table if not exists public.reservas (
  id             text primary key default ('CTP-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6))),
  user_id        uuid not null references public.perfiles (id) on delete cascade,
  cancha         int  not null check (cancha in (1, 2)),
  fecha          date not null,
  hora           int  not null check (hora between 0 and 23),
  fin            int  not null check (fin between 1 and 24),
  socio          boolean not null,
  precio         int  not null check (precio >= 0),
  estado         text not null default 'confirmada' check (estado in ('confirmada', 'anulada', 'liberada')),
  creado         timestamptz not null default now(),
  cambio_estado  timestamptz
);

-- Impide que dos personas tomen la misma cancha a la misma hora.
create unique index if not exists reservas_un_horario
  on public.reservas (cancha, fecha, hora) where estado = 'confirmada';
create index if not exists reservas_por_fecha on public.reservas (fecha);
create index if not exists reservas_por_usuario on public.reservas (user_id, fecha);

alter table public.reservas enable row level security;

drop policy if exists "reservas: ver propias o admin" on public.reservas;
create policy "reservas: ver propias o admin" on public.reservas
  for select using (user_id = auth.uid() or public.es_admin());
-- Sin políticas de insert/update: todo cambio pasa por las funciones de abajo,
-- que aplican las reglas del club en el servidor.

-- ---------- Funciones de apoyo ----------
create or replace function public.dia_especial(p_fecha date, cfg jsonb)
returns boolean
language sql immutable
as $$
  select extract(isodow from p_fecha) in (6, 7)
      or exists (
        select 1 from jsonb_array_elements(coalesce(cfg -> 'feriados', '[]'::jsonb)) f
        where f ->> 'fecha' = p_fecha::text
      );
$$;

-- Horarios ocupados (sin datos personales): lo usa la grilla de disponibilidad.
create or replace function public.ocupados(desde date, hasta date)
returns table (cancha int, fecha date, hora int)
language sql stable security definer set search_path = public
as $$
  select r.cancha, r.fecha, r.hora
  from public.reservas r
  where r.estado = 'confirmada' and r.fecha between desde and hasta;
$$;

-- Crear una reserva aplicando todas las reglas del club.
create or replace function public.reservar(p_cancha int, p_fecha date, p_hora int)
returns public.reservas
language plpgsql security definer set search_path = public
as $$
declare
  cfg      jsonb;
  hoy      date := (now() at time zone 'America/Santiago')::date;
  hora_ya  int  := extract(hour from (now() at time zone 'America/Santiago'))::int;
  esp      boolean;
  v_fin    int;
  v_socio  boolean;
  v_precio int;
  v_lim    int;
  v_dias   int;
  n        int;
  r        public.reservas;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para reservar.';
  end if;

  select datos into cfg from public.config where id = 1;
  select socio into v_socio from public.perfiles where id = auth.uid();
  if not found then
    raise exception 'Completa tu perfil antes de reservar.';
  end if;

  if p_cancha not in (1, 2) then
    raise exception 'Esa cancha no existe.';
  end if;

  v_dias := coalesce((cfg ->> 'diasAnticipacion')::int, 7);
  if p_fecha < hoy or p_fecha >= hoy + v_dias then
    raise exception 'Solo puedes reservar con hasta % días de anticipación.', v_dias;
  end if;
  if p_fecha = hoy and p_hora <= hora_ya then
    raise exception 'Ese horario ya pasó.';
  end if;

  esp := public.dia_especial(p_fecha, cfg);

  select (b ->> 'fin')::int into v_fin
  from jsonb_array_elements(cfg -> (case when esp then 'jornadaFinde' else 'jornadaSemana' end)) b
  where (b ->> 'ini')::int = p_hora
  limit 1;
  if v_fin is null then
    raise exception 'Ese horario no está disponible ese día.';
  end if;

  v_lim := coalesce((cfg ->> 'limiteFinde')::int, 2);
  if esp and v_lim > 0 then
    select count(*) into n
    from public.reservas
    where user_id = auth.uid()
      and estado = 'confirmada'
      and public.dia_especial(fecha, cfg)
      and date_trunc('week', fecha) = date_trunc('week', p_fecha);
    if n >= v_lim then
      raise exception 'Ya tienes % reservas en fin de semana o feriado esa semana, que es el máximo por persona. Anula una para pedir otra.', v_lim;
    end if;
  end if;

  v_precio := case
    when v_fin <= coalesce((cfg ->> 'mananaHasta')::int, 12) then 0
    when esp then (case when v_socio then 0 else coalesce((cfg ->> 'precioFinde')::int, 16000) end)
    else coalesce((cfg ->> 'precioSemana')::int, 16000)
  end;

  begin
    insert into public.reservas (user_id, cancha, fecha, hora, fin, socio, precio)
    values (auth.uid(), p_cancha, p_fecha, p_hora, v_fin, v_socio, v_precio)
    returning * into r;
  exception when unique_violation then
    raise exception 'Ese horario se acaba de ocupar. Elige otro.';
  end;

  return r;
end;
$$;

-- El jugador anula su propia reserva y la cancha queda libre.
create or replace function public.anular(p_id text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.reservas
     set estado = 'anulada', cambio_estado = now()
   where id = p_id and user_id = auth.uid() and estado = 'confirmada';
  if not found then
    raise exception 'No encontramos esa reserva o ya estaba anulada.';
  end if;
end;
$$;

-- El administrador libera una cancha reservada.
create or replace function public.liberar(p_id text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede liberar canchas.';
  end if;
  update public.reservas
     set estado = 'liberada', cambio_estado = now()
   where id = p_id and estado = 'confirmada';
  if not found then
    raise exception 'Esa reserva ya no está activa.';
  end if;
end;
$$;

-- Permisos de ejecución
revoke all on function public.reservar(int, date, int) from public, anon;
revoke all on function public.anular(text) from public, anon;
revoke all on function public.liberar(text) from public, anon;
grant execute on function public.reservar(int, date, int) to authenticated;
grant execute on function public.anular(text) to authenticated;
grant execute on function public.liberar(text) to authenticated;
grant execute on function public.ocupados(date, date) to anon, authenticated;
grant execute on function public.es_admin() to anon, authenticated;
