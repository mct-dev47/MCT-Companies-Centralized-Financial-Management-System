"""
migrate_petty_cash_receipts_to_storage.py
-----------------------------------------
One-off backfill: move base64 receipt files that are stored inline in
petty_cash_topups.attachments / receipt_url into the Supabase Storage
bucket "receipts", leaving only the storage path in the table.

Safe by default — runs as a DRY RUN and only reports what it would do.

    python migrate_petty_cash_receipts_to_storage.py            # dry run
    python migrate_petty_cash_receipts_to_storage.py --apply    # upload + update rows

Rows are processed one at a time (ids first, then each row), so the script
never pulls the whole table's base64 payload at once. A row is only updated
after all of its files uploaded successfully; failed rows are left untouched
and can be retried by re-running the script.
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import or_

from app.db.session import SessionLocal
from app.db.supabase import get_supabase_admin_client
from app.models.petty_cash import PettyCashTopUp
from app.services import receipt_storage


def _has_inline(value: str | None) -> bool:
    return bool(value) and "data:" in value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="Actually upload files and update rows.")
    args = parser.parse_args()

    if get_supabase_admin_client() is None:
        print("Supabase is not configured (SUPABASE_URL / service role key). Aborting.")
        return 1

    db = SessionLocal()
    try:
        ids = [
            tid
            for (tid,) in db.query(PettyCashTopUp.topup_id)
            .filter(
                or_(
                    PettyCashTopUp.attachments.contains("data:"),
                    PettyCashTopUp.receipt_url.contains("data:"),
                )
            )
            .order_by(PettyCashTopUp.topup_id)
            .all()
        ]
        print(f"{len(ids)} petty cash row(s) have inline receipt files.")
        if not ids:
            return 0

        migrated = failed = 0
        bytes_before = bytes_after = 0
        for tid in ids:
            row = db.get(PettyCashTopUp, tid)
            old_atts, old_url = row.attachments, row.receipt_url
            size_before = len(old_atts or "") + len(old_url or "")

            if not args.apply:
                print(f"  [dry-run] topup {tid}: ~{size_before / 1024:.0f} KB inline")
                bytes_before += size_before
                continue

            new_atts = receipt_storage.normalize_attachments(old_atts)
            new_url = receipt_storage.normalize_receipt_url(old_url, new_atts)
            if _has_inline(new_atts) or _has_inline(new_url):
                failed += 1
                print(f"  topup {tid}: upload failed for at least one file — left unchanged")
                db.expunge(row)
                continue

            row.attachments, row.receipt_url = new_atts, new_url
            db.commit()
            size_after = len(new_atts or "") + len(new_url or "")
            bytes_before += size_before
            bytes_after += size_after
            migrated += 1
            print(f"  topup {tid}: {size_before / 1024:.0f} KB -> {size_after} bytes")
            db.expunge_all()

        if args.apply:
            print(
                f"\nDone. Migrated {migrated}, failed {failed}. "
                f"Inline data reduced from {bytes_before / 1024 / 1024:.1f} MB to {bytes_after / 1024:.1f} KB."
            )
        else:
            print(f"\nDry run: ~{bytes_before / 1024 / 1024:.1f} MB would move to storage. Re-run with --apply.")
        return 0 if failed == 0 else 2
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
