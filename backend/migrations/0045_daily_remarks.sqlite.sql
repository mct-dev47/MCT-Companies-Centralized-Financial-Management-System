-- 0041_daily_remarks.sqlite.sql
-- One operational remark per company, per date, per kind (sales or expense)

CREATE TABLE IF NOT EXISTS daily_remarks (
    daily_remark_id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    remark_date DATE NOT NULL,
    kind VARCHAR(20) NOT NULL,
    remarks TEXT NOT NULL,
    updated_by VARCHAR(150) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_daily_remarks_company_date_kind UNIQUE (company_id, remark_date, kind)
);

CREATE INDEX IF NOT EXISTS ix_daily_remarks_company_id ON daily_remarks (company_id);
