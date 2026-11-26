// 카탈로그 목록 쿼리(정렬 4 × kind 유무 = 인덱스 8개)와 희귀 등급 필터(DANGER)가 실제로 인덱스를 타는지 EXPLAIN으로 확인한다.
// 실행: npx ts-node test/explain-catalog.ts  (Docker 필요 — Testcontainers DB에 2만 항목을 채워 플래너가 현실적인 선택을 하게 함)
import { startKokDb } from './support/kok-db';

const KEYS = {
  trending: 'trend_score_7d',
  stars: 'repo_stars',
  updated: 'repo_pushed_at',
  new: 'first_seen_at',
} as const;

/** 인덱스를 타지 않는 계획(Seq Scan·별도 Sort)을 판별하기 위해 계획 텍스트에서 노드 이름만 뽑는다. */
function summarize(plan: string[]): string {
  const nodes = plan
    .map(
      (l) =>
        l
          .trim()
          .replace(/^->\s*/, '')
          .split('  ')[0],
    )
    .filter((l) => /Scan|Sort|Limit/.test(l));
  return nodes.join(' > ');
}

async function main() {
  const db = await startKokDb();
  const c = await db.client('kok_app');
  try {
    // 저장소 2000 · 항목 20000. 등급 분포: DANGER 3%, CAUTION 15%, SAFE 72%, 미분석 10%.
    await c.query(`
      INSERT INTO repo (github_id, node_id, owner, name, full_name_lower, discovered_via, status, updated_at)
      SELECT g, 'n'||g, 'o'||g, 'r'||g, 'o'||g||'/r'||g, 'MANUAL', 'TRACKED', now()
        FROM generate_series(1, 2000) g`);
    await c.query(`
      INSERT INTO item (repo_id, kind, path, name, source_type, current_level,
                        trend_score_7d, repo_stars, repo_pushed_at, first_seen_at, updated_at)
      SELECT 1 + (g % 2000), (ARRAY['PLUGIN','SKILL','HOOK'])[1 + g % 3]::"ItemKind", 'p'||g, 'item-'||g, 'IN_REPO',
             CASE WHEN r < 0.03 THEN 'DANGER' WHEN r < 0.18 THEN 'CAUTION' WHEN r < 0.90 THEN 'SAFE' END::"RiskLevel",
             random() * 2000, (random() * 50000)::int,
             now() - random() * interval '400 days', now() - random() * interval '90 days', now()
        FROM (SELECT g, random() AS r FROM generate_series(1, 20000) g) s`);
    await c.query('ANALYZE item');

    const rows: { sort: string; kind: string; level: string; scan: string }[] =
      [];
    for (const [sort, key] of Object.entries(KEYS)) {
      for (const kind of [null, 'HOOK']) {
        for (const level of [null, 'DANGER']) {
          // 중간 페이지(커서 있음) 형태 — 첫 페이지보다 OR 조건 때문에 계획이 까다롭다.
          const mid = await c.query(
            `SELECT ${key} AS v, id FROM item WHERE status = 'ACTIVE' ORDER BY ${key} DESC, id DESC OFFSET 10000 LIMIT 1`,
          );
          const { v, id } = mid.rows[0] as { v: Date | number; id: number };
          const params: unknown[] = [v, id];
          let where = `status = 'ACTIVE'`;
          if (kind) where += ` AND kind = '${kind}'`;
          if (level) where += ` AND current_level = '${level}'`;
          where += ` AND (${key} < $1 OR (${key} = $1 AND id < $2))`;
          const res = await c.query(
            `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) SELECT id FROM item WHERE ${where} ORDER BY ${key} DESC, id DESC LIMIT 25`,
            params,
          );
          const plan = res.rows.map(
            (r: Record<string, string>) => r['QUERY PLAN'],
          );
          rows.push({
            sort,
            kind: kind ?? '-',
            level: level ?? '-',
            scan: summarize(plan),
          });
          const exec = plan.find((l) => l.startsWith('Execution Time'));
          console.log(
            `${sort.padEnd(9)} kind=${(kind ?? '-').padEnd(5)} level=${(level ?? '-').padEnd(6)} ${summarize(plan)}  [${exec?.replace('Execution Time: ', '')}]`,
          );
        }
      }
    }
    const bad = rows.filter(
      (r) => !/Index/.test(r.scan) || /Seq Scan/.test(r.scan),
    );
    console.log(
      bad.length
        ? `\n인덱스를 타지 않는 조합 ${bad.length}개`
        : '\n전 조합 인덱스 스캔',
    );
    process.exitCode = bad.length ? 1 : 0;
  } finally {
    await c.end();
    await db.stop();
  }
}

void main();
