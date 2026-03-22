FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY apps/code-intel/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy codegraph package
COPY packages/codegraph /app/packages/codegraph
RUN pip install --no-cache-dir -e /app/packages/codegraph || true

# Install CGC from vendor
COPY vendor/codegraphcontext /app/vendor/codegraphcontext
RUN pip install --no-cache-dir -e /app/vendor/codegraphcontext || true

# Copy application code
COPY apps/code-intel /app/code_intel

ENV PYTHONPATH=/app

EXPOSE ${CODE_INTEL_PORT:-8003}

CMD ["sh", "-c", "uvicorn code_intel.app:app --host 0.0.0.0 --port ${CODE_INTEL_PORT:-8003}"]
