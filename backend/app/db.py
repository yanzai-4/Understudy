from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


settings.ensure_dirs()

engine = create_engine(
    f"sqlite:///{settings.db_path}",
    # BackgroundTasks run in a threadpool, so sessions cross threads.
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, _record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    # Imported here so all models register on Base before create_all.
    from app import models  # noqa: F401

    Base.metadata.create_all(engine)
    _migrate()


def _migrate() -> None:
    """Lightweight additive migrations for existing databases (SQLite only
    needs ADD COLUMN; create_all handles brand-new tables)."""
    added_columns = {
        "camera_params": ["light_position", "light_quality", "light_mood", "shutter"],
    }
    with engine.begin() as conn:
        for table, columns in added_columns.items():
            existing = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            for col in columns:
                if col not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {col} VARCHAR(50)")
        # background-edit feature removed — drop its table if an old DB still has it
        conn.exec_driver_sql("DROP TABLE IF EXISTS background_edits")
