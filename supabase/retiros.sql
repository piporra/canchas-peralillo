-- =====================================================================
-- Retiros: si un jugador se retira, gana el otro (1 punto).
-- Para el desempate se cuenta lo jugado + el resto para el ganador:
-- los sets terminados valen como se jugaron, el set cortado se lo lleva
-- el ganador y, si faltaban sets, también (6-0) hasta completar 2 sets.
-- =====================================================================
alter table public.partidos add column if not exists retiro uuid references public.perfiles (id) on delete set null;

-- Sets "efectivos" desde el lado de quien reservó (jugador).
create or replace function public.sets_efectivos(p_sets jsonb, p_gana_jugador boolean, p_retiro boolean)
returns jsonb language plpgsql immutable as $$
declare
  s jsonb; a int; b int; w int; l int; nw int := 0; v_res jsonb := '[]'::jsonb;
begin
  if not coalesce(p_retiro, false) then
    return coalesce(p_sets, '[]'::jsonb);
  end if;
  for s in select * from jsonb_array_elements(coalesce(p_sets, '[]'::jsonb)) loop
    a := (s ->> 0)::int; b := (s ->> 1)::int;
    if (greatest(a, b) >= 6 and abs(a - b) >= 2) or (greatest(a, b) = 7 and least(a, b) in (5, 6)) then
      v_res := v_res || jsonb_build_array(s);                     -- set terminado: cuenta como se jugó
      if (a > b) = p_gana_jugador then nw := nw + 1; end if;
    else                                                      -- set cortado: para el ganador
      l := case when p_gana_jugador then b else a end;
      w := case when l >= 5 then 7 else 6 end;
      l := least(l, 6);
      v_res := v_res || jsonb_build_array(case when p_gana_jugador then jsonb_build_array(w, l) else jsonb_build_array(l, w) end);
      nw := nw + 1;
    end if;
  end loop;
  while nw < 2 loop                                           -- sets que faltaban: 6-0 para el ganador
    v_res := v_res || jsonb_build_array(case when p_gana_jugador then '[6,0]'::jsonb else '[0,6]'::jsonb end);
    nw := nw + 1;
  end loop;
  return v_res;
end $$;

-- Valida el marcador; con retiro acepta sets incompletos (o ninguno).
create or replace function public.validar_sets(p_sets jsonb, p_retiro boolean)
returns int language plpgsql immutable as $$
declare s jsonb; a int; b int; ga int := 0; gb int := 0; n int; i int := 0;
begin
  n := case when jsonb_typeof(p_sets) = 'array' then jsonb_array_length(p_sets) else -1 end;
  if (n < 1 and not p_retiro) or n < 0 or n > 3 then
    raise exception 'Anota entre 1 y 3 sets.';
  end if;
  for s in select * from jsonb_array_elements(p_sets) loop
    i := i + 1;
    if jsonb_typeof(s) <> 'array' or jsonb_array_length(s) <> 2 then
      raise exception 'Cada set debe tener los juegos de ambos jugadores.';
    end if;
    a := (s ->> 0)::int; b := (s ->> 1)::int;
    if a is null or b is null or a < 0 or b < 0 or a > 99 or b > 99 then
      raise exception 'Revisa los números del marcador.';
    end if;
    if a = b and not (p_retiro and i = n) then
      raise exception 'Un set no puede terminar empatado.';
    end if;
    if a > b then ga := ga + 1; elsif b > a then gb := gb + 1; end if;
  end loop;
  if p_retiro then return 0; end if;
  if ga = gb then
    raise exception 'Quedan empatados en sets. Anota el set que definió el partido.';
  end if;
  return case when ga > gb then 1 else -1 end;
end $$;

drop function if exists public.registrar_resultado(text, uuid, jsonb);
create or replace function public.registrar_resultado(p_reserva text, p_rival uuid, p_sets jsonb, p_retiro uuid default null)
returns public.partidos language plpgsql security definer set search_path = public as $$
declare
  hoy     date := (now() at time zone 'America/Santiago')::date;
  hora_ya int  := extract(hour from (now() at time zone 'America/Santiago'))::int;
  res     public.reservas;
  es_riv  boolean;
  r       int;
  v_gan   uuid;
  v_out   public.partidos;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;
  select * into res from public.reservas where id = p_reserva;
  if not found then
    raise exception 'No encontramos esa reserva.';
  end if;
  es_riv := res.rival_id = auth.uid();
  if res.user_id <> auth.uid() and not coalesce(es_riv, false) and not public.es_admin() then
    raise exception 'Solo los jugadores del partido o el administrador pueden anotar el resultado.';
  end if;
  if coalesce(es_riv, false) and not public.es_admin() and p_rival <> auth.uid() then
    raise exception 'Solo puedes anotar el resultado de tu propio partido.';
  end if;
  if res.estado <> 'confirmada' then
    raise exception 'Esa reserva fue anulada.';
  end if;
  if res.escalerilla = false then
    raise exception 'Es un partido amistoso: no cuenta para la escalerilla.';
  end if;
  if res.fecha > hoy or (res.fecha = hoy and res.hora > hora_ya) then
    raise exception 'Podrás anotar el resultado cuando empiece el partido.';
  end if;
  if p_rival is null or p_rival = res.user_id or not exists (select 1 from public.perfiles where id = p_rival) then
    raise exception 'Elige al socio contra quien se jugó.';
  end if;
  if p_retiro is not null and p_retiro not in (res.user_id, p_rival) then
    raise exception 'Quien se retira debe ser uno de los dos jugadores.';
  end if;
  r := public.validar_sets(p_sets, p_retiro is not null);
  v_gan := case when p_retiro is not null then (case when p_retiro = res.user_id then p_rival else res.user_id end)
                when r > 0 then res.user_id else p_rival end;
  update public.reservas set escalerilla = true, rival_id = p_rival, rival_nombre = null where id = p_reserva;
  insert into public.partidos (reserva_id, jugador, rival, sets, ganador, retiro)
  values (p_reserva, res.user_id, p_rival, p_sets, v_gan, p_retiro)
  on conflict (reserva_id) do update
     set rival = excluded.rival, sets = excluded.sets, ganador = excluded.ganador, retiro = excluded.retiro, creado = now()
  returning * into v_out;
  return v_out;
end $$;

drop function if exists public.resultado_partido(uuid, jsonb);
create or replace function public.resultado_partido(p_id uuid, p_sets jsonb, p_retiro uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare m public.partidos; r int;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede anotar este resultado.';
  end if;
  select * into m from public.partidos where id = p_id and reserva_id is null;
  if not found then
    raise exception 'No encontramos ese partido.';
  end if;
  if p_retiro is not null and p_retiro not in (m.jugador, m.rival) then
    raise exception 'Quien se retira debe ser uno de los dos jugadores.';
  end if;
  r := public.validar_sets(p_sets, p_retiro is not null);
  update public.partidos
     set sets = p_sets, retiro = p_retiro, creado = now(),
         ganador = case when p_retiro is not null then (case when p_retiro = m.jugador then m.rival else m.jugador end)
                        when r > 0 then m.jugador else m.rival end
   where id = p_id;
end $$;

revoke execute on function public.registrar_resultado(text, uuid, jsonb, uuid) from public, anon;
grant execute on function public.registrar_resultado(text, uuid, jsonb, uuid) to authenticated;
revoke execute on function public.resultado_partido(uuid, jsonb, uuid) from public, anon;
grant execute on function public.resultado_partido(uuid, jsonb, uuid) to authenticated;

drop function if exists public.partidos_recientes(int);
create function public.partidos_recientes(p_limite int default 50)
returns table (reserva_id text, fecha date, hora int, cancha int, jugador_id uuid, jugador text, rival_id uuid, rival text, ganador_id uuid, sets jsonb, retiro uuid)
language sql stable security definer set search_path = public as $$
  select m.reserva_id, coalesce(r.fecha, m.fecha), coalesce(r.hora, m.hora), coalesce(r.cancha, m.cancha),
         m.jugador, pj.nombre, m.rival, pr.nombre, m.ganador, m.sets, m.retiro
  from public.partidos m
  left join public.reservas r on r.id = m.reserva_id
  join public.perfiles pj on pj.id = m.jugador
  join public.perfiles pr on pr.id = m.rival
  where auth.uid() is not null and m.ganador is not null
  order by 2 desc, 3 desc
  limit least(greatest(coalesce(p_limite, 50), 1), 500);
$$;
revoke execute on function public.partidos_recientes(int) from public, anon;
grant execute on function public.partidos_recientes(int) to authenticated;

drop function if exists public.partidos_sin_reserva();
create function public.partidos_sin_reserva()
returns table (id uuid, fecha date, hora int, cancha int, jugador_id uuid, jugador text, rival_id uuid, rival text, ganador_id uuid, sets jsonb, retiro uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede ver estos partidos.';
  end if;
  return query
    select m.id, m.fecha, m.hora, m.cancha, m.jugador, pj.nombre, m.rival, pr.nombre, m.ganador, m.sets, m.retiro
    from public.partidos m
    join public.perfiles pj on pj.id = m.jugador
    join public.perfiles pr on pr.id = m.rival
    where m.reserva_id is null
      and m.fecha >= ((now() at time zone 'America/Santiago')::date - 60)
    order by m.fecha desc, m.hora desc;
end $$;
revoke execute on function public.partidos_sin_reserva() from public, anon;
grant execute on function public.partidos_sin_reserva() to authenticated;

-- Ranking: desempate con los sets efectivos (incluye retiros).
create or replace function public.ranking_v2()
returns table (puesto int, id uuid, nombre text, pj int, pg int, pp int, dif int, pts int, clasificado boolean)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  arr   uuid[] := '{}';   -- socios con puesto, en orden
  gms   jsonb  := '{}';   -- partidos jugados por socio
  wns   jsonb  := '{}';   -- partidos ganados por socio
  ev    record;
  pl    uuid;
  w     uuid;
  l     uuid;
  wi    int;
  li    int;
  n     int;
  pos   int;
  a_pre int;
  b_pre int;
  p_g   int;
  p_p   int;
  por_pts boolean;
begin
  if auth.uid() is null then
    return;
  end if;
  select coalesce((c.datos ->> 'puntosGanar')::int, 1), coalesce((c.datos ->> 'puntosPerder')::int, 0)
         , coalesce((c.datos ->> 'escalerillaPorPuntos')::boolean, false)
    into p_g, p_p, por_pts from public.config c where c.id = 1;

  for ev in
    select m.jugador as a, m.rival as b, m.ganador as g,
           ((coalesce(r.fecha, m.fecha) + make_interval(hours => coalesce(r.hora, m.hora))) at time zone 'America/Santiago') as t,
           m.creado
    from public.partidos m left join public.reservas r on r.id = m.reserva_id
    where m.ganador is not null
    order by 4, 5
  loop
    a_pre := coalesce((gms ->> ev.a::text)::int, 0);
    b_pre := coalesce((gms ->> ev.b::text)::int, 0);
    -- sumar el partido y el triunfo
    gms := jsonb_set(gms, array[ev.a::text], to_jsonb(a_pre + 1));
    gms := jsonb_set(gms, array[ev.b::text], to_jsonb(b_pre + 1));
    wns := jsonb_set(wns, array[ev.g::text], to_jsonb(coalesce((wns ->> ev.g::text)::int, 0) + 1));

    -- regla de la escalerilla: solo si ambos ya tenían puesto antes de este partido
    if array_position(arr, ev.a) is not null and array_position(arr, ev.b) is not null then
      w := ev.g;
      l := case when ev.g = ev.a then ev.b else ev.a end;
      wi := array_position(arr, w);
      li := array_position(arr, l);
      if wi > li then
        n := coalesce(array_length(arr, 1), 0);
        arr := arr[1:li - 1] || w || array_remove(arr[li:n], w);
      end if;
    end if;

    -- quien completa su 2.º partido entra a la escalerilla según sus puntos
    foreach pl in array array[ev.a, ev.b] loop
      if array_position(arr, pl) is null and (gms ->> pl::text)::int >= 2 then
        select count(*) + 1 into pos
        from unnest(arr) as x(pid)
        where coalesce((wns ->> x.pid::text)::int, 0) >= coalesce((wns ->> pl::text)::int, 0);
        n := coalesce(array_length(arr, 1), 0);
        arr := arr[1:pos - 1] || pl || arr[pos:n];
      end if;
    end loop;
  end loop;

  return query
    with sx0 as (
      select m.jugador as pid, s.v as v from public.partidos m,
             jsonb_array_elements(public.sets_efectivos(m.sets, m.ganador = m.jugador, m.retiro is not null)) s(v) where m.ganador is not null
      union all
      select m.rival, jsonb_build_array(s.v -> 1, s.v -> 0) from public.partidos m,
             jsonb_array_elements(public.sets_efectivos(m.sets, m.ganador = m.jugador, m.retiro is not null)) s(v) where m.ganador is not null
    ),
    sx as (
      select sx0.pid,
             sum(case when (sx0.v ->> 0)::int > (sx0.v ->> 1)::int then 1 else -1 end)::int as sd,
             sum((sx0.v ->> 0)::int - (sx0.v ->> 1)::int)::int as gd
      from sx0 group by sx0.pid
    ),
    st as (
      select p.id, p.nombre, p.creado,
             coalesce((gms ->> p.id::text)::int, 0) as j,
             coalesce((wns ->> p.id::text)::int, 0) as g,
             coalesce(sx.sd, 0) as sd,
             coalesce(sx.gd, 0) as gd,
             array_position(arr, p.id) as ap
      from public.perfiles p left join sx on sx.pid = p.id
    ),
    ord as (
      select st.*,
             row_number() over (order by (st.ap is null),
                                case when por_pts and st.ap is not null then st.g * p_g + (st.j - st.g) * p_p end desc nulls last,
                                case when por_pts and st.ap is not null then st.sd end desc nulls last,
                                case when por_pts and st.ap is not null then st.gd end desc nulls last,
                                case when por_pts and st.ap is not null then st.j - st.g end asc nulls last,
                                st.ap,
                                st.g desc, (st.j > 0) desc, st.sd desc, st.gd desc, (2 * st.g - st.j) desc, st.creado) as rn
      from st
    )
    select ord.rn::int, ord.id, ord.nombre, ord.j, ord.g, ord.j - ord.g, ord.sd,
           ord.g * p_g + (ord.j - ord.g) * p_p, ord.ap is not null
    from ord
    order by ord.rn;
end;
$$;

revoke execute on function public.ranking_v2() from public, anon;
grant execute on function public.ranking_v2() to authenticated;

