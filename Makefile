VENV ?= $(HOME)/.venvs/snowpitch
.PHONY: install seed seed-snowflake api web test

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
