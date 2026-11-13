-- =====================================================================
-- Partidos sin reserva: el administrador registra partidos jugados fuera
-- de la app (jugadores, día, hora y cancha) y anota el resultado después.
-- Ejecutar después de escalerilla.sql. (Las funciones ranking() y
-- partidos_recientes() de este archivo reemplazan a las de escalerilla.sql.)
-- =====================================================================
alter table public.partidos alter column reserva_id drop not null;
alter table public.partidos alter column sets drop not null;
alter table public.partidos alter column ganador drop not null;
alter table public.partidos add column if not exists fecha date;
alter table public.partidos add column if not exists hora int check (hora between 0 and 23);
alter table public.partidos add column if not exists cancha int check (cancha in (1, 2));
alter table public.partidos add constraint partidos_con_fecha check (reserva_id is not null or (fecha is not null and hora is not null and cancha is not null));
alter table public.partidos add constraint partidos_resultado_completo check ((sets is null) = (ganador is null));

create or replace function public.ranking()
returns table (puesto int, id uuid, nombre text, pj int, pg int, pp int, dif int, pts int)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  arr uuid[] := '{}'; ev record; w uuid; l uuid; wi int; li int; n int; p_g int; p_p int;
begin
  if auth.uid() is null then return; end if;
  select coalesce((c.datos ->> 'puntosGanar')::int, 1), coalesce((c.datos ->> 'puntosPerder')::int, 0)
    into p_g, p_p from public.config c where c.id = 1;
  for ev in
    select 0 as k, p.id as a, null::uuid as b, null::uuid as g, p.creado as t from public.perfiles p
    union all
    select 1, m.jugador, m.rival, m.ganador,
           ((coalesce(r.fecha, m.fecha) + make_interval(hours => coalesce(r.hora, m.hora))) at time zone 'America/Santiago')
    from public.partidos m left join public.reservas r on r.id = m.reserva_id
    where m.ganador is not null
    order by 5, 1
  loop
    if array_position(arr, ev.a) is null then arr := arr || ev.a; end if;
    if ev.k = 1 then
      if array_position(arr, ev.b) is null then arr := arr || ev.b; end if;
      w := ev.g; l := case when ev.g = ev.a then ev.b else ev.a end;
      wi := array_position(arr, w); li := array_position(arr, l);
      if wi > li then
        n := coalesce(array_length(arr, 1), 0);
        arr := arr[1:li - 1] || w || array_remove(arr[li:n], w);
      end if;
    end if;
  end loop;
  return query
    select o.ord::int, p.id, p.nombre,
           coalesce(s.pj, 0)::int, coalesce(s.pg, 0)::int, coalesce(s.pj - s.pg, 0)::int,
           coalesce(2 * s.pg - s.pj, 0)::int, coalesce(s.pg * p_g + (s.pj - s.pg) * p_p, 0)::int
    from unnest(arr) with ordinality as o(pid, ord)
    join public.perfiles p on p.id = o.pid
    left join lateral (
      select count(*) as pj, count(*) filter (where m.ganador = p.id) as pg
      from public.partidos m where p.id in (m.jugador, m.rival) and m.ganador is not null
    ) s on true
    order by o.ord;
end;
$$;

create or replace function public.partidos_recientes(p_limite int default 50)
returns table (reserva_id text, fecha date, hora int, cancha int,
               jugador_id uuid, jugador text, rival_id uuid, rival text, ganador_id uuid, sets jsonb)
language sql stable security definer set search_path = public
as $$
  select m.reserva_id, coalesce(r.fecha, m.fecha), coalesce(r.hora, m.hora), coalesce(r.cancha, m.cancha),
         m.jugador, pj.nombre, m.rival, pr.nombre, m.ganador, m.sets
  from public.partidos m
  left join public.reservas r on r.id = m.reserva_id
  join public.perfiles pj on pj.id = m.jugador
  join public.perfiles pr on pr.id = m.rival
  where auth.uid() is not null and m.ganador is not null
  order by 2 desc, 3 desc
  limit least(greatest(coalesce(p_limite, 50), 1), 500);
$$;

create or replace function public.partidos_sin_reserva()
returns table (id uuid, fecha date, hora int, cancha int, jugador_id uuid, jugador text,
               rival_id uuid, rival text, ganador_id uuid, sets jsonb)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede ver estos partidos.'; end if;
  return query
    select m.id, m.fecha, m.hora, m.cancha, m.jugador, pj.nombre, m.rival, pr.nombre, m.ganador, m.sets
    from public.partidos m
    join public.perfiles pj on pj.id = m.jugador
    join public.perfiles pr on pr.id = m.rival
    where m.reserva_id is null and m.fecha >= ((now() at time zone 'America/Santiago')::date - 60)
    order by m.fecha desc, m.hora desc;
end;
$$;

create or replace function public.crear_partido(p_jugador uuid, p_rival uuid, p_fecha date, p_hora int, p_cancha int)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede crear partidos.'; end if;
  if p_jugador is null or p_rival is null or p_jugador = p_rival then raise exception 'Elige dos jugadores distintos.'; end if;
  if p_fecha is null or p_hora is null or p_hora not between 0 and 23 then raise exception 'Indica el día y la hora del partido.'; end if;
  if p_cancha not in (1, 2) then raise exception 'Elige la cancha.'; end if;
  insert into public.partidos (jugador, rival, fecha, hora, cancha) values (p_jugador, p_rival, p_fecha, p_hora, p_cancha)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.resultado_partido(p_id uuid, p_sets jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare m public.partidos; s jsonb; a int; b int; ga int := 0; gb int := 0;
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede anotar este resultado.'; end if;
  select * into m from public.partidos where id = p_id and reserva_id is null;
  if not found then raise exception 'No encontramos ese partido.'; end if;
  if jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) not between 1 and 3 then raise exception 'Anota entre 1 y 3 sets.'; end if;
  for s in select * from jsonb_array_elements(p_sets) loop
    if jsonb_typeof(s) <> 'array' or jsonb_array_length(s) <> 2 then raise exception 'Cada set debe tener los juegos de ambos jugadores.'; end if;
    a := (s ->> 0)::int; b := (s ->> 1)::int;
    if a is null or b is null or a < 0 or b < 0 or a > 99 or b > 99 then raise exception 'Revisa los números del marcador.'; end if;
    if a = b then raise exception 'Un set no puede terminar empatado.'; end if;
    if a > b then ga := ga + 1; else gb := gb + 1; end if;
  end loop;
  if ga = gb then raise exception 'Quedan empatados en sets. Anota el set que definió el partido.'; end if;
  update public.partidos set sets = p_sets, ganador = case when ga > gb then m.jugador else m.rival end, creado = now() where id = p_id;
end;
$$;

create or replace function public.borrar_partido(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede borrar partidos.'; end if;
  delete from public.partidos where id = p_id and reserva_id is null;
end;
$$;

revoke execute on function public.partidos_sin_reserva() from public, anon;
revoke execute on function public.crear_partido(uuid, uuid, date, int, int) from public, anon;
revoke execute on function public.resultado_partido(uuid, jsonb) from public, anon;
revoke execute on function public.borrar_partido(uuid) from public, anon;
grant execute on function public.partidos_sin_reserva() to authenticated;
grant execute on function public.crear_partido(uuid, uuid, date, int, int) to authenticated;
grant execute on function public.resultado_partido(uuid, jsonb) to authenticated;
grant execute on function public.borrar_partido(uuid) to authenticated;
