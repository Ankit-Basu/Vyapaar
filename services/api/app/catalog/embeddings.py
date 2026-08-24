"""Vector embeddings for catalog search.

Two backends, same interface:

* `hashing` (default) -- a deterministic signed feature-hashing embedder built on
  word tokens plus character 4-grams. No model download, no torch, ~1ms for the
  whole catalog, and identical vectors on every machine, which is what keeps the
  demo reproducible.
* `sentence-transformers` -- real dense embeddings from `all-MiniLM-L6-v2`. Set
  `EMBEDDINGS_BACKEND=sentence-transformers` and install the extra to switch;
  nothing else in the codebase changes.

Retrieval is hybrid regardless of backend: the dense score is blended with BM25
in `store.py`, because on a 33-item catalog lexical signal carries most of the
weight and dense vectors mainly help with paraphrase.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
from collections import Counter
from functools import lru_cache
from typing import Protocol, runtime_checkable

import numpy as np

log = logging.getLogger("agentmandi.catalog.embeddings")

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_CHAR_NGRAM = 4
DEFAULT_DIM = 384

# Buyer agents phrase things their own way. This maps demo-domain vocabulary onto
# the words the merchant actually used, and is applied to queries only -- never to
# the stored product text, so it can never invent a product that does not exist.
DOMAIN_LEXICON: dict[str, tuple[str, ...]] = {
    "earbuds": ("earphones", "in-ear", "audio"),
    "earbud": ("earphones", "in-ear", "audio"),
    "headset": ("headphones", "audio", "mic"),
    "headphone": ("headphones", "audio", "over-ear"),
    "noise": ("anc", "cancellation", "cancelling"),
    "cancelling": ("anc", "cancellation"),
    "canceling": ("anc", "cancellation"),
    "anc": ("noise", "cancellation", "headphones"),
    "keyboard": ("keyboard", "mechanical", "typing"),
    "mouse": ("mouse", "optical", "pointer"),
    "mice": ("mouse", "optical"),
    "charger": ("charger", "charging", "watts", "gan"),
    "powerbank": ("power", "bank", "mah"),
    "webcam": ("webcam", "camera", "1080p"),
    "dock": ("hub", "usb-c", "ports"),
    "docking": ("hub", "usb-c", "ports"),
    "riser": ("stand", "laptop", "elevate"),
    "notepad": ("notebook", "paper", "pages"),
    "pen": ("pen", "gel", "ink"),
    "chair": ("chair", "ergonomic", "lumbar"),
    "desk": ("desk", "office", "table"),
    "flask": ("flask", "bottle", "vacuum"),
    "thermos": ("flask", "vacuum", "insulated"),
    "pan": ("tawa", "cast", "iron", "skillet"),
    "skillet": ("tawa", "cast", "iron"),
    "tawa": ("tawa", "cast", "iron"),
    "coffee": ("coffee", "pour-over", "brew"),
    "lamp": ("lamp", "led", "light"),
    "dumbbell": ("dumbbell", "weight", "adjustable"),
    "weights": ("dumbbell", "kg", "adjustable"),
    "band": ("band", "resistance", "fitness"),
    "tracker": ("fitness", "band", "heart", "rate"),
    "smartwatch": ("fitness", "band", "amoled", "heart"),
    "mat": ("mat", "yoga", "tpe"),
    "rope": ("skipping", "rope", "cable"),
    "cheap": ("budget",),
    "cheapest": ("budget",),
    "affordable": ("budget",),
    "quiet": ("silent", "noise", "db"),
    "silent": ("silent", "quiet"),
    "ergonomic": ("ergonomic", "wrist", "lumbar", "vertical"),
    "wireless": ("wireless", "bluetooth", "2.4ghz"),
    "bluetooth": ("bluetooth", "wireless"),
}


# Dropped from queries only. "under 1500" is parsed into a hard price filter
# before this point, so leaving "under" in the query would otherwise pull up an
# "Under-Desk Cable Tray" on a search for a mouse.
STOPWORDS = frozenset(
    ["a", "an", "and", "any", "are", "as", "at", "be", "best", "by", "can", "cheap", "do", "for", "from", "get", "give", "good", "have", "how", "i", "in", "is", "it", "its", "me", "my", "need", "of", "on", "or", "please", "some", "something", "that", "the", "their", "them", "then", "there", "this", "to", "under", "up", "want", "was", "what", "when", "which", "who", "will", "with", "would", "you", "your"]
)


def tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def query_tokens(text: str) -> list[str]:
    """Content-bearing tokens from a buyer's phrasing, stopwords removed."""
    return [token for token in tokenize(text) if token not in STOPWORDS]


def expand_query_tokens(tokens: list[str]) -> list[str]:
    """Widen a buyer's phrasing with merchant vocabulary. Original tokens are kept."""
    expanded = [token for token in tokens if token not in STOPWORDS]
    for token in expanded[:]:
        expanded.extend(DOMAIN_LEXICON.get(token, ()))
    return expanded


def _char_ngrams(text: str, n: int = _CHAR_NGRAM) -> list[str]:
    """Sub-word features, so 'wireless' still partially matches 'wirelessly'."""
    cleaned = re.sub(r"\s+", " ", text.lower().strip())
    if len(cleaned) <= n:
        return [cleaned] if cleaned else []
    return [cleaned[i : i + n] for i in range(len(cleaned) - n + 1)]


def _feature_slot(feature: str, dim: int) -> tuple[int, float]:
    """Map a feature to a bucket and a stable +/-1 sign (the signed-hashing trick,
    which keeps collisions from systematically inflating similarity)."""
    digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
    value = int.from_bytes(digest, "big")
    return value % dim, 1.0 if (value >> 63) & 1 else -1.0


@runtime_checkable
class Embedder(Protocol):
    name: str
    dim: int

    def encode(self, texts: list[str]) -> np.ndarray: ...


class HashingEmbedder:
    """Deterministic, dependency-free, and identical across machines and runs."""

    name = "hashing-v1"

    def __init__(self, dim: int = DEFAULT_DIM) -> None:
        self.dim = dim

    def encode(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, text in enumerate(texts):
            words = tokenize(text)
            features = Counter(words)
            # Word features dominate; sub-word features add recall at a lower weight.
            for gram in _char_ngrams(text):
                features[f"#{gram}"] += 1
            for feature, count in features.items():
                idx, sign = _feature_slot(feature, self.dim)
                weight = (1.0 + math.log(count)) * (0.4 if feature.startswith("#") else 1.0)
                out[row, idx] += sign * weight
            norm = float(np.linalg.norm(out[row]))
            if norm > 0:
                out[row] /= norm
        return out


class SentenceTransformerEmbedder:
    """Optional dense backend. Imported lazily so the default install stays small."""

    name = "sentence-transformers/all-MiniLM-L6-v2"

    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2") -> None:
        from sentence_transformers import SentenceTransformer  # noqa: PLC0415

        self._model = SentenceTransformer(model_name)
        self.dim = int(self._model.get_sentence_embedding_dimension())
        self.name = model_name

    def encode(self, texts: list[str]) -> np.ndarray:
        vectors = self._model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return np.asarray(vectors, dtype=np.float32)


@lru_cache(maxsize=1)
def get_embedder() -> Embedder:
    from ..config import get_settings  # noqa: PLC0415 - avoids an import cycle at module load

    backend = get_settings().embeddings_backend
    if backend == "sentence-transformers":
        try:
            embedder = SentenceTransformerEmbedder()
            log.info("catalog embeddings: %s (dim=%d)", embedder.name, embedder.dim)
            return embedder
        except Exception as exc:  # pragma: no cover - only hit when the extra is missing
            log.warning(
                "sentence-transformers unavailable (%s); falling back to the hashing embedder", exc
            )
    return HashingEmbedder()


def to_blob(vector: np.ndarray) -> bytes:
    return np.asarray(vector, dtype=np.float32).tobytes()


def from_blob(blob: bytes | None, dim: int) -> np.ndarray:
    if not blob:
        return np.zeros(dim, dtype=np.float32)
    return np.frombuffer(blob, dtype=np.float32)


def cosine(query: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    """Both sides are already L2-normalised, so this is a plain dot product."""
    if matrix.size == 0:
        return np.zeros(0, dtype=np.float32)
    return np.clip(matrix @ query, -1.0, 1.0)
