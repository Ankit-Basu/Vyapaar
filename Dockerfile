# Vyapaar API — FastAPI, packaged for any container host.
#
# The layout below is not arbitrary. `config.py` resolves the repository root as
# `Path(__file__).resolve().parents[3]`, so the image has to preserve the same
# depth it has in the repo:
#
#   /app/services/api/app/config.py   ->  parents[3] == /app
#   /app/seed/products.json               found relative to that
#   /app/data/vyapaar.db                  created on first boot
#
# Flatten it and the catalog seed goes missing at start-up, so `services/api`
# and `seed` are copied to their real paths rather than to the working directory.

FROM python:3.12-slim

# Bytecode files and stdout buffering are both noise in a container: one bloats
# layers, the other hides start-up logs when a platform tails them.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Requirements first, so a code change does not re-resolve the dependency tree.
COPY services/api/requirements.txt services/api/requirements.txt
RUN pip install --no-cache-dir -r services/api/requirements.txt

COPY services/api ./services/api
COPY seed ./seed

# SQLite lives on the container's own disk. That is deliberate rather than a
# compromise: the service creates its schema, seeds 33 products, derives unit
# economics and opens a campaign on every boot, so a restart comes back to a
# clean working merchant instead of a broken one. Nothing here is a system of
# record — the whole point of `POST /demo/reset` is to start empty.
RUN mkdir -p /app/data
ENV DATABASE_PATH=/app/data/vyapaar.db

WORKDIR /app/services/api

# Hosts inject the port. The shell form is required so ${PORT} expands.
ENV PORT=8000
EXPOSE 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
