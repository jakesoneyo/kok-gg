// 무료 티어 콜드 스타트 안내: 요청이 3.5초 넘게 대기 중이면 서버를 깨우는 중임을 알린다.
import { useIsFetching } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export function ColdStartBanner() {
  const fetching = useIsFetching() > 0;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!fetching) return;
    const t = setTimeout(() => setSlow(true), 3500);
    return () => {
      clearTimeout(t);
      setSlow(false); // 요청이 끝나면(= 서버가 깨어남) 다음 요청에는 다시 3.5초 뒤부터 판단
    };
  }, [fetching]);
  if (!fetching || !slow) return null;
  return (
    <div role="status" className="mx-auto mt-3 max-w-[1240px] rounded-2xl bg-caution px-5 py-3 text-[13px] text-caution-ink">
      서버를 깨우는 중입니다. 무료 서버라 첫 요청은 최대 1분쯤 걸릴 수 있어요.
    </div>
  );
}
