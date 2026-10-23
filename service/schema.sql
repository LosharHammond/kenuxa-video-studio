create table public.watch_listings(id uuid primary key default gen_random_uuid(),owner text not null,title text not null check(length(title) between 1 and 120),source text not null check(length(source)<=1024),created_at timestamptz not null default now(),unique(owner,source));
create index watch_listings_date on public.watch_listings(created_at desc);
create table public.watch_requests(nonce uuid primary key,created_at timestamptz not null default now());
create index watch_requests_date on public.watch_requests(created_at);
create table public.watch_reports(video_id uuid references public.watch_listings(id) on delete cascade,owner text not null,reason text not null check(length(reason) between 1 and 280),created_at timestamptz not null default now(),primary key(video_id,owner));
alter table public.watch_listings enable row level security;
alter table public.watch_requests enable row level security;
alter table public.watch_reports enable row level security;
revoke all on public.watch_listings,public.watch_requests,public.watch_reports from anon,authenticated;
grant all on public.watch_listings,public.watch_requests,public.watch_reports to service_role;
create function public.watch_action(p_owner text,p_nonce uuid,p_action text,p_title text default '',p_source text default '',p_id uuid default null,p_reason text default '') returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 delete from public.watch_requests where created_at < now()-interval '10 minutes';
 insert into public.watch_requests(nonce) values(p_nonce);
 if p_action='mine' then
   select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from (select id,title,source,created_at from public.watch_listings where owner=p_owner order by created_at desc limit 50)t;
   return jsonb_build_object('items',result);
 elsif p_action='publish' then
   perform pg_advisory_xact_lock(7824811);
   if exists(select 1 from public.watch_listings where owner=p_owner and source=p_source) then return jsonb_build_object('ok',true,'existing',true); end if;
   if (select count(*) from public.watch_listings)>=1000 or (select count(*) from public.watch_listings where owner=p_owner)>=50 then raise exception 'Listing limit reached. Remove an older listing first.'; end if;
   insert into public.watch_listings(owner,title,source) values(p_owner,p_title,p_source);
   return jsonb_build_object('ok',true);
 elsif p_action='remove' then
   delete from public.watch_listings where id=p_id and owner=p_owner;
   if not found then raise exception 'You can remove only listings shared by this browser installation.'; end if;
   return jsonb_build_object('ok',true);
 elsif p_action='report' then
   if (select count(*) from public.watch_reports where owner=p_owner and created_at>now()-interval '1 day')>=20 then raise exception 'Report limit reached for today.';end if;
   insert into public.watch_reports(video_id,owner,reason) values(p_id,p_owner,p_reason) on conflict(video_id,owner) do update set reason=excluded.reason;
   return jsonb_build_object('ok',true);
 end if;
 raise exception 'Unknown action';
end $$;
revoke all on function public.watch_action(text,uuid,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.watch_action(text,uuid,text,text,text,uuid,text) to service_role;
