import logging
import re
from typing import Any


class SensitiveParamRedactionFilter(logging.Filter):
    """
    Log filter that masks sensitive query parameters (e.g. token, access_token, key, secret)
    to prevent credential leakage in console and access logs.
    """
    _PATTERN = re.compile(r'([?&](?:token|access_token|key|secret)=)[^&\s"\']+', re.IGNORECASE)

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = self._PATTERN.sub(r'\1***REDACTED***', record.msg)
        if record.args:
            if isinstance(record.args, tuple):
                record.args = tuple(self._redact(arg) for arg in record.args)
            elif isinstance(record.args, dict):
                record.args = {k: self._redact(v) for k, v in record.args.items()}
        return True

    def _redact(self, value: Any) -> Any:
        if isinstance(value, str):
            return self._PATTERN.sub(r'\1***REDACTED***', value)
        return value


def setup_log_redaction() -> None:
    redaction_filter = SensitiveParamRedactionFilter()
    target_loggers = (
        "uvicorn",
        "uvicorn.access",
        "uvicorn.error",
        "fastapi",
    )
    for name in target_loggers:
        lg = logging.getLogger(name)
        if not any(isinstance(f, SensitiveParamRedactionFilter) for f in lg.filters):
            lg.addFilter(redaction_filter)
        for h in lg.handlers:
            if not any(isinstance(f, SensitiveParamRedactionFilter) for f in h.filters):
                h.addFilter(redaction_filter)

