from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

DailyRemarkKind = Literal["sales", "expense"]


class DailyRemarkUpsert(BaseModel):
    company_id: int
    kind: DailyRemarkKind
    remark_date: date
    # Empty or blank text clears the remark for that day.
    remarks: Optional[str] = Field(default=None, max_length=5000)


class DailyRemarkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    daily_remark_id: int
    company_id: int
    kind: DailyRemarkKind
    remark_date: date
    remarks: str
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None
