FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MEM0_TELEMETRY=false \
    HF_HOME=/opt/hf \
    FASTEMBED_CACHE_PATH=/opt/fastembed

WORKDIR /app

RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's|http://deb.debian.org|https://mirrors.cloud.tencent.com|g; s|https://deb.debian.org|https://mirrors.cloud.tencent.com|g' /etc/apt/sources.list.d/debian.sources; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir \
      -i https://mirrors.cloud.tencent.com/pypi/simple \
      --trusted-host mirrors.cloud.tencent.com \
      -r requirements.txt

COPY app.py .

ENV HOME=/tmp \
    HF_ENDPOINT=https://hf-mirror.com \
    HF_HUB_DISABLE_XET=1 \
    HF_HUB_ENABLE_HF_TRANSFER=0
EXPOSE 8888
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8888", "--workers", "1"]
