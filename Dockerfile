FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api ./api
COPY simulator ./simulator
COPY warehouse ./warehouse
COPY dbt ./dbt
COPY transform ./transform
COPY data ./data

ENV PYTHONPATH=/app
ENV DBT_PROFILES_DIR=/app/dbt
ENV DUCKDB_PATH=/app/data/snowpitch.duckdb

EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
