-- =====================================================================
-- Solo administradores: reservar a nombre de otro socio (mismas reglas
-- del club: apertura, solo fines de semana/feriados, 1 cancha diaria).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.reservar_para(p_socio uuid, p_cancha integer, p_fecha date, p_hora integer, p_escalerilla boolean, p_rival uuid, p_rival_nombre text)
 RETURNS reservas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cfg      jsonb;
  hoy      date := (now() at time zone 'America/Santiago')::date;
  hora_ya  int  := extract(hour from (now() at time zone 'America/Santiago'))::int;
  dow      int  := extract(isodow from p_fecha)::int;
  esp      boolean;
  feriado  boolean;
  v_ap     date;
  v_fin    int;
  v_lim    int;
  n        int;
  nom      text := nullif(btrim(p_rival_nombre), '');
  r        public.reservas;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede reservar a nombre de otro socio.';
  end if;
  if p_socio is null or not exists (select 1 from public.perfiles where id = p_socio) then
    raise exception 'Elige al socio que reserva.';
  end if;
  if p_escalerilla is null then
    raise exception 'Indica si es partido de la escalerilla.';
  end if;
  if p_rival is not null and (p_rival = p_socio or not exists (select 1 from public.perfiles where id = p_rival)) then
    raise exception 'Elige a otro socio como rival.';
  end if;
  if p_escalerilla and p_rival is null and nom is null then
    raise exception 'Para un partido de escalerilla indica con quién juega.';
  end if;
  select datos into cfg from public.config where id = 1;
  if p_cancha not in (1, 2) then
    raise exception 'Esa cancha no existe.';
  end if;
  if p_fecha < hoy then
    raise exception 'Esa fecha ya pasó.';
  end if;
  if p_fecha = hoy and p_hora <= hora_ya then
    raise exception 'Ese horario ya pasó.';
  end if;
  esp := public.dia_especial(p_fecha, cfg);
  feriado := exists (select 1 from jsonb_array_elements(coalesce(cfg -> 'feriados', '[]'::jsonb)) f where f ->> 'fecha' = p_fecha::text);
  if coalesce((cfg ->> 'soloFinde')::boolean, false) and not esp then
    raise exception 'Por la app solo se reservan sábados, domingos y feriados.';
  end if;
  v_ap := least(
    case when dow in (6, 7) then p_fecha - (dow - coalesce((cfg ->> 'abreFindeDia')::int, 4)) end,
    case when feriado then p_fecha - coalesce((cfg ->> 'abreFeriadoDias')::int, 2) end
  );
  if v_ap is null then
    v_ap := p_fecha - (coalesce((cfg ->> 'diasAnticipacion')::int, 7) - 1);
  end if;
  if hoy < v_ap then
    raise exception 'Las reservas para el % se abren el %.', to_char(p_fecha, 'DD/MM'), to_char(v_ap, 'DD/MM');
  end if;
  select (b ->> 'fin')::int into v_fin
  from jsonb_array_elements(cfg -> (case when esp then 'jornadaFinde' else 'jornadaSemana' end)) b
  where (b ->> 'ini')::int = p_hora
  limit 1;
  if v_fin is null then
    raise exception 'Ese horario no está disponible ese día.';
  end if;
  v_lim := coalesce((cfg ->> 'limiteDiario')::int, 1);
  if v_lim > 0 then
    select count(*) into n from public.reservas
    where user_id = p_socio and estado = 'confirmada' and fecha = p_fecha;
    if n >= v_lim then
      raise exception 'Ese socio ya tiene una cancha reservada ese día.';
    end if;
  end if;
  begin
    insert into public.reservas (user_id, cancha, fecha, hora, fin, socio, precio, escalerilla, rival_id, rival_nombre)
    values (p_socio, p_cancha, p_fecha, p_hora, v_fin, true, 0, p_escalerilla, p_rival, case when p_rival is null then nom end)
    returning * into r;
  exception when unique_violation then
    raise exception 'Ese horario se acaba de ocupar. Elige otro.';
  end;
  return r;
end;
$function$;

revoke execute on function public.reservar_para(uuid, int, date, int, boolean, uuid, text) from public, anon;
grant execute on function public.reservar_para(uuid, int, date, int, boolean, uuid, text) to authenticated;
