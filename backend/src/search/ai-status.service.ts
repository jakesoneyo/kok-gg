// FastAPI 마지막 호출 결과를 기억한다. /health가 이 값만 읽어 무료 티어 AI 서비스를 깨우지 않는다.
import { Injectable } from '@nestjs/common';

export type AiStatus = 'ok' | 'down' | 'unknown';

@Injectable()
export class AiStatusService {
  private status: AiStatus = 'unknown';

  get(): AiStatus {
    return this.status;
  }

  set(status: Exclude<AiStatus, 'unknown'>): void {
    this.status = status;
  }
}
