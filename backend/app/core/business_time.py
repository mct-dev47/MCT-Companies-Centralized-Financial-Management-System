"""Business-calendar helpers.

The servers run in UTC, but every MCT company operates in the Philippines (UTC+8).
Using ``date.today()`` for "no future dates" checks rejects entries dated today
between 00:00 and 08:00 Manila time, because the server still thinks it is yesterday.
"""
from datetime import date, datetime, timedelta, timezone

MANILA_TZ = timezone(timedelta(hours=8), name="Asia/Manila")


def business_today() -> date:
    """Today's date on the business (Manila) calendar."""
    return datetime.now(MANILA_TZ).date()
