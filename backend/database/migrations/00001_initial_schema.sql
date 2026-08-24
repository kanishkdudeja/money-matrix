-- +goose Up
-- +goose StatementBegin

-- Every monetary bigint in this schema stores signed minor currency units.

CREATE TABLE financial_accounts (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN (
        'bank', 'cash', 'credit_card', 'loan', 'investment', 'other'
    )),
    balance_class text NOT NULL DEFAULT 'asset' CHECK (balance_class IN ('asset', 'liability')),
    currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
    note text,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (name)
);

CREATE TABLE transactions (
    id uuid PRIMARY KEY,
    occurred_on date NOT NULL,
    description text NOT NULL CHECK (length(trim(description)) > 0),
    kind text NOT NULL CHECK (kind IN (
        'income', 'expense', 'transfer', 'refund', 'adjustment',
        'opening_balance', 'bucket_transfer'
    )),
    status text NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'reversed')),
    origin text NOT NULL CHECK (origin IN ('manual', 'import', 'recurring_rule', 'system')),
    reversal_of_id uuid REFERENCES transactions(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (reversal_of_id IS NULL OR reversal_of_id <> id)
);

CREATE UNIQUE INDEX transactions_one_reversal_per_transaction
    ON transactions (reversal_of_id)
    WHERE reversal_of_id IS NOT NULL;

CREATE INDEX transactions_occurred_on_idx ON transactions (occurred_on DESC, id);

CREATE TABLE postings (
    id uuid PRIMARY KEY,
    transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    financial_account_id uuid NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
    amount bigint NOT NULL CHECK (amount <> 0),
    position smallint NOT NULL CHECK (position >= 0),
    memo text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (transaction_id, position)
);

CREATE INDEX postings_account_idx ON postings (financial_account_id, transaction_id);

CREATE TABLE categories (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('income', 'expense')),
    parent_id uuid REFERENCES categories(id) ON DELETE RESTRICT,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (parent_id IS NULL OR parent_id <> id),
    UNIQUE (kind, name)
);

CREATE TABLE buckets (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE,
    note text,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (id <> '00000000-0000-0000-0000-000000000001' OR archived_at IS NULL)
);

CREATE TABLE bucket_entries (
    id uuid PRIMARY KEY,
    transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    bucket_id uuid NOT NULL REFERENCES buckets(id) ON DELETE RESTRICT,
    category_id uuid REFERENCES categories(id) ON DELETE RESTRICT,
    amount bigint NOT NULL CHECK (amount <> 0),
    position smallint NOT NULL CHECK (position >= 0),
    memo text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (transaction_id, position)
);

CREATE INDEX bucket_entries_bucket_idx ON bucket_entries (bucket_id, transaction_id);
CREATE INDEX bucket_entries_category_idx
    ON bucket_entries (category_id, transaction_id)
    WHERE category_id IS NOT NULL;

INSERT INTO buckets (id, name, note)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Unallocated',
    'Money that has not yet been reserved for another purpose.'
);

CREATE FUNCTION money_matrix_protect_unallocated_bucket()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.id = '00000000-0000-0000-0000-000000000001' THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'the Unallocated bucket cannot be deleted'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.id <> OLD.id OR NEW.archived_at IS NOT NULL THEN
            RAISE EXCEPTION 'the Unallocated bucket cannot be reidentified or archived'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER buckets_protect_unallocated
BEFORE UPDATE OR DELETE ON buckets
FOR EACH ROW
EXECUTE FUNCTION money_matrix_protect_unallocated_bucket();

CREATE TABLE parser_profiles (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    format text NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf')),
    institution text,
    mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
    parser_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (name, parser_version)
);

CREATE TABLE import_batches (
    id uuid PRIMARY KEY,
    financial_account_id uuid NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
    parser_profile_id uuid REFERENCES parser_profiles(id) ON DELETE RESTRICT,
    format text NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf')),
    file_name text NOT NULL,
    file_hash text NOT NULL,
    status text NOT NULL CHECK (status IN ('uploaded', 'processing', 'ready', 'failed', 'completed')),
    statement_start date,
    statement_end date,
    error_detail text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (financial_account_id, file_hash)
);

CREATE TABLE imported_rows (
    id uuid PRIMARY KEY,
    import_batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE RESTRICT,
    source_row integer NOT NULL CHECK (source_row >= 0),
    raw_data jsonb NOT NULL,
    transaction_date date,
    value_date date,
    description text,
    reference text,
    amount bigint,
    balance bigint,
    currency char(3) NOT NULL DEFAULT 'INR',
    fingerprint text,
    transaction_id uuid REFERENCES transactions(id) ON DELETE RESTRICT,
    review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN (
        'pending', 'suggested', 'reviewed', 'skipped', 'duplicate', 'invalid'
    )),
    parse_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (import_batch_id, source_row),
    CHECK (currency = upper(currency))
);

CREATE UNIQUE INDEX imported_rows_transaction_idx
    ON imported_rows (transaction_id)
    WHERE transaction_id IS NOT NULL;

CREATE INDEX imported_rows_fingerprint_idx
    ON imported_rows (fingerprint)
    WHERE fingerprint IS NOT NULL;

CREATE TABLE categorization_rules (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    priority integer NOT NULL DEFAULT 0,
    conditions jsonb NOT NULL,
    category_id uuid REFERENCES categories(id) ON DELETE RESTRICT,
    bucket_id uuid REFERENCES buckets(id) ON DELETE RESTRICT,
    transaction_kind text CHECK (transaction_kind IS NULL OR transaction_kind IN (
        'income', 'expense', 'transfer', 'refund', 'adjustment',
        'opening_balance', 'bucket_transfer'
    )),
    auto_apply boolean NOT NULL DEFAULT false,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (category_id IS NOT NULL OR bucket_id IS NOT NULL OR transaction_kind IS NOT NULL)
);

CREATE TABLE reconciliations (
    id uuid PRIMARY KEY,
    financial_account_id uuid NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
    statement_date date NOT NULL,
    statement_balance bigint NOT NULL,
    status text NOT NULL CHECK (status IN ('in_progress', 'completed', 'reopened')),
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (financial_account_id, statement_date),
    CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR status <> 'completed')
);

CREATE UNIQUE INDEX reconciliations_one_open_per_account
    ON reconciliations (financial_account_id)
    WHERE status IN ('in_progress', 'reopened');

CREATE TABLE reconciliation_postings (
    reconciliation_id uuid NOT NULL REFERENCES reconciliations(id) ON DELETE RESTRICT,
    posting_id uuid NOT NULL REFERENCES postings(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (reconciliation_id, posting_id),
    UNIQUE (posting_id)
);

CREATE TABLE plans (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    status text NOT NULL CHECK (status IN ('draft', 'active', 'closed')),
    currency char(3) NOT NULL DEFAULT 'INR',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (period_end >= period_start),
    CHECK (currency = upper(currency))
);

CREATE TABLE recurring_rules (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    schedule text NOT NULL,
    expected_amount bigint,
    financial_account_id uuid REFERENCES financial_accounts(id) ON DELETE RESTRICT,
    category_id uuid REFERENCES categories(id) ON DELETE RESTRICT,
    bucket_id uuid REFERENCES buckets(id) ON DELETE RESTRICT,
    plan_id uuid REFERENCES plans(id) ON DELETE RESTRICT,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX import_batches_status_created_at_idx
    ON import_batches (status, created_at DESC, id);

CREATE FUNCTION money_matrix_validate_category_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_kind text;
    creates_cycle boolean;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM categories child
        WHERE child.parent_id = NEW.id
          AND child.kind <> NEW.kind
    ) THEN
        RAISE EXCEPTION 'a category and its children must have the same kind'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT kind INTO parent_kind
    FROM categories
    WHERE id = NEW.parent_id;

    IF parent_kind IS NULL THEN
        RAISE EXCEPTION 'category parent does not exist'
            USING ERRCODE = '23503';
    END IF;
    IF parent_kind <> NEW.kind THEN
        RAISE EXCEPTION 'a category and its parent must have the same kind'
            USING ERRCODE = '23514';
    END IF;

    WITH RECURSIVE ancestors AS (
        SELECT id, parent_id
        FROM categories
        WHERE id = NEW.parent_id

        UNION

        SELECT parent.id, parent.parent_id
        FROM categories parent
        JOIN ancestors child ON parent.id = child.parent_id
    )
    SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
    INTO creates_cycle;

    IF creates_cycle THEN
        RAISE EXCEPTION 'category hierarchy must not contain a cycle'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER categories_validate_hierarchy
BEFORE INSERT OR UPDATE OF parent_id, kind ON categories
FOR EACH ROW
EXECUTE FUNCTION money_matrix_validate_category_hierarchy();

CREATE FUNCTION money_matrix_guard_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    existing_status text;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        SELECT status INTO existing_status
        FROM transactions
        WHERE id = OLD.transaction_id;

        IF existing_status = 'reversed' THEN
            RAISE EXCEPTION 'entries belonging to a reversed transaction are immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER postings_guard_mutation
BEFORE UPDATE OR DELETE ON postings
FOR EACH ROW
EXECUTE FUNCTION money_matrix_guard_entry_mutation();

CREATE TRIGGER bucket_entries_guard_mutation
BEFORE UPDATE OR DELETE ON bucket_entries
FOR EACH ROW
EXECUTE FUNCTION money_matrix_guard_entry_mutation();

CREATE FUNCTION money_matrix_require_active_posting_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    target_archived_at timestamptz;
    is_reversal boolean;
BEGIN
    SELECT account.archived_at, transaction.reversal_of_id IS NOT NULL
    INTO target_archived_at, is_reversal
    FROM transactions transaction
    JOIN financial_accounts account ON account.id = NEW.financial_account_id
    WHERE transaction.id = NEW.transaction_id;

    IF target_archived_at IS NOT NULL AND NOT is_reversal THEN
        RAISE EXCEPTION 'new activity cannot use an archived financial account'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION money_matrix_require_active_bucket_entry_targets()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    bucket_archived_at timestamptz;
    category_archived_at timestamptz;
    is_reversal boolean;
BEGIN
    SELECT bucket.archived_at, category.archived_at, transaction.reversal_of_id IS NOT NULL
    INTO bucket_archived_at, category_archived_at, is_reversal
    FROM transactions transaction
    JOIN buckets bucket ON bucket.id = NEW.bucket_id
    LEFT JOIN categories category ON category.id = NEW.category_id
    WHERE transaction.id = NEW.transaction_id;

    IF bucket_archived_at IS NOT NULL AND NOT is_reversal THEN
        RAISE EXCEPTION 'new activity cannot use an archived bucket'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.category_id IS NOT NULL AND category_archived_at IS NOT NULL AND NOT is_reversal THEN
        RAISE EXCEPTION 'new activity cannot use an archived category'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER postings_require_active_target
BEFORE INSERT OR UPDATE OF transaction_id, financial_account_id ON postings
FOR EACH ROW
EXECUTE FUNCTION money_matrix_require_active_posting_target();

CREATE TRIGGER bucket_entries_require_active_targets
BEFORE INSERT OR UPDATE OF transaction_id, bucket_id, category_id ON bucket_entries
FOR EACH ROW
EXECUTE FUNCTION money_matrix_require_active_bucket_entry_targets();

CREATE FUNCTION money_matrix_assert_transaction_integrity(checked_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    transaction_kind text;
    transaction_status text;
    posting_count bigint;
    financial_coverage numeric;
    bucket_entry_count bigint;
    categorized_entry_count bigint;
    distinct_bucket_count bigint;
    bucket_total numeric;
BEGIN
    SELECT kind, status
    INTO transaction_kind, transaction_status
    FROM transactions
    WHERE id = checked_transaction_id;

    IF NOT FOUND OR transaction_status = 'draft' THEN
        RETURN;
    END IF;

    SELECT
        count(*),
        COALESCE(sum(CASE WHEN account.balance_class = 'liability' THEN -posting.amount::numeric ELSE posting.amount::numeric END), 0)
    INTO posting_count, financial_coverage
    FROM postings posting
    JOIN financial_accounts account ON account.id = posting.financial_account_id
    WHERE posting.transaction_id = checked_transaction_id;

    SELECT
        count(*),
        count(*) FILTER (WHERE category_id IS NOT NULL),
        count(DISTINCT bucket_id),
        COALESCE(sum(amount::numeric), 0)
    INTO bucket_entry_count, categorized_entry_count, distinct_bucket_count, bucket_total
    FROM bucket_entries
    WHERE transaction_id = checked_transaction_id;

    IF transaction_kind = 'bucket_transfer' THEN
        IF posting_count <> 0 OR categorized_entry_count <> 0 OR bucket_entry_count < 2
            OR distinct_bucket_count < 2 OR bucket_total <> 0 THEN
            RAISE EXCEPTION 'invalid bucket transfer ledger shape'
                USING ERRCODE = '23514';
        END IF;
        RETURN;
    END IF;

    IF posting_count = 0 THEN
        RAISE EXCEPTION 'posted financial transactions require at least one posting'
            USING ERRCODE = '23514';
    END IF;
    IF bucket_total <> financial_coverage THEN
        RAISE EXCEPTION 'bucket entries must equal the financial coverage change'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION money_matrix_check_transaction_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    checked_transaction_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'transactions' THEN
        checked_transaction_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE
        checked_transaction_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.transaction_id ELSE NEW.transaction_id END;
    END IF;

    PERFORM money_matrix_assert_transaction_integrity(checked_transaction_id);

    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME <> 'transactions' THEN
        IF OLD.transaction_id <> NEW.transaction_id THEN
            PERFORM money_matrix_assert_transaction_integrity(OLD.transaction_id);
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER transactions_check_integrity
AFTER INSERT OR UPDATE OR DELETE ON transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION money_matrix_check_transaction_integrity();

CREATE CONSTRAINT TRIGGER postings_check_transaction_integrity
AFTER INSERT OR UPDATE OR DELETE ON postings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION money_matrix_check_transaction_integrity();

CREATE CONSTRAINT TRIGGER bucket_entries_check_transaction_integrity
AFTER INSERT OR UPDATE OR DELETE ON bucket_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION money_matrix_check_transaction_integrity();

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TRIGGER bucket_entries_check_transaction_integrity ON bucket_entries;
DROP TRIGGER postings_check_transaction_integrity ON postings;
DROP TRIGGER transactions_check_integrity ON transactions;
DROP FUNCTION money_matrix_check_transaction_integrity();
DROP FUNCTION money_matrix_assert_transaction_integrity(uuid);

DROP TRIGGER buckets_protect_unallocated ON buckets;
DROP FUNCTION money_matrix_protect_unallocated_bucket();

DROP TRIGGER bucket_entries_require_active_targets ON bucket_entries;
DROP TRIGGER postings_require_active_target ON postings;
DROP FUNCTION money_matrix_require_active_bucket_entry_targets();
DROP FUNCTION money_matrix_require_active_posting_target();

DROP TRIGGER bucket_entries_guard_mutation ON bucket_entries;
DROP TRIGGER postings_guard_mutation ON postings;
DROP FUNCTION money_matrix_guard_entry_mutation();

DROP TRIGGER categories_validate_hierarchy ON categories;
DROP FUNCTION money_matrix_validate_category_hierarchy();

DROP TABLE recurring_rules;
DROP TABLE plans;
DROP TABLE reconciliation_postings;
DROP TABLE reconciliations;
DROP TABLE categorization_rules;
DROP TABLE imported_rows;
DROP TABLE import_batches;
DROP TABLE parser_profiles;
DROP TABLE bucket_entries;
DROP TABLE buckets;
DROP TABLE categories;
DROP TABLE postings;
DROP TABLE transactions;
DROP TABLE financial_accounts;

-- +goose StatementEnd
