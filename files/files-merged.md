# --- Insert your v1 content here ---

# GRIDOCS — Roles, RLS & RPCs (Production Reference)

## 1) Role model & “common sense” logic

We’ll use your `roles.level` to gate capabilities. To make it explicit and easy to tune,
we define three global thresholds (you can change numbers without touching policy text):

- **Admin**: `level >= 40`
- **Developer**: `level >= 60`
- **Super**: `level >= 90` (absolute access; global override)

> If your existing `roles` already have levels (e.g., _Locked 0, Limited 5, Demo 10,
> User 20, Administrator 50_), just adjust the thresholds below or align your levels to
> these thresholds.

### Policy intent (summary)

- **Companies**
  - Read: company members (current) and global Super.
  - Create/Update/Delete (modify “company info”): **Admin+** (Admin, Developer, Super).

- **Users/Profiles**
  - Read: self OR users who share a company OR global Super.
  - Update: **self** (including signature) OR Admin+ of a company the user belongs to OR
    global Super.
  - Delete: global Super only (recommended).

- **Users ↔ Companies membership**
  - Read: subject user OR company members OR global Super.
  - Write: company **Admin+** or global Super.

- **Documents**
  - Read: company members OR global Super.
  - Create/Update/Delete “originals” (`documents` rows): **Admin+** of that company OR
    global Super.
  - Versions (`document_versions`): **any company member can `INSERT` a version** (if
    `uploaded_by = auth.uid()`); Admin+ and Super can also insert; Admin+ and Super can
    update/delete.

- **Product codes** (scoped to company)
  - Read: company members OR global Super.
  - Write: **Admin+** or global Super.

- **Licenses** (scoped through the product code’s company)
  - Read: the subject user, members of the owning company, or global Super.
  - Write: **Developer+ only** (Developer or Super). **Admin and below cannot
    create/modify licenses** (they can request through your UX/workflow).

- **Metadata** (`permissions`, `resources_permissions`, `roles`, `roles_permissions`,
  `statuses`, `address_types`, `role_in_company`)
  - Read: all authenticated.
  - Write: global Super only (or Developer+ if you prefer—shown as Super-only below).

- **Addresses**
  - Read: owner via `users_addresses`, members via `companies_addresses`, or global
    Super.
  - User address writes: the user (self) or Admin+ of a company the user belongs to or
    global Super.
  - Company address writes: Admin+ of that company or global Super.

---

## 2) “Current license” definition & scope

- **Current license =** `expires_at >= now()` (strict)
  - **`NULL` is _not_ current**.
  - If you want “no expiration” licenses, store `expires_at = 'infinity'::timestamptz`,
    which **is** current because `infinity >= now()` is true. (Explanation in §4)

- **Scope by product**: the function **requires `p_product_code`**. This avoids
  ambiguities when a user may have multiple licenses for different products.

---

## 3) SQL — Helpers, RLS, and RPCs (ready to run)

> **Run this whole block** (adjust thresholds or lists if needed). All functions are
> `SECURITY INVOKER` unless noted; RLS stays in force.

```sql
-- =========================================================
-- gridocs RLS & helper functions
-- Generated: 2025-08-23 (tailored to your rules)
-- =========================================================

set search_path = gridocs, public;

-- -----------------------------
-- Global thresholds (tunable)
-- -----------------------------
create or replace function gridocs.admin_level_threshold()
returns int language sql stable as $$
  select 40;
$$;

create or replace function gridocs.developer_level_threshold()
returns int language sql stable as $$
  select 60;
$$;

create or replace function gridocs.super_level_threshold()
returns int language sql stable as $$
  select 90;
$$;

-- -----------------------------
-- Role helpers
-- -----------------------------
create or replace function gridocs.get_user_max_role_level(p_user_id uuid)
returns int language sql stable security invoker set search_path = gridocs, public as $$
  select coalesce(max(r.level)::int, 0)
  from gridocs.users_roles ur
  join gridocs.roles r on r.id = ur.role_id
  where ur.user_id = p_user_id;
$$;

create or replace function gridocs.is_global_super(p_user_id uuid)
returns boolean language sql stable security invoker set search_path = gridocs, public as $$
  select gridocs.get_user_max_role_level(p_user_id) >= gridocs.super_level_threshold();
$$;

create or replace function gridocs.is_global_developer(p_user_id uuid)
returns boolean language sql stable security invoker set search_path = gridocs, public as $$
  select gridocs.get_user_max_role_level(p_user_id) >= gridocs.developer_level_threshold();
$$;

create or replace function gridocs.is_global_admin(p_user_id uuid)
returns boolean language sql stable security invoker set search_path = gridocs, public as $$
  select gridocs.get_user_max_role_level(p_user_id) >= gridocs.admin_level_threshold();
$$;

-- -----------------------------
-- Membership helpers
-- -----------------------------
create or replace function gridocs.is_company_member(p_company_id uuid, p_user_id uuid)
returns boolean language sql stable security invoker set search_path = gridocs, public as $$
  select exists (
    select 1 from gridocs.users_companies uc
    where uc.company_id = p_company_id
      and uc.user_id = p_user_id
      and uc.end_date is null
  );
$$;

create or replace function gridocs.is_company_admin(p_company_id uuid, p_user_id uuid)
returns boolean language sql stable security invoker set search_path = gridocs, public as $$
  select gridocs.is_company_member(p_company_id, p_user_id)
     and gridocs.get_user_max_role_level(p_user_id) >= gridocs.admin_level_threshold();
$$;

create or replace function gridocs.is_company_developer(p_company_id uuid, p_user_id uuid)
returns boolean language sql stable security invoker set search_path = gridocs, public as $$
  select gridocs.is_company_member(p_company_id, p_user_id)
     and gridocs.get_user_max_role_level(p_user_id) >= gridocs.developer_level_threshold();
$$;

-- Helpers to resolve scope (optional)
create or replace function gridocs.company_id_for_product_code(p_product_code_id uuid)
returns uuid language sql stable security invoker set search_path = gridocs, public as $$
  select pc.company_id from gridocs.product_codes pc where pc.id = p_product_code_id;
$$;

create or replace function gridocs.company_id_for_document(p_document_id uuid)
returns uuid language sql stable security invoker set search_path = gridocs, public as $$
  select d.company_id from gridocs.documents d where d.id = p_document_id;
$$;

-- ---------------------------------
-- Enable RLS on relevant tables
-- ---------------------------------
alter table if exists gridocs.companies enable row level security;
alter table if exists gridocs.users_companies enable row level security;
alter table if exists gridocs.profiles enable row level security;
alter table if exists gridocs.documents enable row level security;
alter table if exists gridocs.document_versions enable row level security;
alter table if exists gridocs.product_codes enable row level security;
alter table if exists gridocs.addresses enable row level security;
alter table if exists gridocs.address_types enable row level security;
alter table if exists gridocs.companies_addresses enable row level security;
alter table if exists gridocs.users_addresses enable row level security;
alter table if exists gridocs.licenses enable row level security;
alter table if exists gridocs.permissions enable row level security;
alter table if exists gridocs.resources_permissions enable row level security;
alter table if exists gridocs.roles enable row level security;
alter table if exists gridocs.roles_permissions enable row level security;
alter table if exists gridocs.statuses enable row level security;
alter table if exists gridocs.role_in_company enable row level security;

-- =========================================
-- RLS: companies
-- =========================================
drop policy if exists companies_sel on gridocs.companies;
create policy companies_sel on gridocs.companies
  for select
  using (
    auth.uid() is not null and (
      gridocs.is_company_member(id, auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- Create company: Admin+ (Admin, Dev, Super)
drop policy if exists companies_ins on gridocs.companies;
create policy companies_ins on gridocs.companies
  for insert
  with check (
    auth.uid() is not null and (
      gridocs.is_global_admin(auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- Update/Delete company info: Admin+ (Admin, Dev, Super)
drop policy if exists companies_upd on gridocs.companies;
create policy companies_upd on gridocs.companies
  for update
  using (
    auth.uid() is not null and (
      gridocs.is_company_admin(id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  )
  with check (
    auth.uid() is not null and (
      gridocs.is_company_admin(id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists companies_del on gridocs.companies;
create policy companies_del on gridocs.companies
  for delete
  using (
    auth.uid() is not null and (
      gridocs.is_company_admin(id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- =========================================
-- RLS: users_companies
-- =========================================
drop policy if exists users_companies_sel on gridocs.users_companies;
create policy users_companies_sel on gridocs.users_companies
  for select
  using (
    auth.uid() is not null and (
      user_id = auth.uid()
      or gridocs.is_company_member(company_id, auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- Write: Admin+ of that company or Super
drop policy if exists users_companies_ins on gridocs.users_companies;
create policy users_companies_ins on gridocs.users_companies
  for insert
  with check (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists users_companies_upd on gridocs.users_companies;
create policy users_companies_upd on gridocs.users_companies
  for update
  using (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  )
  with check (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists users_companies_del on gridocs.users_companies;
create policy users_companies_del on gridocs.users_companies
  for delete
  using (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- =========================================
-- RLS: profiles
-- =========================================
drop policy if exists profiles_sel on gridocs.profiles;
create policy profiles_sel on gridocs.profiles
  for select
  using (
    auth.uid() is not null and (
      id = auth.uid()
      or exists (
        select 1
        from gridocs.users_companies me
        join gridocs.users_companies them
          on them.company_id = me.company_id and them.user_id = gridocs.profiles.id
        where me.user_id = auth.uid() and me.end_date is null
      )
      or gridocs.is_global_super(auth.uid())
    )
  );

-- Insert: self or Super (usually handled by sign-up pipeline)
drop policy if exists profiles_ins on gridocs.profiles;
create policy profiles_ins on gridocs.profiles
  for insert
  with check (
    auth.uid() is not null and (id = auth.uid() or gridocs.is_global_super(auth.uid()))
  );

-- Update: self (including signature) OR Admin+ of a company the user belongs to OR Super
drop policy if exists profiles_upd on gridocs.profiles;
create policy profiles_upd on gridocs.profiles
  for update
  using (
    auth.uid() is not null and (
      id = auth.uid()
      or exists (
        select 1
        from gridocs.users_companies uc
        where uc.user_id = gridocs.profiles.id
          and gridocs.is_company_admin(uc.company_id, auth.uid())
      )
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  )
  with check (
    auth.uid() is not null and (
      id = auth.uid()
      or exists (
        select 1
        from gridocs.users_companies uc
        where uc.user_id = gridocs.profiles.id
          and gridocs.is_company_admin(uc.company_id, auth.uid())
      )
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- Delete: Super only
drop policy if exists profiles_del on gridocs.profiles;
create policy profiles_del on gridocs.profiles
  for delete
  using (
    auth.uid() is not null and gridocs.is_global_super(auth.uid())
  );

-- =========================================
-- RLS: documents
-- =========================================
drop policy if exists documents_sel on gridocs.documents;
create policy documents_sel on gridocs.documents
  for select
  using (
    auth.uid() is not null and (
      gridocs.is_company_member(company_id, auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- Originals: Admin+ of that company (or global higher) can insert/update/delete
drop policy if exists documents_ins on gridocs.documents;
create policy documents_ins on gridocs.documents
  for insert
  with check (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists documents_upd on gridocs.documents;
create policy documents_upd on gridocs.documents
  for update
  using (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  )
  with check (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists documents_del on gridocs.documents;
create policy documents_del on gridocs.documents
  for delete
  using (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- =========================================
-- RLS: document_versions
-- =========================================
drop policy if exists document_versions_sel on gridocs.document_versions;
create policy document_versions_sel on gridocs.document_versions
  for select
  using (
    auth.uid() is not null and (
      gridocs.is_company_member(company_id, auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- Any member can insert a version (if uploader = self); Admin+ and up can also insert
drop policy if exists document_versions_ins on gridocs.document_versions;
create policy document_versions_ins on gridocs.document_versions
  for insert
  with check (
    auth.uid() is not null and (
      (uploaded_by = auth.uid() and gridocs.is_company_member(company_id, auth.uid()))
      or gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- Update/Delete versions: Admin+ or higher
drop policy if exists document_versions_upd on gridocs.document_versions;
create policy document_versions_upd on gridocs.document_versions
  for update
  using (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  )
  with check (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists document_versions_del on gridocs.document_versions;
create policy document_versions_del on gridocs.document_versions
  for delete
  using (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- =========================================
-- RLS: product_codes
-- =========================================
drop policy if exists product_codes_sel on gridocs.product_codes;
create policy product_codes_sel on gridocs.product_codes
  for select
  using (
    auth.uid() is not null and (
      gridocs.is_company_member(company_id, auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists product_codes_ins on gridocs.product_codes;
create policy product_codes_ins on gridocs.product_codes
  for insert
  with check (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists product_codes_upd on gridocs.product_codes;
create policy product_codes_upd on gridocs.product_codes
  for update
  using (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  )
  with check (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists product_codes_del on gridocs.product_codes;
create policy product_codes_del on gridocs.product_codes
  for delete
  using (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- =========================================
-- RLS: addresses & joins
-- =========================================
drop policy if exists addresses_sel on gridocs.addresses;
create policy addresses_sel on gridocs.addresses
  for select
  using (
    auth.uid() is not null and (
      exists (
        select 1 from gridocs.users_addresses ua
        where ua.address_id = gridocs.addresses.id and ua.user_id = auth.uid()
      )
      or exists (
        select 1 from gridocs.companies_addresses ca
        where ca.address_id = gridocs.addresses.id
          and gridocs.is_company_member(ca.company_id, auth.uid())
      )
      or gridocs.is_global_super(auth.uid())
    )
  );

-- Insert raw addresses: Super only (avoid orphans)
drop policy if exists addresses_ins on gridocs.addresses;
create policy addresses_ins on gridocs.addresses
  for insert
  with check (auth.uid() is not null and gridocs.is_global_super(auth.uid()));

-- Update/Delete address: self-owned via user join OR Admin+ via company join, or Super
drop policy if exists addresses_upd on gridocs.addresses;
create policy addresses_upd on gridocs.addresses
  for update
  using (
    auth.uid() is not null and (
      gridocs.is_global_super(auth.uid())
      or exists (
        select 1 from gridocs.users_addresses ua
        where ua.address_id = gridocs.addresses.id and ua.user_id = auth.uid()
      )
      or exists (
        select 1 from gridocs.companies_addresses ca
        where ca.address_id = gridocs.addresses.id
          and gridocs.is_company_admin(ca.company_id, auth.uid())
      )
    )
  )
  with check (
    auth.uid() is not null and (
      gridocs.is_global_super(auth.uid())
      or exists (
        select 1 from gridocs.users_addresses ua
        where ua.address_id = gridocs.addresses.id and ua.user_id = auth.uid()
      )
      or exists (
        select 1 from gridocs.companies_addresses ca
        where ca.address_id = gridocs.addresses.id
          and gridocs.is_company_admin(ca.company_id, auth.uid())
      )
    )
  );

drop policy if exists addresses_del on gridocs.addresses;
create policy addresses_del on gridocs.addresses
  for delete
  using (
    auth.uid() is not null and gridocs.is_global_super(auth.uid())
  );

-- companies_addresses
drop policy if exists companies_addresses_sel on gridocs.companies_addresses;
create policy companies_addresses_sel on gridocs.companies_addresses
  for select
  using (
    auth.uid() is not null and (
      gridocs.is_company_member(company_id, auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists companies_addresses_ins on gridocs.companies_addresses;
create policy companies_addresses_ins on gridocs.companies_addresses
  for insert
  with check (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists companies_addresses_mut on gridocs.companies_addresses;
create policy companies_addresses_mut on gridocs.companies_addresses
  for update
  using (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  )
  with check (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists companies_addresses_del on gridocs.companies_addresses;
create policy companies_addresses_del on gridocs.companies_addresses
  for delete
  using (
    auth.uid() is not null and (
      gridocs.is_company_admin(company_id, auth.uid())
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- users_addresses
drop policy if exists users_addresses_sel on gridocs.users_addresses;
create policy users_addresses_sel on gridocs.users_addresses
  for select
  using (
    auth.uid() is not null and (
      user_id = auth.uid()
      or exists (
        select 1
        from gridocs.users_companies me
        join gridocs.users_companies them
          on them.company_id = me.company_id and them.user_id = gridocs.users_addresses.user_id
        where me.user_id = auth.uid() and me.end_date is null
      )
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists users_addresses_ins on gridocs.users_addresses;
create policy users_addresses_ins on gridocs.users_addresses
  for insert
  with check (
    auth.uid() is not null and (
      user_id = auth.uid()
      or exists (
        select 1
        from gridocs.users_companies uc
        where uc.user_id = gridocs.users_addresses.user_id
          and gridocs.is_company_admin(uc.company_id, auth.uid())
      )
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists users_addresses_mut on gridocs.users_addresses;
create policy users_addresses_mut on gridocs.users_addresses
  for update
  using (
    auth.uid() is not null and (
      user_id = auth.uid()
      or exists (
        select 1
        from gridocs.users_companies uc
        where uc.user_id = gridocs.users_addresses.user_id
          and gridocs.is_company_admin(uc.company_id, auth.uid())
      )
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  )
  with check (
    auth.uid() is not null and (
      user_id = auth.uid()
      or exists (
        select 1
        from gridocs.users_companies uc
        where uc.user_id = gridocs.users_addresses.user_id
          and gridocs.is_company_admin(uc.company_id, auth.uid())
      )
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists users_addresses_del on gridocs.users_addresses;
create policy users_addresses_del on gridocs.users_addresses
  for delete
  using (
    auth.uid() is not null and (
      user_id = auth.uid()
      or exists (
        select 1
        from gridocs.users_companies uc
        where uc.user_id = gridocs.users_addresses.user_id
          and gridocs.is_company_admin(uc.company_id, auth.uid())
      )
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- =========================================
-- RLS: licenses  (Developer+ only for writes)
-- =========================================
drop policy if exists licenses_sel on gridocs.licenses;
create policy licenses_sel on gridocs.licenses
  for select
  using (
    auth.uid() is not null and (
      user_id = auth.uid()
      or exists (
        select 1
        from gridocs.product_codes pc
        where pc.id = gridocs.licenses.product_code_id
          and gridocs.is_company_member(pc.company_id, auth.uid())
      )
      or gridocs.is_global_super(auth.uid())
    )
  );

-- INSERT: Developer+ of product's company or global Super
drop policy if exists licenses_ins on gridocs.licenses;
create policy licenses_ins on gridocs.licenses
  for insert
  with check (
    auth.uid() is not null and (
      exists (
        select 1
        from gridocs.product_codes pc
        where pc.id = gridocs.licenses.product_code_id
          and gridocs.is_company_developer(pc.company_id, auth.uid())
      )
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- UPDATE/DELETE: Developer+ only
drop policy if exists licenses_upd on gridocs.licenses;
create policy licenses_upd on gridocs.licenses
  for update
  using (
    auth.uid() is not null and (
      exists (
        select 1
        from gridocs.product_codes pc
        where pc.id = gridocs.licenses.product_code_id
          and gridocs.is_company_developer(pc.company_id, auth.uid())
      )
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  )
  with check (
    auth.uid() is not null and (
      exists (
        select 1
        from gridocs.product_codes pc
        where pc.id = gridocs.licenses.product_code_id
          and gridocs.is_company_developer(pc.company_id, auth.uid())
      )
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

drop policy if exists licenses_del on gridocs.licenses;
create policy licenses_del on gridocs.licenses
  for delete
  using (
    auth.uid() is not null and (
      exists (
        select 1
        from gridocs.product_codes pc
        where pc.id = gridocs.licenses.product_code_id
          and gridocs.is_company_developer(pc.company_id, auth.uid())
      )
      or gridocs.is_global_developer(auth.uid())
      or gridocs.is_global_super(auth.uid())
    )
  );

-- =========================================
-- RLS: metadata tables (read auth'd; write Super)
-- =========================================
do $$ begin
  -- permissions
  drop policy if exists permissions_sel on gridocs.permissions;
  create policy permissions_sel on gridocs.permissions for select using (auth.uid() is not null);
  drop policy if exists permissions_mut on gridocs.permissions;
  create policy permissions_mut on gridocs.permissions for all using (gridocs.is_global_super(auth.uid())) with check (gridocs.is_global_super(auth.uid()));

  -- resources_permissions
  drop policy if exists resources_permissions_sel on gridocs.resources_permissions;
  create policy resources_permissions_sel on gridocs.resources_permissions for select using (auth.uid() is not null);
  drop policy if exists resources_permissions_mut on gridocs.resources_permissions;
  create policy resources_permissions_mut on gridocs.resources_permissions for all using (gridocs.is_global_super(auth.uid())) with check (gridocs.is_global_super(auth.uid()));

  -- roles
  drop policy if exists roles_sel on gridocs.roles;
  create policy roles_sel on gridocs.roles for select using (auth.uid() is not null);
  drop policy if exists roles_mut on gridocs.roles;
  create policy roles_mut on gridocs.roles for all using (gridocs.is_global_super(auth.uid())) with check (gridocs.is_global_super(auth.uid()));

  -- roles_permissions
  drop policy if exists roles_permissions_sel on gridocs.roles_permissions;
  create policy roles_permissions_sel on gridocs.roles_permissions for select using (auth.uid() is not null);
  drop policy if exists roles_permissions_mut on gridocs.roles_permissions;
  create policy roles_permissions_mut on gridocs.roles_permissions for all using (gridocs.is_global_super(auth.uid())) with check (gridocs.is_global_super(auth.uid()));

  -- statuses
  drop policy if exists statuses_sel on gridocs.statuses;
  create policy statuses_sel on gridocs.statuses for select using (auth.uid() is not null);
  drop policy if exists statuses_mut on gridocs.statuses;
  create policy statuses_mut on gridocs.statuses for all using (gridocs.is_global_super(auth.uid())) with check (gridocs.is_global_super(auth.uid()));

  -- address_types
  drop policy if exists address_types_sel on gridocs.address_types;
  create policy address_types_sel on gridocs.address_types for select using (auth.uid() is not null);
  drop policy if exists address_types_mut on gridocs.address_types;
  create policy address_types_mut on gridocs.address_types for all using (gridocs.is_global_super(auth.uid())) with check (gridocs.is_global_super(auth.uid()));

  -- role_in_company
  drop policy if exists role_in_company_sel on gridocs.role_in_company;
  create policy role_in_company_sel on gridocs.role_in_company for select using (auth.uid() is not null);
  drop policy if exists role_in_company_mut on gridocs.role_in_company;
  create policy role_in_company_mut on gridocs.role_in_company for all using (gridocs.is_global_super(auth.uid())) with check (gridocs.is_global_super(auth.uid()));
end $$;

-- =========================================================
-- RPCs (including "current license" requiring product_code)
-- =========================================================

-- Status id by name (to avoid .from('statuses'))
create or replace function gridocs.get_status_id_by_name(p_name text)
returns uuid
language sql
security invoker
stable
set search_path = gridocs, public
as $$
  select s.id from gridocs.statuses s where s.name = p_name limit 1;
$$;

-- Create/Update profile (self) via RPC instead of direct table write
create or replace function gridocs.create_or_update_my_profile(
  p_first_name text,
  p_last_name text,
  p_email_address text,
  p_phone_number text,
  p_status_id uuid default null,
  p_signature text default null,
  p_avatar text default null
) returns gridocs.profiles
language plpgsql
security invoker
set search_path = gridocs, public
as $$
declare
  v_id uuid := auth.uid();
  v_existing gridocs.profiles%rowtype;
begin
  if v_id is null then
    raise exception 'Unauthenticated';
  end if;

  select * into v_existing from gridocs.profiles where id = v_id;

  if found then
    update gridocs.profiles
       set first_name   = p_first_name,
           last_name    = p_last_name,
           email_address= p_email_address,
           phone_number = p_phone_number,
           status_id    = coalesce(p_status_id, status_id),
           signature    = coalesce(p_signature, signature),
           avatar       = coalesce(p_avatar, avatar)
     where id = v_id
     returning * into v_existing;
    return v_existing;
  else
    insert into gridocs.profiles (id, first_name, last_name, email_address, phone_number, status_id, signature, avatar)
    values (v_id, p_first_name, p_last_name, p_email_address, p_phone_number, p_status_id, p_signature, p_avatar)
    returning * into v_existing;
    return v_existing;
  end if;
end;
$$;

-- Create company (Admin+ and up)
create or replace function gridocs.create_company(p_name text, p_website text default null)
returns gridocs.companies
language sql
security invoker
stable
set search_path = gridocs, public
as $$
  insert into gridocs.companies (name, website, created_by)
  values (p_name, p_website, auth.uid())
  returning *;
$$;

-- Current license for a user & product_code (NULL expires_at is NOT current)
-- "Current" statuses you accept (tune list if needed)
create or replace function gridocs.get_current_license_for_user(
  p_user_id uuid,
  p_product_code text
) returns table(
  license_id uuid,
  product_code_id uuid,
  product_code text,
  status_id uuid,
  status_name text,
  device_info text,
  signature text,
  issued_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz,
  notes text
)
language sql
security invoker
stable
set search_path = gridocs, public
as $$
  select
    l.id,
    l.product_code_id,
    pc.code as product_code,
    l.status_id,
    s.name as status_name,
    l.device_info,
    l.signature,
    l.issued_at,
    l.expires_at,
    l.created_at,
    l.notes
  from gridocs.licenses l
  join gridocs.product_codes pc on pc.id = l.product_code_id
  left join gridocs.statuses s on s.id = l.status_id
  where l.user_id = p_user_id
    and pc.code = p_product_code
    and l.expires_at >= now()                     -- NULL is NOT current
    and coalesce(s.name,'') = any(array['Active','Issued','Renewed','Paid','Registered'])
  order by l.expires_at desc, l.issued_at desc nulls last
  limit 1;
$$;

-- One current license per product (handy list)
create or replace function gridocs.get_current_licenses_for_user(
  p_user_id uuid
) returns table(
  product_code text,
  license_id uuid,
  status_name text,
  issued_at timestamptz,
  expires_at timestamptz
)
language sql
security invoker
stable
set search_path = gridocs, public
as $$
  with ranked as (
    select
      pc.code as product_code,
      l.id as license_id,
      s.name as status_name,
      l.issued_at,
      l.expires_at,
      row_number() over (
        partition by pc.code
        order by l.expires_at desc, l.issued_at desc nulls last
      ) as rn
    from gridocs.licenses l
    join gridocs.product_codes pc on pc.id = l.product_code_id
    left join gridocs.statuses s on s.id = l.status_id
    where l.user_id = p_user_id
      and l.expires_at >= now()
      and coalesce(s.name,'') = any(array['Active','Issued','Renewed','Paid','Registered'])
  )
  select product_code, license_id, status_name, issued_at, expires_at
  from ranked
  where rn = 1;
$$;
```

---

## 4) PostgreSQL `infinity` for timestamps (when to use)

PostgreSQL supports special timestamp values:

- **`'infinity'::timestamptz`** – greater than any finite timestamp.
- **`'-infinity'::timestamptz`** – less than any finite timestamp.

Properties:

- Comparisons behave as you’d expect:
  - `'infinity' >= now()` → **true**
  - `'infinity' > '2999-01-01'` → **true**

- Indexing: fully supported; B-tree indexes handle infinity correctly.
- Use case here: to represent “no expiration,” set `expires_at = 'infinity'`. Our
  “current” check (`expires_at >= now()`) naturally treats it as current.

**Why not `NULL`?**

- `NULL` means “unknown/missing,” not “never expires.”
- `NULL >= now()` is **NULL** (treated as false in `WHERE`), so it won’t count as
  current, which aligns with your requirement.

> Migration tip: if you have rows that were intended as “no expiration” but currently
> `NULL`,
> `UPDATE licenses SET expires_at = 'infinity' WHERE expires_at IS NULL AND <intended-no-expiration>;`

---

## 5) Edge Function example (using `supabase.rpc` only)

Below is your original example, adapted to **exclusively** use RPCs we added. It signs
up a user, fetches `Pending` status id via RPC, creates/updates profile via RPC, and
creates a company via RPC (requires Admin+ token; if you want onboarding for non-admins,
you’d typically do this through a **separate privileged** workflow or an approval
queue).

```ts
import { createClient } from 'jsr:@supabase/supabase-js';

/**
 * Creates a standardized JSON response.
 */
const jsonResponse = (body, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

const schema = 'gridocs';
const pendingStatus = 'Pending';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('PUBLISHABLE_KEY'),
  { db: { schema } },
);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const body = await req.json();
    const {
      first_name,
      last_name,
      email_address,
      password,
      company_name,
      phone_number,
      device_info, // You can store it later as part of license workflows
    } = body;

    // 1) Auth sign up
    const {
      data: { user },
      error: signUpError,
    } = await supabase.auth.signUp({
      email: email_address,
      password,
    });
    if (signUpError) {
      console.dir(signUpError);
      return jsonResponse({ error: 'Internal Error: Could not sign up the user' }, 401);
    }

    // 2) Resolve 'Pending' status id via RPC
    const { data: statusId, error: statusError } = await supabase.rpc(
      'get_status_id_by_name',
      {
        p_name: pendingStatus,
      },
    );
    if (statusError || !statusId) {
      console.dir(statusError);
      return jsonResponse(
        { error: 'Internal Error: Could not retrieve the status id' },
        401,
      );
    }

    // 3) Create/Update profile (self) via RPC
    const { data: profile, error: profileErr } = await supabase.rpc(
      'create_or_update_my_profile',
      {
        p_first_name: first_name,
        p_last_name: last_name,
        p_email_address: email_address,
        p_phone_number: phone_number,
        p_status_id: statusId,
        // p_signature / p_avatar optional
      },
    );
    if (profileErr) {
      console.dir(profileErr);
      return jsonResponse({ error: 'Internal Error: Could not upsert profile' }, 401);
    }

    // 4) Create company (requires Admin+ token)
    if (company_name) {
      const { data: company, error: companyErr } = await supabase.rpc(
        'create_company',
        {
          p_name: company_name,
        },
      );
      if (companyErr) {
        // Not fatal for user creation; depends on your UX
        console.dir(companyErr);
        return jsonResponse(
          { error: 'Could not create company (Admin+ required)' },
          403,
        );
      }
    }

    // 5) Success
    return jsonResponse({
      success: true,
      message: 'User created successfully!',
      user: { id: user.id, email_address: user.email },
    });
  } catch (err) {
    console.error('[Edge Function] Error: ', err);
    if (err instanceof SyntaxError) {
      return jsonResponse({ error: 'Invalid JSON body provided' }, 400);
    }
    return jsonResponse(
      { error: 'An internal server error occurred', details: err.message },
      500,
    );
  }
});
```

### Other useful RPC call examples

```ts
// Get current license for a given user & product code
await supabase.rpc('get_current_license_for_user', {
  p_user_id: someUserId,
  p_product_code: 'ACME-PRO-001',
});

// Get one current license per product for a user
await supabase.rpc('get_current_licenses_for_user', { p_user_id: someUserId });

// Resolve a status id by name (e.g., 'Active', 'Pending', etc.)
await supabase.rpc('get_status_id_by_name', { p_name: 'Active' });

// Upsert my profile (self-service, includes signature)
await supabase.rpc('create_or_update_my_profile', {
  p_first_name: 'Ada',
  p_last_name: 'Lovelace',
  p_email_address: 'ada@example.com',
  p_phone_number: '+1-555-555-1234',
  p_signature: 'Ada L.',
});

// Create a company (Admin / Developer / Super)
await supabase.rpc('create_company', { p_name: 'Acme Inc.' });
```

---

## 6) Notes for architects

- **Privilege boundaries** are enforced at the database level via RLS and **role
  thresholds** (Admin/Developer/Super). Switching an org to stricter/looser governance
  is a single change to threshold functions.
- **Licenses are sensitive**: only **Developer+** may mutate. Connect UI “request” flows
  to **privileged Edge Functions** or ticketing; those privileged paths then call
  license-write RPCs using a service role key.
- **Infinity** for “no expiration” keeps the logic monotonic and index-friendly. Avoid
  `NULL` for “no expiration.”
- **RPC-first app**: prefer `supabase.rpc(...)` wrappers over direct `from(...)`—it
  centralizes logic, prevents schema leaks, and eases future migrations.

---

If you want me to plug in your exact **role names ↔ level numbers** (e.g.,
Administrator=50, Developer=70, Super=100) or to add **grant helpers** (e.g., “promote
user to Developer for company X”), say the word and I’ll wire those with safe checks.
