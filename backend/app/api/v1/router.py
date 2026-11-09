from fastapi import APIRouter
from app.api.v1.endpoints import (
    health,
    auth,
    users,
    companies,
    categories,
    cash_inflows,
    sales,
    expenses,
    budgets,
    loans,
    calculations,
    audit_logs,
    activity_logs,
    notifications,
    bills,
    petty_cash,
    bank_accounts,
    lending,
    tenants,
    receivables,
    invitations,
    particulars,
    payment_methods,
    daily_remarks,
)

api_router = APIRouter()

api_router.include_router(health.router, tags=["Health"])
api_router.include_router(auth.router, tags=["Authentication"])
api_router.include_router(users.router, prefix="/users", tags=["Users"])
api_router.include_router(companies.router, prefix="/companies", tags=["Companies"])
api_router.include_router(categories.router, prefix="/categories", tags=["Categories"])
api_router.include_router(cash_inflows.router, prefix="/cash-inflows", tags=["Cash Inflows"])
api_router.include_router(sales.router, prefix="/sales", tags=["Sales"])
api_router.include_router(expenses.router, prefix="/expenses", tags=["Expenses"])
api_router.include_router(budgets.router, prefix="/budgets", tags=["Budgets"])
api_router.include_router(loans.router, prefix="/loans", tags=["Loans"])
api_router.include_router(calculations.router, prefix="/calculations", tags=["Financial Calculations"])
api_router.include_router(audit_logs.router, tags=["Audit Logs"])
api_router.include_router(activity_logs.router, tags=["Activity Logs"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])
api_router.include_router(bills.router, prefix="/bills", tags=["Bills"])
api_router.include_router(petty_cash.router, prefix="/petty-cash", tags=["Petty Cash"])
api_router.include_router(bank_accounts.router, prefix="/bank-accounts", tags=["Bank Accounts"])
api_router.include_router(lending.router, prefix="/lending", tags=["Lending"])
api_router.include_router(tenants.router, prefix="/tenants", tags=["Tenants"])
api_router.include_router(receivables.router, prefix="/receivables", tags=["Receivables"])
api_router.include_router(invitations.router, prefix="/admin/invitations", tags=["Admin Invitations"])
api_router.include_router(particulars.router, prefix="/particulars", tags=["Particulars"])
api_router.include_router(payment_methods.router, prefix="/payment-methods", tags=["Payment Methods"])
api_router.include_router(daily_remarks.router, prefix="/daily-remarks", tags=["Daily Remarks"])
