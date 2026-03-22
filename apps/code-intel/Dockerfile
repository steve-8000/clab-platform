FROM python:3.12-slim

WORKDIR /app

# Install git and system dependencies needed by CGC/tree-sitter
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl build-essential && \
    rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY apps/code-intel/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy codegraph package
COPY packages/codegraph /app/packages/codegraph
RUN pip install --no-cache-dir -e /app/packages/codegraph || true

# Install CGC from vendor
COPY vendor/codegraphcontext /app/vendor/codegraphcontext
RUN pip install --no-cache-dir -e /app/vendor/codegraphcontext || true
RUN pip install --no-cache-dir "tree-sitter-language-pack==0.13.0"

# Copy application code
COPY apps/code-intel /app/code_intel

RUN mkdir -p /app/repos

ENV PYTHONPATH=/app:/app/packages

EXPOSE ${CODE_INTEL_PORT:-4010}

CMD ["sh", "-c", "uvicorn code_intel.app:app --host 0.0.0.0 --port ${CODE_INTEL_PORT:-4010}"]
