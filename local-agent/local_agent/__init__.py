"""Local LangGraph agent — execution plane for the 3-layer architecture."""
import os
import sys

# Ensure the parent directory (local-agent/) is in sys.path
# so that 'graph' package and 'local_agent' package are both importable.
_parent = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _parent not in sys.path:
    sys.path.insert(0, _parent)
