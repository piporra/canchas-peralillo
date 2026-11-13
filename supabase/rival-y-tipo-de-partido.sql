-- =====================================================================
-- Rival y tipo de partido en cada reserva (escalerilla o amistoso).
-- =====================================================================
alter table public.reservas add column if not exists escalerilla boolean;          -- null = sin definir (reservas antiguas)
alter table public.reservas add column if not exists rival_id uuid references public.perfiles (id) on delete set null;
alter table public.reservas add column if not exists rival_nombre text check (rival_nombre is null or char_length(rival_nombre) between 2 and 80);

create or replace function public.reservar(p_cancha int, p_fecha date, p_hora int,
                                           p_escalerilla boolean, p_rival uuid, p_rival_nombre text)
returns public.reservas
language plpgsql security definer set search_path = public
as $$
declare r public.reservas; nom text := nullif(btrim(p_rival_nombre), '');
begin
  if p_escalerilla is null then raise exception 'Indica si es partido de la escalerilla.'; end if;
  if p_rival is not null and (p_rival = auth.uid() or not exists (select 1 from public.perfiles where id = p_rival)) then
    raise exception 'Elige a otro socio como rival.';
  end if;
  if p_escalerilla and p_rival is null and nom is null then
    raise exception 'Para un partido de escalerilla indica con quién juegas.';
  end if;
  r := public.reservar(p_cancha, p_fecha, p_hora);
  update public.reservas
     set escalerilla = p_escalerilla, rival_id = p_rival, rival_nombre = case when p_rival is null then nom end
   where id = r.id
  returning * into r;
  return r;
end;
$$;

create or replace function public.editar_partido_reserva(p_reserva text, p_escalerilla boolean, p_rival uuid, p_rival_nombre text)
returns void
language plpgsql security definer set search_path = public
as $$
declare res public.reservas; nom text := nullif(btrim(p_rival_nombre), '');
begin
  select * into res from public.reservas where id = p_reserva;
  if not found or (res.user_id <> auth.uid() and not public.es_admin()) then
    raise exception 'Solo quien reservó o el administrador puede cambiar este partido.';
  end if;
  if p_escalerilla is null then raise exception 'Indica si es partido de la escalerilla.'; end if;
  if p_rival is not null and (p_rival = res.user_id or not exists (select 1 from public.perfiles where id = p_rival)) then
    raise exception 'Elige a otro socio como rival.';
  end if;
  if p_escalerilla and p_rival is null and nom is null then
    raise exception 'Para un partido de escalerilla elige al socio con quien juegas.';
  end if;
  update public.reservas
     set escalerilla = p_escalerilla, rival_id = p_rival, rival_nombre = case when p_rival is null then nom end
   where id = p_reserva;
end;
$$;

create or replace function public.agenda_v2(desde date, hasta date)
returns table (cancha int, fecha date, hora int, nombre text, es_mio boolean, rival text, escalerilla boolean)
language sql stable security definer set search_path = public
as $$
  select r.cancha, r.fecha, r.hora, p.nombre, r.user_id = auth.uid(), coalesce(pr.nombre, r.rival_nombre), r.escalerilla
  from public.reservas r
  join public.perfiles p on p.id = r.user_id
  left join public.perfiles pr on pr.id = r.rival_id
  where auth.uid() is not null and r.estado = 'confirmada' and r.fecha between desde and hasta;
$$;

revoke execute on function public.reservar(int, date, int, boolean, uuid, text) from public, anon;
revoke execute on function public.editar_partido_reserva(text, boolean, uuid, text) from public, anon;
revoke execute on function public.agenda_v2(date, date) from public, anon;
grant execute on function public.reservar(int, date, int, boolean, uuid, text) to authenticated;
grant execute on function public.editar_partido_reserva(text, boolean, uuid, text) to authenticated;
grant execute on function public.agenda_v2(date, date) to authenticated;
-- registrar_resultado(): además rechaza los amistosos (escalerilla = false). Ver migración club_tenis_14.
