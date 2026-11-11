-- =====================================================================
-- Escalerilla: resultados de partidos y tabla de puntos.
-- Ejecutar después de schema.sql.
-- =====================================================================

create table if not exists public.partidos (
  id          uuid primary key default gen_random_uuid(),
  reserva_id  text not null unique references public.reservas (id) on delete cascade,
  jugador     uuid not null references public.perfiles (id) on delete cascade,
  rival       uuid not null references public.perfiles (id) on delete cascade,
  sets        jsonb not null,
  ganador     uuid not null references public.perfiles (id) on delete cascade,
  creado      timestamptz not null default now(),
  check (jugador <> rival),
  check (ganador in (jugador, rival))
);
create index if not exists partidos_por_jugador on public.partidos (jugador);
create index if not exists partidos_por_rival on public.partidos (rival);
alter table public.partidos enable row level security;
-- Sin políticas: se lee y escribe solo con las funciones de abajo.

-- Lista de socios para elegir rival (solo con sesión iniciada).
create or replace function public.socios()
returns table (id uuid, nombre text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.nombre from public.perfiles p
  where auth.uid() is not null
  order by p.nombre;
$$;

-- Anotar o corregir el resultado de una reserva propia ya jugada.
create or replace function public.registrar_resultado(p_reserva text, p_rival uuid, p_sets jsonb)
returns public.partidos
language plpgsql security definer set search_path = public
as $$
declare
  hoy     date := (now() at time zone 'America/Santiago')::date;
  hora_ya int  := extract(hour from (now() at time zone 'America/Santiago'))::int;
  res     public.reservas;
  s       jsonb;
  a       int;
  b       int;
  ga      int := 0;
  gb      int := 0;
  v_out   public.partidos;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;
  select * into res from public.reservas where id = p_reserva;
  if not found or res.user_id <> auth.uid() then
    raise exception 'Solo quien reservó puede anotar el resultado.';
  end if;
  if res.estado <> 'confirmada' then
    raise exception 'Esa reserva fue anulada.';
  end if;
  if res.fecha > hoy or (res.fecha = hoy and res.hora > hora_ya) then
    raise exception 'Podrás anotar el resultado cuando empiece el partido.';
  end if;
  if p_rival is null or p_rival = auth.uid() or not exists (select 1 from public.perfiles where id = p_rival) then
    raise exception 'Elige al socio contra quien jugaste.';
  end if;
  if jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) not between 1 and 3 then
    raise exception 'Anota entre 1 y 3 sets.';
  end if;
  for s in select * from jsonb_array_elements(p_sets) loop
    if jsonb_typeof(s) <> 'array' or jsonb_array_length(s) <> 2 then
      raise exception 'Cada set debe tener los juegos de ambos jugadores.';
    end if;
    a := (s ->> 0)::int; b := (s ->> 1)::int;
    if a is null or b is null or a < 0 or b < 0 or a > 99 or b > 99 then
      raise exception 'Revisa los números del marcador.';
    end if;
    if a = b then
      raise exception 'Un set no puede terminar empatado.';
    end if;
    if a > b then ga := ga + 1; else gb := gb + 1; end if;
  end loop;
  if ga = gb then
    raise exception 'Quedan empatados en sets. Anota el set que definió el partido.';
  end if;

  insert into public.partidos (reserva_id, jugador, rival, sets, ganador)
  values (p_reserva, auth.uid(), p_rival, p_sets, case when ga > gb then auth.uid() else p_rival end)
  on conflict (reserva_id) do update
     set rival = excluded.rival, sets = excluded.sets, ganador = excluded.ganador, creado = now()
  returning * into v_out;
  return v_out;
end;
$$;

-- Borrar un resultado: quien lo anotó o el administrador.
create or replace function public.borrar_resultado(p_reserva text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.partidos
   where reserva_id = p_reserva and (jugador = auth.uid() or public.es_admin());
  if not found then
    raise exception 'No puedes borrar ese resultado.';
  end if;
end;
$$;

-- Tabla de la escalerilla (todos los socios registrados).
create or replace function public.escalerilla()
returns table (id uuid, nombre text, pj int, pg int, pp int, dif int, pts int)
language sql stable security definer set search_path = public
as $$
  with cfg as (
    select coalesce((datos ->> 'puntosGanar')::int, 3) as pg_pts,
           coalesce((datos ->> 'puntosPerder')::int, 0) as pp_pts
    from public.config where id = 1
  ),
  j as (
    select jugador as socio, ganador from public.partidos
    union all
    select rival as socio, ganador from public.partidos
  ),
  t as (
    select p.id, p.nombre,
           count(j.socio)::int as pj,
           count(*) filter (where j.ganador = p.id)::int as pg,
           count(*) filter (where j.socio is not null and j.ganador <> p.id)::int as pp
    from public.perfiles p
    left join j on j.socio = p.id
    group by p.id, p.nombre
  )
  select t.id, t.nombre, t.pj, t.pg, t.pp, t.pg - t.pp, t.pg * cfg.pg_pts + t.pp * cfg.pp_pts
  from t, cfg
  where auth.uid() is not null
  order by 7 desc, 6 desc, t.nombre;
$$;

-- Últimos partidos con nombres.
create or replace function public.partidos_recientes(p_limite int default 50)
returns table (reserva_id text, fecha date, hora int, cancha int,
               jugador_id uuid, jugador text, rival_id uuid, rival text,
               ganador_id uuid, sets jsonb)
language sql stable security definer set search_path = public
as $$
  select m.reserva_id, r.fecha, r.hora, r.cancha,
         m.jugador, pj.nombre, m.rival, pr.nombre, m.ganador, m.sets
  from public.partidos m
  join public.reservas r on r.id = m.reserva_id
  join public.perfiles pj on pj.id = m.jugador
  join public.perfiles pr on pr.id = m.rival
  where auth.uid() is not null
  order by r.fecha desc, r.hora desc
  limit least(greatest(coalesce(p_limite, 50), 1), 500);
$$;

revoke execute on function public.socios() from public, anon;
revoke execute on function public.registrar_resultado(text, uuid, jsonb) from public, anon;
revoke execute on function public.borrar_resultado(text) from public, anon;
revoke execute on function public.escalerilla() from public, anon;
revoke execute on function public.partidos_recientes(int) from public, anon;
grant execute on function public.socios() to authenticated;
grant execute on function public.registrar_resultado(text, uuid, jsonb) to authenticated;
grant execute on function public.borrar_resultado(text) to authenticated;
grant execute on function public.escalerilla() to authenticated;
grant execute on function public.partidos_recientes(int) to authenticated;

update public.config
   set datos = datos || '{"puntosGanar": 3, "puntosPerder": 0}'::jsonb
 where id = 1 and not (datos ? 'puntosGanar');

-- ---------------------------------------------------------------------
-- Ranking por puestos (reglamento Escalerilla 2026):
-- cada socio entra al final cuando crea su cuenta; si alguien de más
-- abajo le gana a alguien de más arriba, toma su puesto y los demás bajan uno.
-- 1 punto por partido ganado, 0 por perdido.
-- ---------------------------------------------------------------------
create or replace function public.ranking()
returns table (puesto int, id uuid, nombre text, pj int, pg int, pp int, dif int, pts int)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  arr   uuid[] := '{}';
  ev    record;
  w     uuid;
  l     uuid;
  wi    int;
  li    int;
  n     int;
  p_g   int;
  p_p   int;
begin
  if auth.uid() is null then
    return;
  end if;
  select coalesce((c.datos ->> 'puntosGanar')::int, 1), coalesce((c.datos ->> 'puntosPerder')::int, 0)
    into p_g, p_p from public.config c where c.id = 1;
  for ev in
    select 0 as k, p.id as a, null::uuid as b, null::uuid as g, p.creado as t
    from public.perfiles p
    union all
    select 1, m.jugador, m.rival, m.ganador,
           ((r.fecha + make_interval(hours => r.hora)) at time zone 'America/Santiago')
    from public.partidos m join public.reservas r on r.id = m.reserva_id
    order by 5, 1
  loop
    if array_position(arr, ev.a) is null then arr := arr || ev.a; end if;
    if ev.k = 1 then
      if array_position(arr, ev.b) is null then arr := arr || ev.b; end if;
      w := ev.g;
      l := case when ev.g = ev.a then ev.b else ev.a end;
      wi := array_position(arr, w);
      li := array_position(arr, l);
      if wi > li then
        n := coalesce(array_length(arr, 1), 0);
        arr := arr[1:li - 1] || w || array_remove(arr[li:n], w);
      end if;
    end if;
  end loop;
  return query
    select o.ord::int, p.id, p.nombre,
           coalesce(s.pj, 0)::int, coalesce(s.pg, 0)::int, coalesce(s.pj - s.pg, 0)::int,
           coalesce(2 * s.pg - s.pj, 0)::int,
           coalesce(s.pg * p_g + (s.pj - s.pg) * p_p, 0)::int
    from unnest(arr) with ordinality as o(pid, ord)
    join public.perfiles p on p.id = o.pid
    left join lateral (
      select count(*) as pj, count(*) filter (where m.ganador = p.id) as pg
      from public.partidos m where p.id in (m.jugador, m.rival)
    ) s on true
    order by o.ord;
end;
$$;

revoke execute on function public.ranking() from public, anon;
grant execute on function public.ranking() to authenticated;
revoke execute on function public.escalerilla() from authenticated;

update public.config set datos = datos || '{"puntosGanar": 1, "puntosPerder": 0}'::jsonb where id = 1;
