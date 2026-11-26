// DoD: Swagger 문서가 만들어지고 모든 엔드포인트가 실린다(Zod DTO → OpenAPI 변환이 깨지지 않음).
import { buildOpenApiDocument } from '../src/app.setup';
import { createTestApp, type TestApp } from './support/app';

describe('OpenAPI', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());

  it('API.md의 엔드포인트가 전부 문서에 있다', () => {
    const doc = buildOpenApiDocument(t.app);
    const ops = Object.entries(doc.paths).flatMap(([p, item]) =>
      Object.keys(item as object)
        .filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
        .map((m) => `${m.toUpperCase()} ${p}`),
    );
    expect(ops).toEqual(
      expect.arrayContaining([
        'POST /api/auth/login',
        'GET /api/items',
        'GET /api/trending',
        'GET /api/items/{id}',
        'GET /api/items/{id}/stars',
        'GET /api/repos/{owner}/{name}',
        'GET /api/stats/overview',
        'GET /api/search',
        'GET /api/search/answer',
        'GET /api/me/bookmarks',
        'GET /api/me/bookmarks/ids',
        'PUT /api/me/bookmarks/{itemId}',
        'DELETE /api/me/bookmarks/{itemId}',
        'GET /api/me/bookmarks/security-changes',
        'POST /api/me/bookmarks/security-changes/ack',
        'POST /api/admin/ingestion/runs',
        'GET /api/admin/ingestion/runs',
        'GET /api/admin/ingestion/runs/{id}',
        'GET /api/admin/data-quality/summary',
        'GET /api/admin/data-quality/issues',
        'PATCH /api/admin/data-quality/issues/{id}',
        'GET /health',
      ]),
    );
    // 쿼리 스키마가 파라미터로 펼쳐진다(.strict()라도 필드 목록은 문서화됨).
    const params = (
      doc.paths['/api/items'].get?.parameters as { name: string }[]
    ).map((p) => p.name);
    expect(params).toEqual(
      expect.arrayContaining(['sort', 'kind', 'level', 'limit', 'cursor']),
    );
  });
});
