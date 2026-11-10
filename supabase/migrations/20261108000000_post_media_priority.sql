-- Optional presentation fields for posts: a banner / flyer image, a pinned flag,
-- and a priority used for the "Important" / "Urgent" badges. All are optional;
-- the reader ignores them when they are empty or the columns do not exist yet.

alter table public.updates
  add column if not exists image_url text,
  add column if not exists pinned boolean not null default false,
  add column if not exists priority text not null default 'normal'
    check (priority in ('normal', 'important', 'urgent'));
