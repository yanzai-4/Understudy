from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from pydantic import BaseModel

from app.api.deps import api_error
from app.config import settings
from app.db import get_db
from app.models import BoardState, Film, Shot
from app.schemas import FilmCreate, FilmOut, FilmUpdate, Page
from app.services import paths

router = APIRouter(prefix="/films", tags=["films"])


def _film_out(db: Session, film: Film) -> FilmOut:
    shot_count = db.scalar(select(func.count(Shot.id)).where(Shot.film_id == film.id)) or 0
    scene_count = (
        db.scalar(
            select(func.count(func.distinct(Shot.scene_no))).where(
                Shot.film_id == film.id, Shot.scene_no.is_not(None)
            )
        )
        or 0
    )
    exported_count = (
        db.scalar(
            select(func.count(Shot.id)).where(Shot.film_id == film.id, Shot.status == "exported")
        )
        or 0
    )

    # Cover: the most recently updated shot that has a thumbnail on disk.
    cover_url = None
    recent = db.scalars(
        select(Shot).where(Shot.film_id == film.id).order_by(Shot.updated_at.desc()).limit(10)
    ).all()
    for shot in recent:
        url = paths.thumbnail_url(film.id, shot.id)
        if url:
            cover_url = url
            break

    out = FilmOut.model_validate(film)
    out.shot_count = shot_count
    out.scene_count = scene_count
    out.exported_count = exported_count
    out.cover_url = cover_url
    return out


def _get_film(db: Session, film_id: str) -> Film:
    film = db.get(Film, film_id)
    if film is None:
        raise api_error(404, "film_not_found", f"Film {film_id} does not exist")
    return film


@router.get("", response_model=Page[FilmOut])
def list_films(
    search: str = "",
    sort: str = Query("updated", pattern="^(updated|created|name)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    page_size = page_size or settings.default_page_size
    page_size = min(page_size, settings.max_page_size)

    query = select(Film)
    if search.strip():
        like = f"%{search.strip()}%"
        query = query.where(or_(Film.name.like(like), Film.description.like(like)))

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0

    order = {
        "updated": Film.updated_at.desc(),
        "created": Film.created_at.desc(),
        "name": Film.name.asc(),
    }[sort]
    films = db.scalars(query.order_by(order).offset((page - 1) * page_size).limit(page_size)).all()

    return Page(
        items=[_film_out(db, f) for f in films],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=FilmOut)
def create_film(body: FilmCreate, db: Session = Depends(get_db)):
    film = Film(name=body.name.strip(), description=body.description.strip())
    db.add(film)
    db.commit()
    paths.film_dir(film.id).joinpath("shots").mkdir(parents=True, exist_ok=True)
    return _film_out(db, film)


@router.get("/{film_id}", response_model=FilmOut)
def get_film(film_id: str, db: Session = Depends(get_db)):
    return _film_out(db, _get_film(db, film_id))


@router.patch("/{film_id}", response_model=FilmOut)
def update_film(film_id: str, body: FilmUpdate, db: Session = Depends(get_db)):
    film = _get_film(db, film_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        film.name = data["name"].strip()
    for field in ("description", "notes", "status", "default_camera_params"):
        if field in data:
            setattr(film, field, data[field])
    db.commit()
    return _film_out(db, film)


@router.delete("/{film_id}", status_code=204)
def delete_film(film_id: str, db: Session = Depends(get_db)):
    film = _get_film(db, film_id)
    db.delete(film)
    db.commit()
    paths.delete_film_dir(film_id)


EMPTY_BOARD: dict = {"nodes": {}, "scenes": {}, "edges": []}


class BoardUpdate(BaseModel):
    data: dict


@router.get("/{film_id}/board")
def get_board(film_id: str, db: Session = Depends(get_db)) -> dict:
    _get_film(db, film_id)
    state = db.get(BoardState, film_id)
    return state.data if state and state.data else dict(EMPTY_BOARD)


@router.put("/{film_id}/board")
def put_board(film_id: str, body: BoardUpdate, db: Session = Depends(get_db)) -> dict:
    _get_film(db, film_id)
    data = {
        "nodes": body.data.get("nodes", {}),
        "scenes": body.data.get("scenes", {}),
        "edges": body.data.get("edges", []),
    }
    state = db.get(BoardState, film_id)
    if state is None:
        db.add(BoardState(film_id=film_id, data=data))
    else:
        state.data = data
    db.commit()
    return data


@router.get("/{film_id}/tags", response_model=list[str])
def list_film_tags(film_id: str, db: Session = Depends(get_db)):
    _get_film(db, film_id)
    rows = db.execute(
        text(
            "SELECT DISTINCT je.value FROM shots, json_each(shots.tags) AS je "
            "WHERE shots.film_id = :film_id ORDER BY je.value"
        ),
        {"film_id": film_id},
    ).all()
    return [row[0] for row in rows]
