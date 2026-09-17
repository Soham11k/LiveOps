VENV ?= $(HOME)/.venvs/snowpitch
.PHONY: install seed seed-snowflake api web test dbt dbt-test dbt-docs lint benchmark

install:
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install -r requirements.txt
	cd apps/web && npm install

seed:
	PYTHONPATH=. $(VENV)/bin/python -m simulator.generate

seed-snowflake:
	PYTHONPATH=. $(VENV)/bin/python -m simulator.generate
	PYTHONPATH=. $(VENV)/bin/python -m warehouse.snowflake_load

api:
	PYTHONPATH=. $(VENV)/bin/uvicorn api.main:app --reload --port 8000

web:
	cd apps/web && npm run dev

test:
	PYTHONPATH=. $(VENV)/bin/python -m pytest -q

dbt:
	PYTHONPATH=. DBT_PROFILES_DIR=dbt DUCKDB_PATH=$(CURDIR)/data/snowpitch.duckdb \
		$(VENV)/bin/dbt build --project-dir dbt --target duckdb

dbt-test:
	PYTHONPATH=. DBT_PROFILES_DIR=dbt DUCKDB_PATH=$(CURDIR)/data/snowpitch.duckdb \
		$(VENV)/bin/dbt test --project-dir dbt --target duckdb

dbt-docs:
	PYTHONPATH=. DBT_PROFILES_DIR=dbt DUCKDB_PATH=$(CURDIR)/data/snowpitch.duckdb \
		$(VENV)/bin/dbt docs generate --project-dir dbt --target duckdb

lint:
	$(VENV)/bin/ruff check api warehouse simulator tests
	$(VENV)/bin/sqlfluff lint dbt/models --dialect duckdb || true

benchmark:
	PYTHONPATH=. $(VENV)/bin/python -m warehouse.benchmark
