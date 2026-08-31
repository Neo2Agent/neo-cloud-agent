FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MEM0_TELEMETRY=false \
    HF_HOME=/opt/hf \
    FASTEMBED_CACHE_PATH=/opt/fastembed

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the tiny ONNX embedder so the db host does not download at boot.
RUN python - <<'PY'
from fastembed import TextEmbedding
TextEmbedding(model_name="BAAI/bge-small-zh-v1.5")
print("embedder_cached")
PY

COPY app.py .

ENV HOME=/tmp
EXPOSE 8888
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8888", "--workers", "1"]
