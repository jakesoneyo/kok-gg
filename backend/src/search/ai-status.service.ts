// FastAPI 마지막 호출 결과를 기억한다. /health가 이 값만 읽어 무료 티어 AI 서비스를 깨우지 않는다.
import { Injectable } from '@nestjs/common';

export type AiStatus = 'ok' | 'down' | 'unknown';

@Injectable()
export class AiStatusService {
  private status: AiStatus = 'unknown';

  /**
   * 마지막 FastAPI 호출 결과. 호출 전에는 'unknown'.
   */
  get(): AiStatus {
    return this.status;
  }

  /**
   * 검색 프록시가 호출 성공/실패를 기록한다. /health는 이 값만 읽는다.
   */
  set(status: Exclude<AiStatus, 'unknown'>): void {
    this.status = status;
  }
}
