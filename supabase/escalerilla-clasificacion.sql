-- =====================================================================
-- Escalerilla con fase de clasificación (reglamento 2026):
--   1. Los primeros 2 partidos de cada socio no dan puesto: queda
--      "en clasificación", ordenado por puntos (1 por partido ganado).
--   2. Al completar su 2.º partido entra a la escalerilla en el lugar que
--      le dan sus puntos frente a los que ya tienen puesto (con empate,
--      queda debajo de quienes ya estaban).
--   3. Desde el 3.er partido, si le gana a alguien de más arriba (entre
--      quienes ya tienen puesto), toma su lugar y los demás bajan uno.
-- Pegar completo en Supabase → SQL Editor → Run.
-- =====================================================================
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
begin
  if auth.uid() is null then
    return;
  end if;
  select coalesce((c.datos ->> 'puntosGanar')::int, 1), coalesce((c.datos ->> 'puntosPerder')::int, 0)
    into p_g, p_p from public.config c where c.id = 1;

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
    with st as (
      select p.id, p.nombre, p.creado,
             coalesce((gms ->> p.id::text)::int, 0) as j,
             coalesce((wns ->> p.id::text)::int, 0) as g,
             array_position(arr, p.id) as ap
      from public.perfiles p
    ),
    ord as (
      select st.*,
             row_number() over (order by (st.ap is null), st.ap,
                                st.g desc, (st.j > 0) desc, (2 * st.g - st.j) desc, st.creado) as rn
      from st
    )
    select ord.rn::int, ord.id, ord.nombre, ord.j, ord.g, ord.j - ord.g, 2 * ord.g - ord.j,
           ord.g * p_g + (ord.j - ord.g) * p_p, ord.ap is not null
    from ord
    order by ord.rn;
end;
$$;

revoke execute on function public.ranking_v2() from public, anon;
grant execute on function public.ranking_v2() to authenticated;
