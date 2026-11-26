// IT-12: 쓰기 소유권(kok_app=public, kok_ai=ai)이 코드가 아니라 DB 권한으로 강제됨을 증명한다.
import { Client } from 'pg';
import { KokDb, startKokDb } from './support/kok-db';

jest.setTimeout(180_000);

describe('IT-12 DB 권한 경계', () => {
  let db: KokDb;
  let app: Client;
  let ai: Client;

  beforeAll(async () => {
    db = await startKokDb();
    app = await db.client('kok_app');
    ai = await db.client('kok_ai');
  });

  afterAll(async () => {
    await app?.end();
    await ai?.end();
    await db?.stop();
  });

  it('kok_app은 ai 테이블에 쓸 수 없다', async () => {
    await expect(
      app.query(
        `INSERT INTO ai.item_summary (item_id, source_sha256, prompt_version, model, status)
         VALUES (1, 'x', 1, 'm', 'OK')`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('kok_app은 ai 테이블을 직접 읽을 수 없다(계약 뷰만 허용)', async () => {
    await expect(app.query('SELECT * FROM ai.item_summary')).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      app.query('SELECT * FROM ai.v_item_summary_public'),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      app.query('SELECT * FROM ai.v_ai_usage_daily'),
    ).resolves.toMatchObject({ rowCount: 0 });
  });

  it('kok_ai는 public.bookmark를 읽을 수 없다', async () => {
    await expect(ai.query('SELECT * FROM public.bookmark')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('kok_ai는 item·repo·item_source_doc만 읽을 수 있고 쓰지는 못한다', async () => {
    for (const table of ['item', 'repo', 'item_source_doc']) {
      await expect(
        ai.query(`SELECT 1 FROM public.${table}`),
      ).resolves.toBeDefined();
    }
    await expect(
      ai.query(`UPDATE public.item SET name = 'x' WHERE false`),
    ).rejects.toThrow(/permission denied/);
  });
});
