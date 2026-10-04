create table if not exists scrape_cache (
  key text primary key,
  body text not null,
  updated_at timestamptz not null default now()
);
