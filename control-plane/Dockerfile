FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . /app/control_plane/
RUN adduser --system --no-create-home appuser
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import httpx; httpx.get('http://localhost:8000/health').raise_for_status()" || exit 1
CMD ["uvicorn", "control_plane.app:app", "--host", "0.0.0.0", "--port", "8000"]
