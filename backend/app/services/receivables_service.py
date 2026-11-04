from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from fastapi import HTTPException, status
from sqlalchemy import desc, func, or_
from sqlalchemy.orm import Session

from app.core.websocket import ws_manager
from app.models.company import Company
from app.models.receivable import Receivable, ReceivablePayment
from app.schemas.receivable import (
    DebtorBatchUpdate,
    ReceivableCreate,
    ReceivablePaymentCreate,
    ReceivablesKPIsOut,
    ReceivableUpdate,
)
from app.services.bank_service import BankService
from app.services.sales_receivables_sync import SalesReceivablesSyncService


class ReceivablesService:
    def __init__(self, db: Session):
        self.db = db
        self.sync_service = SalesReceivablesSyncService(db)

    def _resolve_company_info(self, company_id: Optional[int], company_name: Optional[str]) -> Tuple[int, str]:
        if company_id:
            c = self.db.query(Company).filter(Company.company_id == company_id).first()
            if c:
                return c.company_id, c.company_name
        if company_name:
            c = (
                self.db.query(Company)
                .filter(func.lower(Company.company_name) == company_name.strip().lower())
                .first()
            )
            if c:
                return c.company_id, c.company_name
            c = self.db.query(Company).filter(Company.company_name.ilike(f"%{company_name.strip()}%")).first()
            if c:
                return c.company_id, c.company_name

        first_company = self.db.query(Company).first()
        if first_company:
            return first_company.company_id, first_company.company_name
        return 1, company_name or "MyCity.Kitchen Corporation"

    def _apply_company_filters(
        self,
        query,
        company_id: Optional[int] = None,
        company_ids: Optional[List[int]] = None,
        company_name: Optional[str] = None,
    ):
        if company_ids is not None:
            if not company_ids:
                return query.filter(Receivable.company_id == -1)
            query = query.filter(Receivable.company_id.in_(company_ids))
        if company_id:
            query = query.filter(Receivable.company_id == company_id)
        elif company_name and company_name.strip().lower() not in ("all", "all companies", ""):
            query = query.filter(Receivable.company_name.ilike(f"%{company_name.strip()}%"))
        return query

    def list_receivables(
        self,
        company_id: Optional[int] = None,
        company_ids: Optional[List[int]] = None,
        company_name: Optional[str] = None,
        customer_type: Optional[str] = None,
        payment_status: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        search: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Receivable]:
        self.seed_initial_receivables_if_empty()

        query = self.db.query(Receivable)
        query = self._apply_company_filters(query, company_id=company_id, company_ids=company_ids, company_name=company_name)

        if customer_type and customer_type.strip().lower() not in ("all", ""):
            ct = customer_type.strip().lower()
            if ct in ("internal", "staff"):
                query = query.filter(Receivable.customer_type.in_(["Internal", "Staff"]))
            else:
                query = query.filter(Receivable.customer_type == "External")

        if payment_status and payment_status.strip().lower() not in ("all", ""):
            query = query.filter(func.lower(Receivable.payment_status) == payment_status.strip().lower())

        if start_date:
            query = query.filter(Receivable.transaction_date >= start_date)
        if end_date:
            query = query.filter(Receivable.transaction_date <= end_date)

        if search and search.strip():
            term = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    Receivable.customer_name.ilike(term),
                    Receivable.items_summary.ilike(term),
                    Receivable.notes.ilike(term),
                )
            )

        rows = (
            query.order_by(desc(Receivable.transaction_date), desc(Receivable.receivable_id))
            .offset(offset)
            .limit(limit)
            .all()
        )
        return self.sync_service.attach_lock_flags(rows)

    def get_summary_kpis(
        self,
        company_id: Optional[int] = None,
        company_ids: Optional[List[int]] = None,
        company_name: Optional[str] = None,
    ) -> ReceivablesKPIsOut:
        self.seed_initial_receivables_if_empty()

        query = self.db.query(Receivable)
        query = self._apply_company_filters(query, company_id=company_id, company_ids=company_ids, company_name=company_name)

        all_recs = query.all()

        total_sales = Decimal("0.00")
        cash_collected = Decimal("0.00")
        total_outstanding = Decimal("0.00")
        total_external_utang = Decimal("0.00")
        total_staff_utang = Decimal("0.00")

        external_debtors = set()
        staff_debtors = set()
        all_debtors = set()

        for r in all_recs:
            total_sales += Decimal(str(r.total_amount or 0))
            cash_collected += Decimal(str(r.amount_paid or 0))
            bal = Decimal(str(r.balance or 0))
            total_outstanding += bal

            cname = (r.customer_name or "").strip().lower()
            ctype = (r.customer_type or "").strip().lower()

            if bal > Decimal("0.005"):
                all_debtors.add(cname)
                if ctype in ("internal", "staff"):
                    total_staff_utang += bal
                    staff_debtors.add(cname)
                else:
                    total_external_utang += bal
                    external_debtors.add(cname)

        return ReceivablesKPIsOut(
            totalSales=total_sales,
            cashCollected=cash_collected,
            totalOutstanding=total_outstanding,
            totalExternalUtang=total_external_utang,
            totalStaffUtang=total_staff_utang,
            externalDebtorCount=len(external_debtors),
            staffDebtorCount=len(staff_debtors),
            totalPeopleCount=len(all_debtors),
        )

    def get_receivable(self, receivable_id: int) -> Receivable:
        r = self.db.query(Receivable).filter(Receivable.receivable_id == receivable_id).first()
        if not r:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Receivable with ID {receivable_id} not found",
            )
        self.sync_service.attach_lock_flags([r])
        return r

    def create_receivable(
        self,
        data: ReceivableCreate,
        actor_name: Optional[str] = None,
        skip_counterpart_sync: bool = False,
    ) -> Receivable:
        if data.sale_id:
            self.sync_service.assert_sale_not_locked(data.sale_id)

        cid, cname = self._resolve_company_info(data.company_id, data.company_name)

        total = Decimal(str(data.total_amount or 0))
        if total < 0:
            raise HTTPException(status_code=400, detail="Total amount must be greater than or equal to 0")

        amount_paid = Decimal("0.00")
        if data.payment_option == "Paid in full":
            amount_paid = total
        elif data.payment_option == "Partial":
            raw_paid = Decimal(str(data.amount_paid or 0))
            amount_paid = min(total, max(Decimal("0.00"), raw_paid))
        elif data.amount_paid and data.amount_paid > 0:
            amount_paid = min(total, Decimal(str(data.amount_paid)))

        balance = max(Decimal("0.00"), total - amount_paid)
        if balance <= Decimal("0.005") and total > Decimal("0.005"):
            payment_status = "Paid"
        elif amount_paid > Decimal("0.005"):
            payment_status = "Partial"
        else:
            payment_status = "Unpaid"

        customer_type = "Internal" if (data.customer_type or "").strip().lower() in ("internal", "staff") else "External"

        rec = Receivable(
            company_id=cid,
            company_name=cname,
            customer_name=data.customer_name.strip(),
            customer_type=customer_type,
            sale_id=data.sale_id,
            sale_line_index=data.sale_line_index,
            expense_id=data.expense_id,
            transaction_date=data.transaction_date or date.today(),
            items_summary=data.items_summary.strip(),
            total_amount=total,
            amount_paid=amount_paid,
            balance=balance,
            payment_status=payment_status,
            notes=data.notes.strip() if data.notes else None,
        )
        self.db.add(rec)
        self.db.flush()

        if amount_paid > 0:
            pay = ReceivablePayment(
                receivable_id=rec.receivable_id,
                payment_date=rec.transaction_date,
                amount=amount_paid,
                payment_method=data.payment_method or "Cash",
                bank_account_id=data.bank_account_id,
                reference_no=None,
                notes="Initial payment on food order",
                received_by=actor_name,
            )
            self.db.add(pay)

            if data.bank_account_id:
                try:
                    bank_svc = BankService(self.db)
                    bank_svc.record_deposit_by_account_id(
                        account_id=data.bank_account_id,
                        amount=amount_paid,
                        particulars=f"Food Receivable Payment - {rec.customer_name}",
                        tx_date=rec.transaction_date.strftime("%m/%d/%y"),
                    )
                    ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"account_id": data.bank_account_id}})
                except Exception:
                    pass

        if rec.sale_id and amount_paid > Decimal("0.005") and not skip_counterpart_sync:
            self.sync_service.sync_receivable_to_sale(rec, skip_counterpart_sync=skip_counterpart_sync)

        self.db.commit()
        self.db.refresh(rec)
        self.sync_service.attach_lock_flags([rec])

        self.sync_service.broadcast_sync_events(
            company_id=rec.company_id,
            sale_id=rec.sale_id,
            receivable_id=rec.receivable_id,
            action="created",
            emit_sales=bool(rec.sale_id),
            emit_receivables=True,
        )

        return rec

    def record_payment(
        self,
        receivable_id: int,
        payment_data: ReceivablePaymentCreate,
        actor_name: Optional[str] = None,
        skip_counterpart_sync: bool = False,
    ) -> ReceivablePayment:
        rec = self.get_receivable(receivable_id)
        self.sync_service.assert_sale_not_locked(rec.sale_id)

        pay_amount = Decimal(str(payment_data.amount or 0))
        if pay_amount <= 0:
            raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")

        current_balance = Decimal(str(rec.balance or 0))
        if pay_amount > current_balance + Decimal("0.005"):
            raise HTTPException(
                status_code=400,
                detail=f"Payment amount (₱{pay_amount:.2f}) cannot exceed outstanding debt of ₱{current_balance:.2f}",
            )

        pay_date = payment_data.payment_date or date.today()
        payment = ReceivablePayment(
            receivable_id=rec.receivable_id,
            payment_date=pay_date,
            amount=pay_amount,
            payment_method=payment_data.payment_method or "Cash",
            bank_account_id=payment_data.bank_account_id,
            reference_no=payment_data.reference_no,
            notes=payment_data.notes,
            received_by=actor_name or payment_data.received_by,
        )
        self.db.add(payment)

        rec.amount_paid = min(
            Decimal(str(rec.total_amount or 0)),
            Decimal(str(rec.amount_paid or 0)) + pay_amount,
        )
        rec.balance = max(Decimal("0.00"), Decimal(str(rec.total_amount or 0)) - rec.amount_paid)

        if rec.balance <= Decimal("0.005"):
            rec.payment_status = "Paid"
        else:
            rec.payment_status = "Partial"

        if payment_data.bank_account_id:
            try:
                bank_svc = BankService(self.db)
                bank_svc.record_deposit_by_account_id(
                    account_id=payment_data.bank_account_id,
                    amount=pay_amount,
                    particulars=f"Food Receivable Payment - {rec.customer_name}",
                    reference_no=payment_data.reference_no,
                    tx_date=pay_date.strftime("%m/%d/%y"),
                )
                ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"account_id": payment_data.bank_account_id}})
            except Exception:
                pass

        self.sync_service.sync_receivable_to_sale(rec, skip_counterpart_sync=skip_counterpart_sync)

        self.db.commit()
        self.db.refresh(payment)
        self.db.refresh(rec)

        self.sync_service.broadcast_sync_events(
            company_id=rec.company_id,
            sale_id=rec.sale_id,
            receivable_id=rec.receivable_id,
            action="payment_recorded",
        )

        return payment

    def settle_payroll_deduction(
        self,
        customer_name: str,
        company_id: Optional[int] = None,
        company_ids: Optional[List[int]] = None,
        notes: Optional[str] = None,
        actor_name: Optional[str] = None,
        skip_counterpart_sync: bool = False,
    ) -> Dict[str, Any]:
        query = self.db.query(Receivable).filter(
            func.lower(Receivable.customer_name) == customer_name.strip().lower(),
            Receivable.balance > Decimal("0.005"),
        )
        query = self._apply_company_filters(query, company_id=company_id, company_ids=company_ids)

        unpaid_recs = query.all()
        if not unpaid_recs:
            raise HTTPException(
                status_code=400,
                detail=f"No outstanding receivable balance found for staff {customer_name}.",
            )

        locked_ids = self.sync_service.get_locked_sale_ids(r.sale_id for r in unpaid_recs if r.sale_id)
        if any(r.sale_id and int(r.sale_id) in locked_ids for r in unpaid_recs):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot settle payroll deduction because one or more receivable orders belong to a Verified audited sale.",
            )

        total_settled = Decimal("0.00")
        today_date = date.today()
        affected_cid = company_id

        for r in unpaid_recs:
            affected_cid = affected_cid or r.company_id
            outstanding = Decimal(str(r.balance or 0))
            total_settled += outstanding

            pay = ReceivablePayment(
                receivable_id=r.receivable_id,
                payment_date=today_date,
                amount=outstanding,
                payment_method="Payroll Deduction",
                notes=notes or "Settled via semi-monthly payroll deduction",
                received_by=actor_name,
            )
            self.db.add(pay)

            r.amount_paid = Decimal(str(r.total_amount or 0))
            r.balance = Decimal("0.00")
            r.payment_status = "Paid"
            self.sync_service.sync_receivable_to_sale(r, skip_counterpart_sync=skip_counterpart_sync)

        self.db.commit()

        self.sync_service.broadcast_sync_events(
            company_id=affected_cid,
            action="payroll_deducted",
        )

        return {
            "success": True,
            "customer_name": customer_name,
            "total_deducted": float(total_settled),
            "settled_orders_count": len(unpaid_recs),
            "message": f"Successfully settled ₱{total_settled:.2f} via payroll deduction for {customer_name}.",
        }

    def update_receivable(
        self,
        receivable_id: int,
        update_data: ReceivableUpdate,
        actor_name: Optional[str] = None,
        skip_counterpart_sync: bool = False,
    ) -> Receivable:
        rec = self.get_receivable(receivable_id)
        self.sync_service.assert_sale_not_locked(rec.sale_id)

        old_total = Decimal(str(rec.total_amount or 0))
        old_items_summary = rec.items_summary

        if update_data.customer_name is not None:
            rec.customer_name = update_data.customer_name.strip()
        if update_data.customer_type is not None:
            ct = update_data.customer_type.strip().lower()
            rec.customer_type = "Internal" if ct in ("internal", "staff") else "External"
        if update_data.transaction_date is not None:
            rec.transaction_date = update_data.transaction_date
        if update_data.items_summary is not None:
            rec.items_summary = update_data.items_summary.strip()
        if update_data.notes is not None:
            rec.notes = update_data.notes.strip() if update_data.notes else None

        requested_status = update_data.payment_status

        # AC-4: Switching status to Unpaid reverses existing ReceivablePayment rows and linked bank deposits
        if requested_status == "Unpaid":
            for pay in list(rec.payments or []):
                self.sync_service.reverse_payment_bank_deposit(pay, rec.customer_name)
                self.db.delete(pay)
            rec.amount_paid = Decimal("0.00")

        if update_data.total_amount is not None:
            new_total = Decimal(str(update_data.total_amount))
            cur_paid = Decimal(str(rec.amount_paid or 0))
            if new_total < cur_paid - Decimal("0.005"):
                if requested_status == "Paid":
                    # Adjust excess payment down to new_total when editing a Paid order's total
                    excess = cur_paid - new_total
                    for pay in list(rec.payments or []):
                        if excess <= Decimal("0.005"):
                            break
                        p_amt = Decimal(str(pay.amount or 0))
                        reduce_by = min(p_amt, excess)
                        if pay.bank_account_id and reduce_by > Decimal("0.00"):
                            try:
                                BankService(self.db).record_withdrawal_by_account_id(
                                    account_id=pay.bank_account_id,
                                    amount=reduce_by,
                                    particulars=f"Adjustment Reversal of Food Receivable Payment - {rec.customer_name}",
                                    tx_date=date.today().strftime("%m/%d/%y"),
                                )
                                ws_manager.broadcast_sync(
                                    {"type": "BANK_UPDATED", "payload": {"account_id": pay.bank_account_id}}
                                )
                            except Exception:
                                pass
                        if reduce_by >= p_amt - Decimal("0.005"):
                            self.db.delete(pay)
                        else:
                            pay.amount = p_amt - reduce_by
                        excess -= reduce_by
                    rec.amount_paid = new_total
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Total amount cannot be less than already paid amount (₱{cur_paid:.2f})",
                    )
            rec.total_amount = new_total

        # AC-4: Switching status to Paid creates a ReceivablePayment (and optional bank deposit) for remaining balance
        if requested_status == "Paid":
            target_total = Decimal(str(rec.total_amount or 0))
            cur_paid = Decimal(str(rec.amount_paid or 0))
            remaining = max(Decimal("0.00"), target_total - cur_paid)
            if remaining > Decimal("0.005"):
                pay_method = (update_data.payment_method or "Cash").strip() or "Cash"
                pay_date = date.today()
                settlement_pay = ReceivablePayment(
                    receivable_id=rec.receivable_id,
                    payment_date=pay_date,
                    amount=remaining,
                    payment_method=pay_method,
                    bank_account_id=update_data.bank_account_id,
                    notes="Settled via Receivable Order Edit",
                    received_by=actor_name,
                )
                self.db.add(settlement_pay)
                rec.amount_paid = target_total

                if update_data.bank_account_id:
                    try:
                        BankService(self.db).record_deposit_by_account_id(
                            account_id=update_data.bank_account_id,
                            amount=remaining,
                            particulars=f"Food Receivable Payment - {rec.customer_name}",
                            tx_date=pay_date.strftime("%m/%d/%y"),
                        )
                        ws_manager.broadcast_sync(
                            {"type": "BANK_UPDATED", "payload": {"account_id": update_data.bank_account_id}}
                        )
                    except Exception:
                        pass

        # Enforce balance & payment_status invariants
        final_total = Decimal(str(rec.total_amount or 0))
        final_paid = min(final_total, max(Decimal("0.00"), Decimal(str(rec.amount_paid or 0))))
        rec.amount_paid = final_paid
        rec.balance = max(Decimal("0.00"), final_total - final_paid)

        if rec.balance <= Decimal("0.005") and final_total > Decimal("0.005"):
            rec.payment_status = "Paid"
        elif final_paid > Decimal("0.005"):
            rec.payment_status = "Partial"
        else:
            rec.payment_status = "Unpaid"

        self.sync_service.sync_receivable_to_sale(
            rec,
            old_items_summary=old_items_summary,
            old_total_amount=old_total,
            skip_counterpart_sync=skip_counterpart_sync,
        )

        self.db.commit()
        self.db.refresh(rec)
        self.sync_service.attach_lock_flags([rec])

        self.sync_service.broadcast_sync_events(
            company_id=rec.company_id,
            sale_id=rec.sale_id,
            receivable_id=rec.receivable_id,
            action="updated",
        )

        return rec

    def delete_receivable(
        self,
        receivable_id: int,
        actor_name: Optional[str] = None,
        skip_counterpart_sync: bool = False,
    ) -> None:
        rec = self.get_receivable(receivable_id)
        self.sync_service.assert_sale_not_locked(rec.sale_id)

        cid = rec.company_id
        sid = rec.sale_id
        old_summary = rec.items_summary
        old_total = Decimal(str(rec.total_amount or 0))

        for pay in list(rec.payments or []):
            self.sync_service.reverse_payment_bank_deposit(pay, rec.customer_name)

        self.sync_service.sync_receivable_to_sale(
            rec,
            old_items_summary=old_summary,
            old_total_amount=old_total,
            deleted=True,
            skip_counterpart_sync=skip_counterpart_sync,
        )

        self.db.delete(rec)
        self.db.commit()

        self.sync_service.broadcast_sync_events(
            company_id=cid,
            sale_id=sid,
            receivable_id=receivable_id,
            action="deleted",
        )

    def delete_payment(
        self,
        payment_id: int,
        actor_name: Optional[str] = None,
        skip_counterpart_sync: bool = False,
    ) -> None:
        pay = self.db.query(ReceivablePayment).filter(ReceivablePayment.payment_id == payment_id).first()
        if not pay:
            raise HTTPException(status_code=404, detail="Payment record not found")

        rec = self.get_receivable(pay.receivable_id)
        self.sync_service.assert_sale_not_locked(rec.sale_id)

        pay_amount = Decimal(str(pay.amount or 0))
        self.sync_service.reverse_payment_bank_deposit(pay, rec.customer_name)

        rec.amount_paid = max(Decimal("0.00"), Decimal(str(rec.amount_paid or 0)) - pay_amount)
        rec.balance = max(Decimal("0.00"), Decimal(str(rec.total_amount or 0)) - rec.amount_paid)

        if rec.balance <= Decimal("0.005") and Decimal(str(rec.total_amount or 0)) > Decimal("0.005"):
            rec.payment_status = "Paid"
        elif rec.amount_paid > Decimal("0.005"):
            rec.payment_status = "Partial"
        else:
            rec.payment_status = "Unpaid"

        self.db.delete(pay)
        self.sync_service.sync_receivable_to_sale(rec, skip_counterpart_sync=skip_counterpart_sync)
        self.db.commit()

        self.sync_service.broadcast_sync_events(
            company_id=rec.company_id,
            sale_id=rec.sale_id,
            receivable_id=rec.receivable_id,
            action="payment_reversed",
        )

    def update_debtor(
        self,
        data: DebtorBatchUpdate,
        company_ids: Optional[List[int]] = None,
        actor_name: Optional[str] = None,
    ) -> Dict[str, int]:
        target_name = data.current_customer_name.strip()
        if not target_name:
            raise HTTPException(status_code=400, detail="Current customer name is required")

        query = self.db.query(Receivable).filter(
            func.lower(Receivable.customer_name) == target_name.lower()
        )
        query = self._apply_company_filters(
            query,
            company_id=data.company_id,
            company_ids=company_ids,
            company_name=data.company_name,
        )
        rows = query.all()
        if not rows:
            raise HTTPException(status_code=404, detail="Debtor records not found in authorized company scope")

        locked_sale_ids = self.sync_service.get_locked_sale_ids(r.sale_id for r in rows if r.sale_id)
        editable_rows = [r for r in rows if not (r.sale_id and int(r.sale_id) in locked_sale_ids)]

        if not editable_rows:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="All receivable records for this debtor are linked to Verified audited sales and are locked.",
            )

        new_name = data.new_customer_name.strip() if data.new_customer_name else None
        new_type = data.customer_type

        affected_cid = data.company_id or editable_rows[0].company_id
        for r in editable_rows:
            if new_name:
                r.customer_name = new_name
            if new_type:
                r.customer_type = new_type

        self.db.commit()
        self.sync_service.broadcast_sync_events(
            company_id=affected_cid,
            action="debtor_updated",
        )
        return {"updated_count": len(editable_rows)}

    def delete_debtor(
        self,
        customer_name: str,
        company_id: Optional[int] = None,
        company_name: Optional[str] = None,
        company_ids: Optional[List[int]] = None,
        actor_name: Optional[str] = None,
    ) -> Dict[str, int]:
        target_name = (customer_name or "").strip()
        if not target_name:
            raise HTTPException(status_code=400, detail="Customer name is required")

        query = self.db.query(Receivable).filter(
            func.lower(Receivable.customer_name) == target_name.lower()
        )
        query = self._apply_company_filters(
            query,
            company_id=company_id,
            company_ids=company_ids,
            company_name=company_name,
        )
        rows = query.all()
        if not rows:
            raise HTTPException(status_code=404, detail="Debtor records not found in authorized company scope")

        locked_sale_ids = self.sync_service.get_locked_sale_ids(r.sale_id for r in rows if r.sale_id)
        if any(r.sale_id and int(r.sale_id) in locked_sale_ids for r in rows):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot delete debtor because one or more receivable orders belong to a Verified audited sale.",
            )

        affected_cid = company_id or rows[0].company_id
        deleted_count = 0
        for r in rows:
            old_summary = r.items_summary
            old_total = Decimal(str(r.total_amount or 0))
            for pay in list(r.payments or []):
                self.sync_service.reverse_payment_bank_deposit(pay, r.customer_name)
            self.sync_service.sync_receivable_to_sale(
                r,
                old_items_summary=old_summary,
                old_total_amount=old_total,
                deleted=True,
            )
            self.db.delete(r)
            deleted_count += 1

        self.db.commit()
        self.sync_service.broadcast_sync_events(
            company_id=affected_cid,
            action="debtor_deleted",
        )
        return {"deleted_count": deleted_count}

    def seed_initial_receivables_if_empty(self) -> None:
        try:
            if self.db.query(Receivable).count() > 0:
                return
        except Exception:
            return

        initial_seeds = [
            {
                "company": "MyCity.Kitchen Corporation",
                "date": "2026-11-02",
                "customer_name": "Maria Santos",
                "customer_type": "Internal",
                "items_summary": "Pork Sisig Rice Meal (x2), Mountain Dew (x2)",
                "total_amount": Decimal("380.00"),
                "amount_paid": Decimal("0.00"),
                "balance": Decimal("380.00"),
                "payment_status": "Unpaid",
                "notes": "Dinner after afternoon kitchen shift",
                "payments": [],
            },
            {
                "company": "MyCity.Kitchen Corporation",
                "date": "2026-11-02",
                "customer_name": "Mang Jose Mercado",
                "customer_type": "External",
                "items_summary": "Crispy Pata Regular, Sinigang na Baboy, Plain Rice (x3)",
                "total_amount": Decimal("1450.00"),
                "amount_paid": Decimal("500.00"),
                "balance": Decimal("950.00"),
                "payment_status": "Partial",
                "notes": "Down payment given via Cash; balance tomorrow",
                "payments": [
                    {
                        "amount": Decimal("500.00"),
                        "date": "2026-11-02",
                        "method": "Cash",
                        "notes": "Initial cash down payment on dine-in bill",
                    }
                ],
            },
            {
                "company": "MyCity.Kitchen Corporation",
                "date": "2026-11-01",
                "customer_name": "Juan Dela Cruz",
                "customer_type": "Internal",
                "items_summary": "Beef Pares Mami with Egg, Garlic Rice",
                "total_amount": Decimal("220.00"),
                "amount_paid": Decimal("220.00"),
                "balance": Decimal("0.00"),
                "payment_status": "Paid",
                "notes": "Paid cash at counter",
                "payments": [
                    {
                        "amount": Decimal("220.00"),
                        "date": "2026-11-01",
                        "method": "Cash",
                        "notes": "Paid in full upon pickup",
                    }
                ],
            },
            {
                "company": "MCTolentino Hospitality Business Corporation",
                "date": "2026-10-31",
                "customer_name": "Arlene Ramos",
                "customer_type": "Internal",
                "items_summary": "Chicken Inasal Platter, Extra Rice, Iced Tea",
                "total_amount": Decimal("290.00"),
                "amount_paid": Decimal("100.00"),
                "balance": Decimal("190.00"),
                "payment_status": "Partial",
                "notes": "Paid ₱100 via GCash, remaining ₱190 on payday",
                "payments": [
                    {
                        "amount": Decimal("100.00"),
                        "date": "2026-10-31",
                        "method": "GCash",
                        "notes": "GCash ref #82910",
                    }
                ],
            },
            {
                "company": "MyCity.Kitchen Corporation",
                "date": "2026-10-29",
                "customer_name": "Eduardo \"Ed\" Lim",
                "customer_type": "External",
                "items_summary": "Breakfast Tapsilog (x3), Hot Brewed Coffee (x3)",
                "total_amount": Decimal("570.00"),
                "amount_paid": Decimal("0.00"),
                "balance": Decimal("570.00"),
                "payment_status": "Unpaid",
                "notes": "Driver team breakfast, to settle on weekly payout",
                "payments": [],
            },
            {
                "company": "MCTolentino Hospitality Business Corporation",
                "date": "2026-10-27",
                "customer_name": "Michael Tan",
                "customer_type": "Internal",
                "items_summary": "Lechon Kawali Special, Coke (x2)",
                "total_amount": Decimal("310.00"),
                "amount_paid": Decimal("0.00"),
                "balance": Decimal("310.00"),
                "payment_status": "Unpaid",
                "notes": "Staff meal on credit",
                "payments": [],
            },
            {
                "company": "JK Global Headways Inc.",
                "date": "2026-10-24",
                "customer_name": "Corazon \"Cora\" Aquino",
                "customer_type": "External",
                "items_summary": "Pancit Bihon Party Tray, Lumpiang Shanghai (x20)",
                "total_amount": Decimal("2200.00"),
                "amount_paid": Decimal("1000.00"),
                "balance": Decimal("1200.00"),
                "payment_status": "Partial",
                "notes": "Meeting snack package; bank transfer deposit received",
                "payments": [
                    {
                        "amount": Decimal("1000.00"),
                        "date": "2026-10-25",
                        "method": "Bank Transfer",
                        "notes": "BDO online transfer ref #BDO-9812",
                    }
                ],
            },
            {
                "company": "MyCity.Kitchen Corporation",
                "date": "2026-10-21",
                "customer_name": "Grace Bautista",
                "customer_type": "Internal",
                "items_summary": "Burger Steak Meal, Halo-Halo Special",
                "total_amount": Decimal("260.00"),
                "amount_paid": Decimal("260.00"),
                "balance": Decimal("0.00"),
                "payment_status": "Paid",
                "notes": "Settled via GCash",
                "payments": [
                    {
                        "amount": Decimal("260.00"),
                        "date": "2026-10-21",
                        "method": "GCash",
                        "notes": "Paid immediately via GCash",
                    }
                ],
            },
            {
                "company": "JK Global Headways Inc.",
                "date": "2026-10-18",
                "customer_name": "Capt. Rodolfo Reyes",
                "customer_type": "External",
                "items_summary": "Beef Caldereta Feast, Pork BBQ Skewers (x15), Rice (x10)",
                "total_amount": Decimal("3400.00"),
                "amount_paid": Decimal("1500.00"),
                "balance": Decimal("1900.00"),
                "payment_status": "Partial",
                "notes": "Barangay tanod dinner. Partial cash provided by treasurer.",
                "payments": [
                    {
                        "amount": Decimal("1500.00"),
                        "date": "2026-10-19",
                        "method": "Cash",
                        "notes": "Cash voucher remittance",
                    }
                ],
            },
            {
                "company": "MyCity.Kitchen Corporation",
                "date": "2026-10-15",
                "customer_name": "Elena Gomez",
                "customer_type": "External",
                "items_summary": "Kare-Kare Special, Rice (x2), Sago't Gulaman",
                "total_amount": Decimal("480.00"),
                "amount_paid": Decimal("0.00"),
                "balance": Decimal("480.00"),
                "payment_status": "Unpaid",
                "notes": "Listahan ni Aling Elena; to pay Friday",
                "payments": [],
            },
        ]

        for s in initial_seeds:
            cid, cname = self._resolve_company_info(None, s["company"])
            rec = Receivable(
                company_id=cid,
                company_name=cname,
                customer_name=s["customer_name"],
                customer_type=s["customer_type"],
                transaction_date=date.fromisoformat(s["date"]),
                items_summary=s["items_summary"],
                total_amount=s["total_amount"],
                amount_paid=s["amount_paid"],
                balance=s["balance"],
                payment_status=s["payment_status"],
                notes=s["notes"],
            )
            self.db.add(rec)
            self.db.flush()

            for p in s["payments"]:
                pay = ReceivablePayment(
                    receivable_id=rec.receivable_id,
                    payment_date=date.fromisoformat(p["date"]),
                    amount=p["amount"],
                    payment_method=p["method"],
                    notes=p["notes"],
                )
                self.db.add(pay)

        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
