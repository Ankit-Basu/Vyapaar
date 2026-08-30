"""Catalog ingest and retrieval.

Search is hybrid: Okapi BM25 over the merchant's own wording, blended with cosine
similarity over stored embeddings. Structured filters (category, price ceiling,
availability) are applied *before* scoring, so an agent can rely on
`max_price_paise` as a hard bound rather than a hint the ranker might ignore.

Every hit carries a `rationale` string explaining why it surfaced. An agent that
picks a product can quote that line straight into its own reasoning, and it ends
up in the audit trail alongside the purchase.
"""

from __future__ import annotations

import json
import logging
import math
import re
import sqlite3
import threading
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from ..config import get_settings
from ..db import connect, transaction
from ..models import Product, ScoredProduct
from .embeddings import (
    cosine,
    expand_query_tokens,
    from_blob,
    get_embedder,
    query_tokens,
    to_blob,
    tokenize,
)

log = logging.getLogger("vyapaar.catalog")

BM25_K1 = 1.5
BM25_B = 0.75
LEXICAL_WEIGHT = 0.55
SEMANTIC_WEIGHT = 0.45

_PRICE_HINT_RE = re.compile(
    r"(?:under|below|less than|cheaper than|upto|up to|max|within|budget of)\s*"
    r"(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)",
    re.IGNORECASE,
)


def rupees(paise: int) -> str:
    """Format paise as an Indian-rupee string for human-readable rationales."""
    return f"INR {paise / 100:,.2f}"


def parse_price_hint_paise(query: str) -> int | None:
    """Pull a spending ceiling out of natural language such as 'under 1500'.

    Only used when the caller did not pass an explicit `max_price_paise`, and the
    value it found is always echoed back in the response `filters` so the bound is
    visible rather than silently applied.
    """
    match = _PRICE_HINT_RE.search(query)
    if not match:
        return None
    try:
        rupee_value = float(match.group(1).replace(",", ""))
    except ValueError:  # pragma: no cover - regex already constrains the shape
        return None
    if rupee_value <= 0:
        return None
    return int(round(rupee_value * 100))


def _search_text(product: Product) -> str:
    """What gets embedded and indexed: title, description and structured attributes."""
    attribute_text = " ".join(f"{k.replace('_', ' ')} {v}" for k, v in product.attributes.items())
    return f"{product.title}. {product.description} Category: {product.category}. {attribute_text}"


def _row_to_product(row: sqlite3.Row) -> Product:
    return Product(
        id=row["id"],
        title=row["title"],
        description=row["description"],
        category=row["category"],
        price_paise=row["price_paise"],
        currency=row["currency"],
        stock=row["stock"],
        attributes=json.loads(row["attributes_json"]),
    )


# --------------------------------------------------------------------------
# In-memory retrieval index
# --------------------------------------------------------------------------


@dataclass
class _Index:
    products: list[Product]
    doc_tokens: list[Counter[str]]
    doc_lengths: list[int]
    avg_doc_length: float
    doc_freq: Counter[str]
    embeddings: np.ndarray
    total_docs: int


_index_lock = threading.Lock()
_index_cache: _Index | None = None


def invalidate_index() -> None:
    """Called after any write that changes catalog content or availability."""
    global _index_cache
    with _index_lock:
        _index_cache = None


def _build_index() -> _Index:
    embedder = get_embedder()
    with connect() as conn:
        rows = conn.execute("SELECT * FROM product ORDER BY id ASC").fetchall()

    products = [_row_to_product(row) for row in rows]
    doc_tokens: list[Counter[str]] = []
    doc_lengths: list[int] = []
    doc_freq: Counter[str] = Counter()

    for row, product in zip(rows, products, strict=True):
        tokens = tokenize(row["search_text"] or _search_text(product))
        counts = Counter(tokens)
        doc_tokens.append(counts)
        doc_lengths.append(len(tokens))
        doc_freq.update(counts.keys())

    if products:
        vectors = np.vstack([from_blob(row["embedding"], embedder.dim) for row in rows])
    else:
        vectors = np.zeros((0, embedder.dim), dtype=np.float32)

    return _Index(
        products=products,
        doc_tokens=doc_tokens,
        doc_lengths=doc_lengths,
        avg_doc_length=(sum(doc_lengths) / len(doc_lengths)) if doc_lengths else 0.0,
        doc_freq=doc_freq,
        embeddings=vectors,
        total_docs=len(products),
    )


def _get_index() -> _Index:
    global _index_cache
    with _index_lock:
        if _index_cache is None:
            _index_cache = _build_index()
        return _index_cache


# --------------------------------------------------------------------------
# Ingest
# --------------------------------------------------------------------------


def ingest_products(products: list[Product]) -> int:
    """Upsert products and refresh their embeddings. Idempotent by product id."""
    if not products:
        return 0
    embedder = get_embedder()
    texts = [_search_text(product) for product in products]
    vectors = embedder.encode(texts)

    with transaction() as conn:
        for product, text, vector in zip(products, texts, vectors, strict=True):
            conn.execute(
                """
                INSERT INTO product (id, title, description, category, price_paise,
                                     currency, stock, attributes_json, search_text, embedding)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,
                    description=excluded.description,
                    category=excluded.category,
                    price_paise=excluded.price_paise,
                    currency=excluded.currency,
                    stock=excluded.stock,
                    attributes_json=excluded.attributes_json,
                    search_text=excluded.search_text,
                    embedding=excluded.embedding
                """,
                (
                    product.id,
                    product.title,
                    product.description,
                    product.category,
                    product.price_paise,
                    product.currency,
                    product.stock,
                    json.dumps(product.attributes, sort_keys=True),
                    text,
                    to_blob(vector),
                ),
            )
    invalidate_index()
    log.info("ingested %d products with %s embeddings", len(products), embedder.name)
    return len(products)


def ingest_seed_file(path: str | Path | None = None) -> dict[str, Any]:
    settings = get_settings()
    seed_path = Path(path or settings.seed_products_path)
    raw = json.loads(seed_path.read_text(encoding="utf-8"))
    products = [Product.model_validate(item) for item in raw["products"]]
    count = ingest_products(products)
    return {
        "source": str(seed_path),
        "merchant_id": raw.get("merchant_id", settings.merchant_id),
        "merchant_name": raw.get("merchant_name", settings.merchant_name),
        "ingested": count,
        "embedder": get_embedder().name,
    }


# --------------------------------------------------------------------------
# Reads
# --------------------------------------------------------------------------


def get_product(product_id: str) -> Product | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM product WHERE id = ?", (product_id,)).fetchone()
    return _row_to_product(row) if row else None


def list_products(
    *, limit: int = 50, offset: int = 0, category: str | None = None
) -> tuple[list[Product], int]:
    where, params = ("WHERE category = ?", [category]) if category else ("", [])
    with connect() as conn:
        total = int(
            conn.execute(f"SELECT COUNT(*) AS n FROM product {where}", params).fetchone()["n"]
        )
        rows = conn.execute(
            f"SELECT * FROM product {where} ORDER BY id ASC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return [_row_to_product(row) for row in rows], total


def list_categories() -> list[str]:
    with connect() as conn:
        rows = conn.execute("SELECT DISTINCT category FROM product ORDER BY category ASC").fetchall()
    return [row["category"] for row in rows]


def product_count() -> int:
    with connect() as conn:
        return int(conn.execute("SELECT COUNT(*) AS n FROM product").fetchone()["n"])


# --------------------------------------------------------------------------
# Search
# --------------------------------------------------------------------------


def _bm25_scores(index: _Index, query_tokens: list[str], candidates: list[int]) -> dict[int, float]:
    scores: dict[int, float] = {}
    if not query_tokens or index.total_docs == 0:
        return scores
    query_counts = Counter(query_tokens)
    for doc_idx in candidates:
        counts = index.doc_tokens[doc_idx]
        length = index.doc_lengths[doc_idx] or 1
        score = 0.0
        for term, query_tf in query_counts.items():
            tf = counts.get(term, 0)
            if tf == 0:
                continue
            df = index.doc_freq.get(term, 0)
            idf = math.log(1 + (index.total_docs - df + 0.5) / (df + 0.5))
            denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * length / (index.avg_doc_length or 1))
            # Repeated query terms count for a little more, but sub-linearly.
            score += idf * (tf * (BM25_K1 + 1) / denom) * (1.0 + 0.15 * (query_tf - 1))
        if score > 0:
            scores[doc_idx] = score
    return scores


def _matched_terms(index: _Index, doc_idx: int, query_tokens: list[str]) -> list[str]:
    counts = index.doc_tokens[doc_idx]
    seen: list[str] = []
    for term in query_tokens:
        if term in counts and term not in seen and len(term) > 2:
            seen.append(term)
    return seen[:6]


def _build_rationale(
    product: Product,
    matched: list[str],
    max_price_paise: int | None,
    semantic_score: float,
) -> str:
    parts: list[str] = []
    if matched:
        parts.append(f"matched terms {matched}")
    else:
        parts.append(f"no exact term overlap; ranked by embedding similarity {semantic_score:.2f}")
    parts.append(f"priced {rupees(product.price_paise)}")
    if max_price_paise is not None:
        headroom = max_price_paise - product.price_paise
        parts.append(f"{rupees(headroom)} under the {rupees(max_price_paise)} ceiling")
    parts.append(
        f"{product.stock} in stock" if product.in_stock else "OUT OF STOCK - not purchasable"
    )
    return "; ".join(parts)


def search(
    *,
    query: str,
    max_price_paise: int | None = None,
    min_price_paise: int | None = None,
    category: str | None = None,
    in_stock_only: bool = False,
    limit: int = 10,
) -> tuple[list[ScoredProduct], dict[str, Any], int]:
    """Return ranked hits, the filters actually applied, and the pre-limit match count."""
    index = _get_index()
    settings_max = max_price_paise
    inferred_max = None
    if settings_max is None:
        inferred_max = parse_price_hint_paise(query)
        settings_max = inferred_max

    candidates: list[int] = []
    for idx, product in enumerate(index.products):
        if category and product.category != category.strip().lower():
            continue
        if settings_max is not None and product.price_paise > settings_max:
            continue
        if min_price_paise is not None and product.price_paise < min_price_paise:
            continue
        if in_stock_only and not product.in_stock:
            continue
        candidates.append(idx)

    filters: dict[str, Any] = {
        "category": category,
        "max_price_paise": settings_max,
        "min_price_paise": min_price_paise,
        "in_stock_only": in_stock_only,
        "max_price_inferred_from_query": inferred_max is not None,
    }

    if not candidates:
        return [], filters, 0

    terms = expand_query_tokens(query_tokens(query))

    lexical = _bm25_scores(index, terms, candidates)
    lexical_max = max(lexical.values()) if lexical else 0.0

    if query.strip():
        query_vector = get_embedder().encode([query])[0]
        semantic_all = cosine(query_vector, index.embeddings)
    else:
        semantic_all = np.zeros(len(index.products), dtype=np.float32)

    scored: list[ScoredProduct] = []
    for doc_idx in candidates:
        lexical_norm = (lexical.get(doc_idx, 0.0) / lexical_max) if lexical_max > 0 else 0.0
        semantic_norm = float(max(0.0, semantic_all[doc_idx])) if semantic_all.size else 0.0
        blended = LEXICAL_WEIGHT * lexical_norm + SEMANTIC_WEIGHT * semantic_norm
        product = index.products[doc_idx]
        matched = _matched_terms(index, doc_idx, terms)
        scored.append(
            ScoredProduct(
                product=product,
                score=round(blended, 4),
                lexical_score=round(lexical_norm, 4),
                semantic_score=round(semantic_norm, 4),
                rationale=_build_rationale(product, matched, settings_max, semantic_norm),
            )
        )

    # Ties broken by price so an agent asking for "cheapest" gets a stable ordering.
    scored.sort(key=lambda hit: (-hit.score, hit.product.price_paise, hit.product.id))
    return scored[:limit], filters, len(scored)


# --------------------------------------------------------------------------
# Stock
# --------------------------------------------------------------------------


def set_stock(product_id: str, stock: int) -> Product | None:
    """Used by the demo scenario runner to force the out-of-stock failure path."""
    with transaction() as conn:
        conn.execute("UPDATE product SET stock = ? WHERE id = ?", (max(0, stock), product_id))
    invalidate_index()
    return get_product(product_id)


def decrement_stock(product_id: str, qty: int, conn: sqlite3.Connection) -> bool:
    """Consume inventory inside the caller's transaction.

    The `stock >= ?` guard in the WHERE clause is what makes this safe against two
    payments settling for the last unit at the same moment.
    """
    cursor = conn.execute(
        "UPDATE product SET stock = stock - ? WHERE id = ? AND stock >= ?",
        (qty, product_id, qty),
    )
    changed = cursor.rowcount > 0
    if changed:
        invalidate_index()
    return changed
