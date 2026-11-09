-- 0041_daily_remarks.postgres.sql
-- One operational remark per company, per date, per kind (sales or expense)

CREATE TABLE IF NOT EXISTS daily_remarks (
    daily_remark_id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL,
    remark_date DATE NOT NULL,
    kind VARCHAR(20) NOT NULL,
    remarks TEXT NOT NULL,
    updated_by VARCHAR(150) NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_daily_remarks_company_date_kind UNIQUE (company_id, remark_date, kind)
);

CREATE INDEX IF NOT EXISTS ix_daily_remarks_company_id ON daily_remarks (company_id);
