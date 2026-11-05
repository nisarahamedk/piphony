import os
import time
from contextlib import asynccontextmanager
from typing import Iterator

import psycopg
from fastapi import FastAPI

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://fixture:fixture@postgres:5432/fixturedb")
SEED_TITLE = os.environ.get("SEED_TITLE", "Ship release checklist")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> Iterator[None]:
    ensure_database_seeded()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "backend-ok"}


@app.get("/todos")
def list_todos() -> list[dict[str, str]]:
    with psycopg.connect(DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id::text, title, status FROM smoke_todos ORDER BY created_at ASC, id ASC",
            )
            rows = cursor.fetchall()
    return [
        {"id": row[0], "title": row[1], "status": row[2], "source": "postgres"}
        for row in rows
    ]


def ensure_database_seeded() -> None:
    deadline = time.time() + 60
    while True:
        try:
            with psycopg.connect(DATABASE_URL) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS smoke_todos (
                            id SERIAL PRIMARY KEY,
                            title TEXT NOT NULL,
                            status TEXT NOT NULL,
                            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                        )
                        """,
                    )
                    cursor.execute("SELECT COUNT(*) FROM smoke_todos")
                    count = cursor.fetchone()[0]
                    if count == 0:
                        cursor.execute(
                            "INSERT INTO smoke_todos (title, status) VALUES (%s, %s)",
                            (SEED_TITLE, "ready"),
                        )
                connection.commit()
            return
        except psycopg.OperationalError:
            if time.time() >= deadline:
                raise
            time.sleep(2)
