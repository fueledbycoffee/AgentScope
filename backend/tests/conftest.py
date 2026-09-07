"""Hypothesis profiles: `default` for CI, `deep` for local sweeps.

Select with HYPOTHESIS_PROFILE=deep.
"""

import os

from hypothesis import HealthCheck, settings

settings.register_profile(
    "default", max_examples=200, deadline=None, suppress_health_check=[HealthCheck.too_slow]
)
settings.register_profile(
    "deep", max_examples=4000, deadline=None, suppress_health_check=[HealthCheck.too_slow]
)
settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "default"))
