-- 0071: Permanently drop deprecated unused tables with CASCADE
DROP TABLE IF EXISTS staff_credits_repayment CASCADE;
DROP TABLE IF EXISTS staff_credits CASCADE;
DROP TABLE IF EXISTS budget CASCADE;
DROP TABLE IF EXISTS cash_inflow CASCADE;
DROP TABLE IF EXISTS login_rate_limits CASCADE;
