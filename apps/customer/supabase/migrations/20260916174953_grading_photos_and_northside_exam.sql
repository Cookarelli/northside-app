begin;
-- New storage is separate from legacy attachments: drafts/paper exams must never
-- be downloadable through the older customer file endpoint.
create table ns.grading_exam_drafts (
  tenant_id uuid not null, card_id uuid not null, version integer not null default 0 check(version>=0),
  fields jsonb not null default '{}'::jsonb check(jsonb_typeof(fields)='object'),
  internal_notes text not null default '' check(length(internal_notes)<=10000),
  updated_by uuid not null, updated_at timestamptz not null default now(),
  primary key(tenant_id,card_id),
  foreign key(tenant_id,card_id) references ns.grading_cards(tenant_id,card_id),
  foreign key(tenant_id,updated_by) references ns.staff_memberships(tenant_id,id)
);
create table ns.grading_photos (
  tenant_id uuid not null, id uuid not null default gen_random_uuid(), card_id uuid not null,
  request_id uuid not null, kind text not null check(kind in ('front','back','closeup','paper')),
  object_key text unique not null, source_hash text not null check(length(source_hash)=64),
  stored_hash text check(length(stored_hash)=64), byte_size integer check(byte_size between 1 and 4194304),
  width integer, height integer, ready boolean not null default false, active boolean not null default false,
  created_by uuid not null, created_at timestamptz not null default now(), confirmed_at timestamptz, abandoned boolean not null default false,
  primary key(tenant_id,id), unique(tenant_id,card_id,id), unique(tenant_id,card_id,request_id),
  foreign key(tenant_id,card_id) references ns.grading_cards(tenant_id,card_id),
  foreign key(tenant_id,created_by) references ns.staff_memberships(tenant_id,id),
  check(object_key=tenant_id::text || '/grading/' || card_id::text || '/' || id::text || '.jpg'),
  check(not active or ready),
  check(not ready or (stored_hash is not null and byte_size is not null and width>0 and height>0 and confirmed_at is not null))
);
create unique index grading_photo_one_side on ns.grading_photos(tenant_id,card_id,kind) where active and kind in ('front','back','paper');
create index grading_photo_card on ns.grading_photos(tenant_id,card_id,created_at);
create table ns.grading_exam_revisions (
  tenant_id uuid not null, id uuid not null default gen_random_uuid(), card_id uuid not null, case_id uuid not null,
  revision integer not null check(revision>0), draft_version integer not null,
  centering integer not null check(centering between 1 and 10), surface integer not null check(surface between 1 and 10),
  edges integer not null check(edges between 1 and 10), corners integer not null check(corners between 1 and 10),
  notes text not null check(length(notes)<=10000), projected_grade text not null check(length(projected_grade)<=80),
  unable_to_estimate boolean not null, description text not null,
  signed_by uuid not null, signed_at timestamptz not null default now(),
  primary key(tenant_id,id), unique(tenant_id,card_id,id), unique(tenant_id,card_id,revision), unique(tenant_id,card_id,draft_version),
  foreign key(tenant_id,card_id) references ns.grading_cards(tenant_id,card_id),
  foreign key(tenant_id,case_id) references ns.grading_intakes(tenant_id,case_id),
  foreign key(tenant_id,signed_by) references ns.staff_memberships(tenant_id,id),
  check((unable_to_estimate and projected_grade='') or (not unable_to_estimate and length(trim(projected_grade))>0))
);
create table ns.grading_exam_revision_photos (
  tenant_id uuid not null, card_id uuid not null, revision_id uuid not null, photo_id uuid not null,
  primary key(tenant_id,revision_id,photo_id),
  foreign key(tenant_id,card_id,revision_id) references ns.grading_exam_revisions(tenant_id,card_id,id),
  foreign key(tenant_id,card_id,photo_id) references ns.grading_photos(tenant_id,card_id,id)
);
create index grading_exam_photo_revision on ns.grading_exam_revision_photos(tenant_id,photo_id);
create table ns.grading_exam_revision_private (
  tenant_id uuid not null, revision_id uuid not null, internal_notes text not null, reason text not null check(length(trim(reason)) between 1 and 1000),
  primary key(tenant_id,revision_id), foreign key(tenant_id,revision_id) references ns.grading_exam_revisions(tenant_id,id)
);
do $$ declare t text; begin
  foreach t in array array['grading_exam_drafts','grading_photos','grading_exam_revisions','grading_exam_revision_photos','grading_exam_revision_private'] loop
    execute format('alter table ns.%I enable row level security',t);
    execute format('grant select,insert on ns.%I to northside_runtime',t);
    execute format('create policy exam_write on ns.%I for insert to northside_runtime with check(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'']))',t);
  end loop;
  foreach t in array array['grading_exam_drafts','grading_exam_revision_private'] loop
    execute format('create policy exam_private_read on ns.%I for select to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'']))',t);
  end loop;
  foreach t in array array['grading_exam_revisions','grading_exam_revision_photos','grading_exam_revision_private'] loop
    execute format('create trigger exam_immutable before update or delete on ns.%I for each row execute function ns.prevent_rewrite()',t);
  end loop;
  foreach t in array array['grading_exam_drafts','grading_photos'] loop
    execute format('grant update on ns.%I to northside_runtime',t);
    execute format('create policy exam_update on ns.%I for update to northside_runtime using(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations''])) with check(ns.staff_can(tenant_id,array[''owner'',''admin'',''operations'']))',t);
  end loop;
end $$;
create policy exam_published_read on ns.grading_exam_revisions for select to northside_runtime using(ns.grading_access(tenant_id,case_id));
create policy exam_published_photos_read on ns.grading_exam_revision_photos for select to northside_runtime using(exists(select from ns.grading_exam_revisions r where r.tenant_id=grading_exam_revision_photos.tenant_id and r.id=grading_exam_revision_photos.revision_id));
create policy exam_photo_read on ns.grading_photos for select to northside_runtime using(
  ns.staff_can(tenant_id,array['owner','admin','operations','read_only']) or
  (ready and kind<>'paper' and exists(select from ns.grading_exam_revision_photos p where p.tenant_id=grading_photos.tenant_id and p.photo_id=grading_photos.id))
);
create function ns.freeze_exam_photo() returns trigger language plpgsql as $$ begin
  if (new.tenant_id,new.id,new.card_id,new.request_id,new.kind,new.object_key,new.source_hash,new.created_by,new.created_at) is distinct from
     (old.tenant_id,old.id,old.card_id,old.request_id,old.kind,old.object_key,old.source_hash,old.created_by,old.created_at) then raise exception 'Photo identity is immutable'; end if;
  if old.ready and (new.ready,new.stored_hash,new.byte_size,new.width,new.height,new.confirmed_at) is distinct from
                  (old.ready,old.stored_hash,old.byte_size,old.width,old.height,old.confirmed_at) then raise exception 'Confirmed photo content is immutable'; end if;
  return new;
end $$;
create trigger exam_photo_immutable before update on ns.grading_photos for each row execute function ns.freeze_exam_photo();
create function ns.guard_exam_publication() returns trigger language plpgsql as $$ declare c ns.grading_cards; begin
  select * into c from ns.grading_cards where tenant_id=new.tenant_id and card_id=new.card_id for update;
  if c.case_id is distinct from new.case_id or new.signed_by is distinct from (select staff_id from ns.context()) then raise exception 'Invalid examiner or card'; end if;
  if exists(select from ns.grading_intakes where tenant_id=c.tenant_id and case_id=c.case_id and voided_at is not null) then raise exception 'Intake reversed'; end if;
  if not exists(select from ns.grading_photos where tenant_id=c.tenant_id and card_id=c.card_id and ready and active and kind='front') or
     not exists(select from ns.grading_photos where tenant_id=c.tenant_id and card_id=c.card_id and ready and active and kind='back') then raise exception 'Confirmed front and back required'; end if;
  new.signed_at := clock_timestamp();
  return new;
end $$;
create trigger exam_publication_guard before insert on ns.grading_exam_revisions for each row execute function ns.guard_exam_publication();
-- Atomically snapshot all confirmed images. Paper exams are retained for staff,
-- but the photo RLS and public projection exclude them from customer reports.
create function ns.snapshot_exam_photos() returns trigger language plpgsql as $$ begin
  insert into ns.grading_exam_revision_photos(tenant_id,card_id,revision_id,photo_id)
  select tenant_id,card_id,new.id,id from ns.grading_photos where tenant_id=new.tenant_id and card_id=new.card_id and ready and active;
  return new;
end $$;
create trigger exam_snapshot after insert on ns.grading_exam_revisions for each row execute function ns.snapshot_exam_photos();
create function ns.guard_exam_photo_snapshot() returns trigger language plpgsql as $$ begin
  if pg_trigger_depth()<>2 then raise exception 'Revision photos can only be snapshotted during publication'; end if;
  return new;
end $$;
create trigger exam_snapshot_only before insert on ns.grading_exam_revision_photos for each row execute function ns.guard_exam_photo_snapshot();
commit;
