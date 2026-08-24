"""Agent-facing catalog endpoints.

`/catalog/feed` is the machine-readable product feed an external agent crawls;
`/catalog/search` is how it narrows down. Both return integer paise and explicit
typed attributes so an agent never has to parse prose to price something.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..models import CatalogFeedPage, CatalogSearchResponse, Product, iso, utcnow
from . import store

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/feed", response_model=CatalogFeedPage, summary="Machine-readable product feed")
def catalog_feed(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    category: str | None = Query(default=None),
) -> CatalogFeedPage:
    """ACP-style feed: stable ids, minor-unit prices, availability, structured attributes."""
    settings = get_settings()
    products, total = store.list_products(limit=limit, offset=offset, category=category)
    next_offset = offset + limit if offset + limit < total else None
    return CatalogFeedPage(
        merchant_id=settings.merchant_id,
        merchant_name=settings.merchant_name,
        generated_at=iso(utcnow()),
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_offset,
        categories=store.list_categories(),
        products=products,
    )


@router.get("/search", response_model=CatalogSearchResponse, summary="Semantic + filtered search")
def catalog_search(
    q: str = Query(default="", description="Natural-language query, e.g. 'wireless mouse under 1500'"),
    max_price: int | None = Query(
        default=None, ge=0, description="Hard price ceiling in paise. Applied before ranking."
    ),
    min_price: int | None = Query(default=None, ge=0, description="Price floor in paise."),
    category: str | None = Query(default=None),
    in_stock_only: bool = Query(default=False),
    limit: int = Query(default=10, ge=1, le=50),
) -> CatalogSearchResponse:
    results, filters, matched = store.search(
        query=q,
        max_price_paise=max_price,
        min_price_paise=min_price,
        category=category,
        in_stock_only=in_stock_only,
        limit=limit,
    )
    return CatalogSearchResponse(
        query=q, filters=filters, total_matched=matched, results=results
    )


@router.get("/product/{product_id}", response_model=Product, summary="Full product record")
def catalog_product(product_id: str) -> Product:
    product = store.get_product(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail=f"No product with id {product_id}")
    return product


@router.post("/ingest", summary="Re-ingest the seed catalog and rebuild embeddings")
def catalog_ingest() -> dict:
    return store.ingest_seed_file()


@router.post("/product/{product_id}/stock", response_model=Product, summary="Set stock (demo control)")
def catalog_set_stock(product_id: str, stock: int = Query(ge=0)) -> Product:
    """Lets the demo script drive a product to zero stock mid-flow."""
    product = store.set_stock(product_id, stock)
    if product is None:
        raise HTTPException(status_code=404, detail=f"No product with id {product_id}")
    return product
