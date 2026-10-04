# 개인 자산 관리 앱

목표 비중을 직접 설계하고 실제 자산과 비교하는 개인 포트폴리오 앱입니다. 카카오·네이버 로그인은 `meet_in_the_middle`과 같은 NextAuth 설정 및 Supabase PostgreSQL의 사용자 계정을 사용합니다. 자산과 포트폴리오 기록은 같은 Supabase 프로젝트의 비공개 `portfolio` 스키마에 사용자별로 저장됩니다.

## 실행

```bash
pnpm install
pnpm dev:web
```

브라우저에서 http://localhost:3000 을 엽니다. 인증과 데이터베이스 설정은 [웹 앱 안내](apps/web/README.md)를 참고하세요.

## 기능

- 사용자 정의 포트와 목표 비중, 기준환율, 허용 오차
- 종목코드 규칙에 따른 자동 배정과 보유 종목별 수동 배정
- 업비트 원화마켓 가상자산 코드·보유 수량 등록과 현재가 기반 평가액, 현재·목표 비중 차이
- 신규 자금 한도와 제외 종목을 반영한 조정 후 비중, 잔여 자금 확인
- 포트별 일별 평가액과 입출금 기록, 순입금 제외 증감 확인
- 자산 대시보드, 보유 종목 검색·시장 필터, 증권사별 요약, 매입단가 기준 평가손익
- 메리츠 국내·해외 및 미래에셋 국내주식 잔고 캡처 OCR, 저장 전 검토·수정
- 로그인 사용자별 Supabase 저장·삭제와 브라우저 간 동기화
- 한국투자증권 종목 마스터로 국내·미국 종목 코드 확인, Open API 키 설정 시 가격 새로고침

캡처 이미지는 서버에 보내거나 저장하지 않습니다. 포트폴리오 비교에는 사용자가 입력한 USD/KRW 기준환율을 적용합니다. 리밸런싱 수량은 저장된 가격 기준의 추정치이며 주문은 실행하지 않습니다. 증권사 계좌 잔고의 자동 동기화와 CMA/RP·퇴직신탁 가져오기는 아직 지원하지 않습니다.

## Vercel 배포

GitHub 저장소를 Vercel에 연결하고 **Root Directory**를 `apps/web`으로 설정합니다. 빌드 명령은 `pnpm build`입니다. 프로젝트의 Production 환경 변수에 `DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL`, `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `KIS_APP_KEY`, `KIS_APP_SECRET`을 설정합니다. `NEXTAUTH_URL`에는 실제 배포 주소(`https://...`)를 넣고 카카오·네이버 개발자 콘솔에 각 서비스의 `/api/auth/callback/kakao`, `/api/auth/callback/naver` 주소를 등록합니다. 환경 변수 값과 계좌 캡처는 Git에 올리지 않습니다.

화면 글꼴은 [SUIT Variable](https://github.com/sun-typeface/SUIT)을 자체 호스팅합니다. 라이선스 전문은 `apps/web/public/fonts/SUIT-LICENSE.txt`에 있습니다.
