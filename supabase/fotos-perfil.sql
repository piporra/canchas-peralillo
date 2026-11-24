-- Fotos de perfil: bucket público "avatares" (archivo <id del socio>.jpg).
-- Cada socio sube la suya; los administradores pueden subir la de cualquiera.
alter table public.perfiles add column if not exists foto text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 400000, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 400000, allowed_mime_types = array['image/jpeg'];

drop policy if exists "avatares leer" on storage.objects;
drop policy if exists "avatares subir" on storage.objects;
drop policy if exists "avatares cambiar" on storage.objects;
drop policy if exists "avatares borrar" on storage.objects;
create policy "avatares leer" on storage.objects for select to authenticated
  using (bucket_id = 'avatares');
create policy "avatares subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and (name = auth.uid()::text || '.jpg' or public.es_admin()));
create policy "avatares cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'avatares' and (name = auth.uid()::text || '.jpg' or public.es_admin()))
  with check (bucket_id = 'avatares' and (name = auth.uid()::text || '.jpg' or public.es_admin()));
create policy "avatares borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and (name = auth.uid()::text || '.jpg' or public.es_admin()));

create or replace function public.poner_foto(p_socio uuid, p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or (p_socio <> auth.uid() and not public.es_admin()) then
    raise exception 'Solo puedes cambiar tu propia foto.';
  end if;
  if p_url is not null and p_url not like '%/storage/v1/object/public/avatares/' || p_socio::text || '.jpg%' then
    raise exception 'Foto no válida.';
  end if;
  update public.perfiles set foto = p_url where id = p_socio;
end $$;
revoke execute on function public.poner_foto(uuid, text) from public, anon;
grant execute on function public.poner_foto(uuid, text) to authenticated;

drop function if exists public.socios();
create function public.socios()
returns table (id uuid, nombre text, foto text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.nombre, p.foto from public.perfiles p
  where auth.uid() is not null
  order by p.nombre;
$$;
revoke execute on function public.socios() from public, anon;
grant execute on function public.socios() to authenticated;
