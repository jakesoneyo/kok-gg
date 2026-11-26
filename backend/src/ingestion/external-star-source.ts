// 선택 탑재 외부 스타 출처(OSS Insight). 교차검증 전용 — 증가량 계산에는 쓰지 않는다(ARCHITECTURE 4.3).
// OSS Insight가 2026-12-04 API 종료를 공지했으므로 기본 비활성이고, 종료일 이후엔 설정과 무관하게 스스로 no-op.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { INGEST_CONFIG, type IngestConfig } from './ingest.config';

export interface ExternalDay {
  day: string;
  added: number;
}

@Injectable()
export class ExternalStarSource {
  private readonly logger = new Logger(ExternalStarSource.name);

  /** 테스트가 교체할 수 있게 필드로 둔다(Nest DI는 함수 타입 생성자 인자를 해석하지 못함). */
  fetchImpl: typeof fetch = fetch;

  constructor(@Inject(INGEST_CONFIG) private readonly config: IngestConfig) {}

  /** asOf 기준으로 어댑터가 살아 있는지. 종료일(포함) 이후면 false. */
  isActive(asOf: string): boolean {
    return (
      this.config.externalSource === 'ossinsight' &&
      asOf < this.config.externalUntil
    );
  }

  /**
   * 최근 일별 스타 증가량. 비활성이면 호출 없이 null. 실패해도 null(선택 출처라 수집을 막지 않는다).
   * [미검증] `per=day` 지원과 `stargazers` 필드 의미 — 누적값으로 가정하고 일 차분을 낸다.
   * 600/h/IP 한도는 호출 측이 요일 순환 샘플(≈300/일)로 지킨다.
   */
  async fetchDaily(
    owner: string,
    name: string,
    asOf: string,
  ): Promise<ExternalDay[] | null> {
    if (!this.isActive(asOf)) return null;
    try {
      const res = await this.fetchImpl(
        `https://api.ossinsight.io/v1/repos/${owner}/${name}/stargazers/history?per=day`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as {
        data?: { rows?: { date: string; stargazers: string | number }[] };
      };
      const rows = (body.data?.rows ?? []).map((r) => ({
        day: String(r.date).slice(0, 10),
        total: Number(r.stargazers),
      }));
      return rows
        .slice(1)
        .map((r, i) => ({ day: r.day, added: r.total - rows[i].total }));
    } catch (e) {
      this.logger.warn(`외부 출처 호출 실패: ${(e as Error).message}`);
      return null;
    }
  }
}
