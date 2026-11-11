-- =====================================================================
-- Cuotas mensuales de socios ($5.000). El administrador marca quién pagó
-- cada mes; la escalerilla muestra "Cuota al día" o "Cuota pendiente".
-- =====================================================================
create table if not exists public.cuotas (
  perfil_id  uuid not null references public.perfiles (id) on delete cascade,
  mes        date not null check (extract(day from mes) = 1),
  creado     timestamptz not null default now(),
  primary key (perfil_id, mes)
);
alter table public.cuotas enable row level security;

create or replace function public.cuotas_mes(p_mes date)
returns table (id uuid, nombre text, telefono text, pagado boolean, pagado_el timestamptz)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede ver las cuotas.';
  end if;
  return query
    select p.id, p.nombre, p.telefono, c.perfil_id is not null, c.creado
    from public.perfiles p
    left join public.cuotas c on c.perfil_id = p.id and c.mes = date_trunc('month', p_mes)::date
    order by p.nombre;
end;
$$;

create or replace function public.marcar_cuota(p_perfil uuid, p_mes date, p_pagado boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede registrar cuotas.';
  end if;
  if p_pagado then
    insert into public.cuotas (perfil_id, mes) values (p_perfil, date_trunc('month', p_mes)::date)
    on conflict do nothing;
  else
    delete from public.cuotas where perfil_id = p_perfil and mes = date_trunc('month', p_mes)::date;
  end if;
end;
$$;

create or replace function public.al_dia()
returns table (id uuid)
language sql stable security definer set search_path = public
as $$
  select c.perfil_id from public.cuotas c
  where auth.uid() is not null
    and c.mes = date_trunc('month', (now() at time zone 'America/Santiago'))::date;
$$;

revoke execute on function public.cuotas_mes(date) from public, anon;
revoke execute on function public.marcar_cuota(uuid, date, boolean) from public, anon;
revoke execute on function public.al_dia() from public, anon;
grant execute on function public.cuotas_mes(date) to authenticated;
grant execute on function public.marcar_cuota(uuid, date, boolean) to authenticated;
grant execute on function public.al_dia() to authenticated;
