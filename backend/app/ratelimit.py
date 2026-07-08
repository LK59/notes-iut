"""Re-exporte check_rate_limit depuis cache.py (implémentation persistée en SQLite)."""
from .cache import check_rate_limit, MAX_ATTEMPTS_IP, MAX_ATTEMPTS_USER, WINDOW_SECONDS

__all__ = ["check_rate_limit", "MAX_ATTEMPTS_IP", "MAX_ATTEMPTS_USER", "WINDOW_SECONDS"]
