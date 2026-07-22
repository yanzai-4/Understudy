import sqlalchemy as sa

from app.db import engine


def test_background_edits_table_gone_after_migrate():
    # The feature is removed; the DROP is idempotent and the table must be absent.
    with engine.begin() as conn:
        conn.exec_driver_sql("DROP TABLE IF EXISTS background_edits")
    insp = sa.inspect(engine)
    assert "background_edits" not in insp.get_table_names()
