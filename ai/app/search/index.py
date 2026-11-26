"""프로세스 메모리의 BM25 인덱스 + 캐시 키에 들어가는 index_version.

원천은 ai.search_doc(Kiwi 토큰). 시작 시와 동기화 후에 DB에서 재구축한다(인스턴스 1대 전제).
"""

from sqlalchemy import Engine, text

from app.search.bm25 import BM25Index


class SearchIndex:
    def __init__(self):
        self.bm25 = BM25Index({})
        self.version = 0

    @property
    def doc_count(self) -> int:
        return len(self.bm25)

    def rebuild(self, engine: Engine) -> None:
        with engine.connect() as conn:
            docs = {
                r.item_id: r.tokens
                for r in conn.execute(text("SELECT item_id, tokens FROM ai.search_doc"))
            }
            version = conn.execute(
                text("SELECT index_version FROM ai.index_meta WHERE id = 1")
            ).scalar()
        self.bm25, self.version = BM25Index(docs), version or 0
