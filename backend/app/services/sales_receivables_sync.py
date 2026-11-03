from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.websocket import ws_manager
from app.models.finance import Expense, Sale
from app.models.receivable import Receivable, ReceivablePayment
from app.services.bank_service import BankService

logger = logging.getLogger(__name__)

_STATUS_TAG_RE = re.compile(r"\s*\[(Paid|Unpaid|Pending|On hold)\]\s*$", re.IGNORECASE)
_DETAIL_LINE_RE = re.compile(
    r"^(.+?)\s*\(\s*(?:(\d+(?:\.\d+)?)\s*x)?\s*"
    r"(?:@\s*(?:₱|PHP|Php)?\s*([\d,]+(?:\.\d+)?))?"
    r"(?:\s*=\s*(?:₱|PHP|Php)?\s*([\d,]+(?:\.\d+)?))?\s*\)$"
)
_SUMMARY_QTY_SUFFIX_RE = re.compile(r"\s*\((?:x\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*x.*)\)\s*$", re.IGNORECASE)


def _to_decimal(val: Any, default: Decimal = Decimal("0.00")) -> Decimal:
    if val is None:
        return default
    if isinstance(val, Decimal):
        return val
    try:
        cleaned = str(val).replace(",", "").strip()
        return Decimal(cleaned) if cleaned else default
    except (InvalidOperation, ValueError):
        return default


def _normalize_status_tag(raw_tag: Optional[str], fallback: str = "Paid") -> str:
    if not raw_tag:
        return fallback
    low = raw_tag.strip().lower()
    if low in ("paid", "settled"):
        return "Paid"
    if low in ("pending", "on hold", "partial"):
        return "Pending"
    if low in ("unpaid", "overdue"):
        return "Unpaid"
    return fallback


def _normalize_item_name(text: Optional[str]) -> str:
    if not text:
        return ""
    s = _STATUS_TAG_RE.sub("", text.strip())
    m = _DETAIL_LINE_RE.match(s)
    if m:
        s = m.group(1)
    s = _SUMMARY_QTY_SUFFIX_RE.sub("", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def _extract_name_and_qty_from_summary(summary: str) -> Tuple[str, Optional[Decimal]]:
    cleaned = _STATUS_TAG_RE.sub("", summary.strip())
    det = _DETAIL_LINE_RE.match(cleaned)
    if det:
        name = det.group(1).strip()
        qty = _to_decimal(det.group(2), Decimal("1")) if det.group(2) else None
        return name, qty
    m = _SUMMARY_QTY_SUFFIX_RE.search(cleaned)
    if m:
        qty_raw = m.group(1) or m.group(2)
        name = cleaned[: m.start()].strip()
        return (name or cleaned), (_to_decimal(qty_raw, Decimal("1")) if qty_raw else None)
    return cleaned, None


@dataclass
class ParsedSaleLine:
    name: str
    qty: Decimal
    unit_price: Decimal
    total: Decimal
    status: str  # 'Paid' | 'Pending' | 'Unpaid'
    had_parentheses: bool = False
    had_status_tag: bool = True

    def format_line(self, is_single: bool) -> str:
        clean_name = self.name.strip()
        status_suffix = f" [{self.status}]" if self.status else ""
        if is_single and self.qty == Decimal("1") and not self.had_parentheses:
            return f"{clean_name}{status_suffix}"

        qty_val = self.qty if self.qty > 0 else Decimal("1")
        if qty_val == qty_val.to_integral_value():
            qty_str = str(int(qty_val))
        else:
            qty_str = format(qty_val.normalize(), "f")

        total_val = self.total if self.total >= 0 else Decimal("0.00")
        price_val = self.unit_price if self.unit_price > 0 else (
            (total_val / qty_val).quantize(Decimal("0.01")) if qty_val > 0 and total_val > 0 else Decimal("0.00")
        )

        if price_val > 0:
            return f"{clean_name} ({qty_str}x @ ₱{price_val:,.2f} = ₱{total_val:,.2f}){status_suffix}"
        return f"{clean_name} ({qty_str}x){status_suffix}"


def parse_sale_lines(raw_particulars: Optional[str], fallback_total: Any = Decimal("0.00")) -> List[ParsedSaleLine]:
    amt = _to_decimal(fallback_total, Decimal("0.00"))
    if not raw_particulars or not raw_particulars.strip():
        return []

    raw_lines = [ln.strip() for ln in raw_particulars.strip().splitlines() if ln.strip()]
    parsed: List[ParsedSaleLine] = []

    for ln in raw_lines:
        had_tag = False
        line_status = "Paid"
        tag_match = _STATUS_TAG_RE.search(ln)
        cleaned = ln
        if tag_match:
            had_tag = True
            line_status = _normalize_status_tag(tag_match.group(1), "Paid")
            cleaned = ln[: tag_match.start()].strip()

        det_match = _DETAIL_LINE_RE.match(cleaned)
        if det_match:
            name = det_match.group(1).strip()
            qty = _to_decimal(det_match.group(2), Decimal("1")) if det_match.group(2) else Decimal("1")
            if qty <= 0:
                qty = Decimal("1")
            unit_price = _to_decimal(det_match.group(3), Decimal("0.00")) if det_match.group(3) else Decimal("0.00")
            total = _to_decimal(det_match.group(4), Decimal("0.00")) if det_match.group(4) else (qty * unit_price)
            if total <= 0 and unit_price > 0:
                total = (qty * unit_price).quantize(Decimal("0.01"))
            parsed.append(
                ParsedSaleLine(
                    name=name,
                    qty=qty,
                    unit_price=unit_price,
                    total=total,
                    status=line_status,
                    had_parentheses=True,
                    had_status_tag=had_tag,
                )
            )
        else:
            parsed.append(
                ParsedSaleLine(
                    name=cleaned,
                    qty=Decimal("1"),
                    unit_price=Decimal("0.00"),
                    total=Decimal("0.00"),
                    status=line_status,
                    had_parentheses=False,
                    had_status_tag=had_tag,
                )
            )

    if len(parsed) == 1 and parsed[0].total <= Decimal("0.00") and amt > Decimal("0.00"):
        qty = parsed[0].qty if parsed[0].qty > 0 else Decimal("1")
        parsed[0].total = amt
        parsed[0].unit_price = (amt / qty).quantize(Decimal("0.01"))

    return parsed


def format_sale_lines(lines: List[ParsedSaleLine]) -> str:
    if not lines:
        return ""
    is_single = len(lines) == 1
    return "\n".join(ln.format_line(is_single=is_single) for ln in lines)


def compute_paid_amount_from_particulars(raw_particulars: Optional[str], fallback_total: Any) -> Decimal:
    total_dec = _to_decimal(fallback_total, Decimal("0.00"))
    lines = parse_sale_lines(raw_particulars, total_dec)
    if not lines:
        return total_dec
    return sum((ln.total for ln in lines if ln.status == "Paid"), Decimal("0.00"))


class SalesReceivablesSyncService:
    """
    Internal domain sync service keeping `sales` (Supabase + SQLite) and `receivables`
    reconciled without HTTP loopback webhooks or recursive sync loops.
    """

    def __init__(self, db: Session):
        self.db = db

    def _use_supabase(self) -> bool:
        try:
            bind = self.db.get_bind()
            if bind is not None and bind.dialect.name == "sqlite":
                db_name = bind.url.database
                if not db_name or db_name == ":memory:":
                    return False
        except Exception:
            pass
        return True

    def _get_supabase_client(self):
        if not self._use_supabase():
            return None
        try:
            from app.db.supabase import get_supabase_admin_client
            return get_supabase_admin_client()
        except Exception:
            return None

    def get_locked_sale_ids(self, sale_ids: Iterable[Optional[int]]) -> Set[int]:
        clean_ids = sorted({int(sid) for sid in sale_ids if sid is not None})
        if not clean_ids:
            return set()

        locked: Set[int] = set()
        try:
            local_rows = (
                self.db.query(Sale.sales_id, Sale.audit_status)
                .filter(Sale.sales_id.in_(clean_ids))
                .all()
            )
            for sid, a_status in local_rows:
                if (a_status or "").strip().lower() == "verified":
                    locked.add(int(sid))
        except Exception:
            pass

        client = self._get_supabase_client()
        if client is not None:
            try:
                res = (
                    client.table("sales")
                    .select("sales_id, audit_status")
                    .in_("sales_id", clean_ids)
                    .execute()
                )
                for row in res.data or []:
                    if (row.get("audit_status") or "").strip().lower() == "verified":
                        locked.add(int(row["sales_id"]))
            except Exception:
                pass

        return locked

    def is_sale_locked(self, sale_id: Optional[int]) -> bool:
        if not sale_id:
            return False
        return int(sale_id) in self.get_locked_sale_ids([sale_id])

    def assert_sale_not_locked(self, sale_id: Optional[int]) -> None:
        if self.is_sale_locked(sale_id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This record is locked and read-only because its linked sale has been Verified by an Auditor.",
            )

    def attach_lock_flags(self, receivables: Iterable[Receivable]) -> List[Receivable]:
        rec_list = list(receivables)
        locked_ids = self.get_locked_sale_ids(r.sale_id for r in rec_list if r.sale_id)
        for r in rec_list:
            setattr(r, "is_locked", bool(r.sale_id and int(r.sale_id) in locked_ids))
        return rec_list

    @staticmethod
    def map_receivable_to_sale_tag(payment_status: Optional[str], amount_paid: Decimal, balance: Decimal) -> str:
        ps = (payment_status or "").strip().lower()
        if balance <= Decimal("0.005") and (amount_paid > Decimal("0.005") or ps == "paid"):
            return "Paid"
        if amount_paid > Decimal("0.005") or ps == "partial":
            return "Pending"
        return "Unpaid"

    def broadcast_sync_events(
        self,
        *,
        company_id: Optional[int] = None,
        sale_id: Optional[int] = None,
        receivable_id: Optional[int] = None,
        action: str = "synced",
        emit_sales: bool = True,
        emit_receivables: bool = True,
    ) -> None:
        payload = {
            "company_id": company_id,
            "sale_id": sale_id,
            "receivable_id": receivable_id,
            "action": action,
        }
        if emit_receivables:
            ws_manager.broadcast_sync(
                {
                    "type": "RECEIVABLES_UPDATED",
                    "company_id": company_id,
                    "payload": payload,
                }
            )
        if emit_sales:
            ws_manager.broadcast_sync(
                {
                    "type": "SALES_UPDATED",
                    "company_id": company_id,
                    "payload": payload,
                }
            )

    def reverse_payment_bank_deposit(self, pay: ReceivablePayment, customer_name: str) -> None:
        if not pay.bank_account_id:
            return
        pay_amount = _to_decimal(pay.amount, Decimal("0.00"))
        if pay_amount <= Decimal("0.00"):
            return
        try:
            bank_svc = BankService(self.db)
            bank_svc.record_withdrawal_by_account_id(
                account_id=pay.bank_account_id,
                amount=pay_amount,
                particulars=f"Reversal of Food Receivable Payment - {customer_name}",
                tx_date=date.today().strftime("%m/%d/%y"),
            )
            ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"account_id": pay.bank_account_id}})
        except Exception as exc:
            logger.warning("Bank withdrawal reversal skipped for account %s: %s", pay.bank_account_id, exc)

    def _fetch_authoritative_sale(self, sale_id: int) -> Tuple[Optional[Dict[str, Any]], Optional[Sale]]:
        local_sale = self.db.query(Sale).filter(Sale.sales_id == sale_id).first()
        sb_row: Optional[Dict[str, Any]] = None
        client = self._get_supabase_client()
        if client is not None:
            try:
                res = client.table("sales").select("*").eq("sales_id", sale_id).limit(1).execute()
                if res.data:
                    sb_row = res.data[0]
            except Exception as exc:
                logger.warning("Supabase fetch for sale %s failed during sync: %s", sale_id, exc)
        return sb_row, local_sale

    def _match_line_index(
        self,
        lines: List[ParsedSaleLine],
        sale_line_index: Optional[int],
        target_summary: Optional[str],
        target_amount: Optional[Decimal],
    ) -> Optional[int]:
        if not lines:
            return None
        if sale_line_index is not None and 0 <= sale_line_index < len(lines):
            return sale_line_index
        if len(lines) == 1:
            return 0

        norm_target = _normalize_item_name(target_summary)
        amt = _to_decimal(target_amount, Decimal("-1"))

        if norm_target:
            exact_both = [
                idx
                for idx, ln in enumerate(lines)
                if _normalize_item_name(ln.name) == norm_target
                and amt >= 0
                and abs(ln.total - amt) <= Decimal("0.05")
            ]
            if exact_both:
                return exact_both[0]

            name_matches = [
                idx
                for idx, ln in enumerate(lines)
                if _normalize_item_name(ln.name) == norm_target
                or norm_target in _normalize_item_name(ln.name)
                or _normalize_item_name(ln.name) in norm_target
            ]
            if name_matches:
                return name_matches[0]

        if amt >= 0:
            amt_matches = [idx for idx, ln in enumerate(lines) if abs(ln.total - amt) <= Decimal("0.05")]
            if amt_matches:
                return amt_matches[0]

        return None

    def sync_receivable_to_sale(
        self,
        rec: Receivable,
        *,
        old_items_summary: Optional[str] = None,
        old_total_amount: Optional[Decimal] = None,
        deleted: bool = False,
        skip_counterpart_sync: bool = False,
        emit_ws: bool = False,
    ) -> None:
        if skip_counterpart_sync:
            return

        new_rec_total = _to_decimal(rec.total_amount, Decimal("0.00"))
        prior_total = _to_decimal(old_total_amount, new_rec_total) if old_total_amount is not None else new_rec_total

        if rec.expense_id:
            exp = self.db.query(Expense).filter(Expense.expense_id == rec.expense_id).first()
            if exp:
                if deleted:
                    rem_exp = max(Decimal("0.00"), _to_decimal(exp.amount) - prior_total)
                    if rem_exp <= Decimal("0.005"):
                        self.db.delete(exp)
                    else:
                        exp.amount = rem_exp
                elif old_total_amount is not None:
                    diff = new_rec_total - prior_total
                    if diff != Decimal("0.00"):
                        exp.amount = max(Decimal("0.00"), _to_decimal(exp.amount) + diff)

        if not rec.sale_id:
            return

        sale_id = int(rec.sale_id)
        sb_row, local_sale = self._fetch_authoritative_sale(sale_id)
        if sb_row is None and local_sale is None:
            return

        audit_status = (
            (sb_row.get("audit_status") if sb_row else None)
            or (local_sale.audit_status if local_sale else None)
            or ""
        )
        if audit_status.strip().lower() == "verified":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This record is locked and read-only because its linked sale has been Verified by an Auditor.",
            )

        raw_particulars = (
            (sb_row.get("particulars") if sb_row else None)
            if sb_row is not None and sb_row.get("particulars") is not None
            else (local_sale.particulars if local_sale else "")
        ) or ""
        current_sale_amount = _to_decimal(
            sb_row.get("amount") if sb_row is not None and sb_row.get("amount") is not None else (local_sale.amount if local_sale else 0)
        )

        lines = parse_sale_lines(raw_particulars, current_sale_amount)
        idx = self._match_line_index(
            lines,
            rec.sale_line_index,
            old_items_summary or rec.items_summary,
            prior_total,
        )

        client = self._get_supabase_client()

        if deleted:
            if idx is not None and 0 <= idx < len(lines):
                lines.pop(idx)

            if lines:
                line_sum = sum((ln.total for ln in lines), Decimal("0.00"))
                remaining_amount = (
                    line_sum
                    if all(ln.total > Decimal("0.00") for ln in lines)
                    else max(Decimal("0.00"), current_sale_amount - prior_total)
                )
            else:
                remaining_amount = Decimal("0.00")

            if not lines or remaining_amount <= Decimal("0.005"):
                rec.sale_id = None
                if client is not None:
                    try:
                        client.table("sales").delete().eq("sales_id", sale_id).execute()
                    except Exception as exc:
                        logger.warning("Failed deleting parent sale %s in Supabase: %s", sale_id, exc)
                if local_sale is not None:
                    self.db.delete(local_sale)
            else:
                new_particulars = format_sale_lines(lines)
                if client is not None:
                    try:
                        client.table("sales").update(
                            {"particulars": new_particulars, "amount": float(remaining_amount)}
                        ).eq("sales_id", sale_id).execute()
                    except Exception as exc:
                        logger.warning("Failed updating parent sale %s in Supabase on delete: %s", sale_id, exc)
                if local_sale is not None:
                    local_sale.particulars = new_particulars
                    local_sale.amount = remaining_amount

                if idx is not None:
                    siblings = (
                        self.db.query(Receivable)
                        .filter(Receivable.sale_id == sale_id, Receivable.receivable_id != rec.receivable_id)
                        .all()
                    )
                    for sib in siblings:
                        if sib.sale_line_index is not None and sib.sale_line_index > idx:
                            sib.sale_line_index = sib.sale_line_index - 1
        else:
            new_tag = self.map_receivable_to_sale_tag(
                rec.payment_status,
                _to_decimal(rec.amount_paid),
                _to_decimal(rec.balance),
            )

            if idx is not None and 0 <= idx < len(lines):
                if rec.sale_line_index is None:
                    rec.sale_line_index = idx

                target_line = lines[idx]
                target_line.status = new_tag

                if old_items_summary is not None and rec.items_summary.strip() != old_items_summary.strip():
                    clean_name, parsed_qty = _extract_name_and_qty_from_summary(rec.items_summary)
                    target_line.name = clean_name
                    if parsed_qty is not None and parsed_qty > 0:
                        target_line.qty = parsed_qty
                        target_line.had_parentheses = True

                target_line.total = new_rec_total
                qty_for_price = target_line.qty if target_line.qty > 0 else Decimal("1")
                target_line.unit_price = (new_rec_total / qty_for_price).quantize(Decimal("0.01"))
                if len(lines) > 1 or qty_for_price != Decimal("1"):
                    target_line.had_parentheses = True

                if len(lines) == 1:
                    new_sale_amount = new_rec_total
                elif all(ln.total > Decimal("0.00") for ln in lines):
                    new_sale_amount = sum((ln.total for ln in lines), Decimal("0.00"))
                else:
                    new_sale_amount = max(Decimal("0.00"), current_sale_amount + (new_rec_total - prior_total))

                new_particulars = format_sale_lines(lines)
            else:
                new_particulars = f"{rec.items_summary.strip()} [{new_tag}]" if not raw_particulars else raw_particulars
                new_sale_amount = max(Decimal("0.00"), current_sale_amount + (new_rec_total - prior_total))

            sb_payload: Dict[str, Any] = {
                "particulars": new_particulars,
                "amount": float(new_sale_amount),
            }
            if len(lines) <= 1 and rec.transaction_date:
                sb_payload["transaction_date"] = rec.transaction_date.isoformat()

            if client is not None:
                try:
                    client.table("sales").update(sb_payload).eq("sales_id", sale_id).execute()
                except Exception as exc:
                    logger.warning("Failed updating sale %s in Supabase during receivable sync: %s", sale_id, exc)

            if local_sale is not None:
                local_sale.particulars = new_particulars
                local_sale.amount = new_sale_amount
                if len(lines) <= 1 and rec.transaction_date:
                    local_sale.transaction_date = rec.transaction_date
            elif sb_row is not None:
                try:
                    tx_d = rec.transaction_date or date.fromisoformat(str(sb_row.get("transaction_date"))[:10])
                    merged_sale = Sale(
                        sales_id=sale_id,
                        company_id=sb_row.get("company_id") or rec.company_id,
                        category_id=sb_row.get("category_id"),
                        payment_method=sb_row.get("payment_method"),
                        transaction_date=tx_d,
                        cheque_no=sb_row.get("cheque_number") or sb_row.get("cheque_no"),
                        amount=new_sale_amount,
                        particulars=new_particulars,
                        audit_status=sb_row.get("audit_status") or "Pending Audit",
                    )
                    self.db.merge(merged_sale)
                except Exception:
                    pass

        if emit_ws:
            self.broadcast_sync_events(
                company_id=rec.company_id,
                sale_id=sale_id,
                receivable_id=rec.receivable_id,
                action="deleted" if deleted else "synced",
            )

    def sync_sale_deleted_to_receivables(
        self,
        sales_id: int,
        *,
        company_id: Optional[int] = None,
        skip_counterpart_sync: bool = False,
    ) -> int:
        if skip_counterpart_sync:
            return 0

        linked = self.db.query(Receivable).filter(Receivable.sale_id == sales_id).all()
        deleted_count = 0
        resolved_cid = company_id
        for rec in linked:
            resolved_cid = resolved_cid or rec.company_id
            for pay in list(rec.payments or []):
                self.reverse_payment_bank_deposit(pay, rec.customer_name)
            self.db.delete(rec)
            deleted_count += 1

        if deleted_count > 0:
            self.db.commit()

        self.broadcast_sync_events(
            company_id=resolved_cid,
            sale_id=sales_id,
            action="sale_deleted",
            emit_sales=True,
            emit_receivables=True,
        )
        return deleted_count

    def sync_sale_updated_to_receivables(
        self,
        sales_id: int,
        *,
        new_particulars: str,
        new_amount: Any,
        new_tx_date: Optional[date] = None,
        new_payment_method: Optional[str] = None,
        old_particulars: Optional[str] = None,
        old_amount: Any = None,
        company_id: Optional[int] = None,
        actor_name: Optional[str] = None,
        skip_counterpart_sync: bool = False,
    ) -> None:
        if skip_counterpart_sync:
            return

        linked = (
            self.db.query(Receivable)
            .filter(Receivable.sale_id == sales_id)
            .order_by(Receivable.sale_line_index.asc(), Receivable.receivable_id.asc())
            .all()
        )

        if not linked:
            self.broadcast_sync_events(
                company_id=company_id,
                sale_id=sales_id,
                action="sale_updated",
                emit_sales=True,
                emit_receivables=False,
            )
            return

        new_amt_dec = _to_decimal(new_amount, Decimal("0.00"))
        old_amt_dec = _to_decimal(old_amount, new_amt_dec) if old_amount is not None else new_amt_dec

        new_lines = parse_sale_lines(new_particulars, new_amt_dec)
        old_lines = parse_sale_lines(old_particulars, old_amt_dec) if old_particulars else []

        used_indices: Set[int] = set()
        assignments: Dict[int, Optional[int]] = {}

        # Pass 1: preserve exact sale_line_index when line count is unchanged or name matches
        for rec in linked:
            idx = rec.sale_line_index
            if idx is not None and 0 <= idx < len(new_lines) and idx not in used_indices:
                if not old_lines or len(new_lines) == len(old_lines) or (
                    _normalize_item_name(new_lines[idx].name) == _normalize_item_name(rec.items_summary)
                ):
                    assignments[rec.receivable_id] = idx
                    used_indices.add(idx)

        # Pass 2: match remaining receivables by normalized item name / amount
        for rec in linked:
            if rec.receivable_id in assignments:
                continue
            if len(linked) == 1 and len(new_lines) == 1 and 0 not in used_indices:
                assignments[rec.receivable_id] = 0
                used_indices.add(0)
                continue

            norm_rec = _normalize_item_name(rec.items_summary)
            rec_amt = _to_decimal(rec.total_amount)
            best_idx: Optional[int] = None

            for idx, ln in enumerate(new_lines):
                if idx in used_indices:
                    continue
                norm_ln = _normalize_item_name(ln.name)
                if norm_rec and (norm_ln == norm_rec or norm_rec in norm_ln or norm_ln in norm_rec):
                    best_idx = idx
                    break

            if best_idx is None:
                for idx, ln in enumerate(new_lines):
                    if idx in used_indices:
                        continue
                    if abs(ln.total - rec_amt) <= Decimal("0.05"):
                        best_idx = idx
                        break

            assignments[rec.receivable_id] = best_idx
            if best_idx is not None:
                used_indices.add(best_idx)

        particulars_rewritten = False
        resolved_cid = company_id

        for rec in linked:
            resolved_cid = resolved_cid or rec.company_id
            matched_idx = assignments.get(rec.receivable_id)

            if matched_idx is None or matched_idx >= len(new_lines):
                # Line removed from sale -> cascade delete receivable and reverse bank deposits
                for pay in list(rec.payments or []):
                    self.reverse_payment_bank_deposit(pay, rec.customer_name)
                self.db.delete(rec)
                continue

            line = new_lines[matched_idx]
            old_line_status: Optional[str] = None
            if rec.sale_line_index is not None and 0 <= rec.sale_line_index < len(old_lines):
                old_line_status = old_lines[rec.sale_line_index].status

            rec.sale_line_index = matched_idx
            if new_tx_date is not None:
                rec.transaction_date = new_tx_date

            if line.qty != Decimal("1"):
                qty_label = int(line.qty) if line.qty == line.qty.to_integral_value() else line.qty.normalize()
                rec.items_summary = f"{line.name} (x{qty_label})"
            else:
                rec.items_summary = line.name

            line_total = line.total if line.total > Decimal("0.00") else (
                new_amt_dec if len(new_lines) == 1 else _to_decimal(rec.total_amount)
            )
            rec.total_amount = line_total

            cur_paid = _to_decimal(rec.amount_paid, Decimal("0.00"))

            # 1. If edited total dropped below amount_paid, reverse or cap excess payments
            if line_total < cur_paid - Decimal("0.005"):
                excess = cur_paid - line_total
                for pay in list(rec.payments or []):
                    if excess <= Decimal("0.005"):
                        break
                    p_amt = _to_decimal(pay.amount)
                    reduce_by = min(p_amt, excess)
                    if pay.bank_account_id and reduce_by > Decimal("0.00"):
                        try:
                            BankService(self.db).record_withdrawal_by_account_id(
                                account_id=pay.bank_account_id,
                                amount=reduce_by,
                                particulars=f"Adjustment Reversal on Receivable - {rec.customer_name}",
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
                cur_paid = line_total

            # 2. Reconcile status transitions from Sale line tag
            if line.status == "Paid" and cur_paid < line_total - Decimal("0.005"):
                rem = line_total - cur_paid
                auto_pay = ReceivablePayment(
                    receivable_id=rec.receivable_id,
                    payment_date=date.today(),
                    amount=rem,
                    payment_method=new_payment_method or "Cash",
                    notes="Auto-settled from Sales Record update",
                    received_by=actor_name,
                )
                self.db.add(auto_pay)
                cur_paid = line_total
            elif (
                line.status == "Unpaid"
                and old_line_status in ("Paid", "Pending")
                and cur_paid > Decimal("0.005")
            ):
                for pay in list(rec.payments or []):
                    self.reverse_payment_bank_deposit(pay, rec.customer_name)
                    self.db.delete(pay)
                cur_paid = Decimal("0.00")

            # 3. Recompute receivable balance & payment_status invariants
            rec.amount_paid = cur_paid
            rec.balance = max(Decimal("0.00"), line_total - cur_paid)
            if rec.balance <= Decimal("0.005") and line_total > Decimal("0.005"):
                rec.payment_status = "Paid"
                expected_tag = "Paid"
            elif cur_paid > Decimal("0.005"):
                rec.payment_status = "Partial"
                expected_tag = "Pending"
            else:
                rec.payment_status = "Unpaid"
                expected_tag = "Unpaid"

            if line.status != expected_tag:
                line.status = expected_tag
                particulars_rewritten = True

        self.db.commit()

        if particulars_rewritten and new_lines:
            normalized_particulars = format_sale_lines(new_lines)
            client = self._get_supabase_client()
            if client is not None:
                try:
                    client.table("sales").update({"particulars": normalized_particulars}).eq(
                        "sales_id", sales_id
                    ).execute()
                except Exception:
                    pass
            local_sale = self.db.query(Sale).filter(Sale.sales_id == sales_id).first()
            if local_sale is not None:
                local_sale.particulars = normalized_particulars
                self.db.commit()

        self.broadcast_sync_events(
            company_id=resolved_cid,
            sale_id=sales_id,
            action="sale_updated",
            emit_sales=True,
            emit_receivables=True,
        )

