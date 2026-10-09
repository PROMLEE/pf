# 개발·배포 안내

기준일: **2026-10-09**. 이 문서는 저장소의 현재 구성에 맞춘 운영 안내입니다. 사용자 화면 사용법은 [사용자 설명서](USER_GUIDE.md)를 참고하세요.

## 1. 현재 구조

```text
브라우저
  ├─ React 화면 / 잔고 이미지 OCR
  └─ Next.js API 요청
       ├─ NextAuth 세션 → 기존 사용자 ID
       ├─ PostgreSQL portfolio 스키마
       ├─ 한국투자증권 종목 마스터 / Open API
       ├─ 빗썸 공개 KRW API
       └─ Frankfurter / ECB 기준환율
```

화면과 서버 API는 `apps/web`에 있습니다. `apps/api`는 별도 실행 API 서버가 완성된 경로가 아닙니다. DB 접근은 `pg`를 통한 서버 PostgreSQL 연결이며 Supabase Auth나 브라우저 Supabase 클라이언트를 사용하지 않습니다.

인증은 기존 `meet_in_the_middle`과 같은 사용자 식별 구조를 사용합니다. NextAuth의 카카오·네이버 제공자 ID를 `public."User"`에서 조회하거나 생성하고 사용자 ID를 JWT 세션에 넣습니다. 제공자가 다르면 자동 병합하지 않습니다.

## 2. 사전 조건

- Node.js **20 이상**, pnpm.
- 현재 앱의 조회·생성 필드를 가진 기존 `public."User"` 테이블과 제공자 값 구조.
- 해당 DB에 서버에서 접근 가능한 PostgreSQL 연결 문자열.
- 카카오·네이버 개발자 앱의 로그인 설정.
- 주식 시세를 조회할 경우 KIS 실전 앱 키·시크릿.

이 저장소의 자산 SQL은 기존 사용자 테이블을 참조합니다. 새 빈 Supabase 프로젝트에 자산 SQL만 적용하면 사용자 테이블 의존성 때문에 독립적인 인증 서비스가 완성되지 않습니다. 새 계정 시스템을 구성할 때는 [auth.ts](../apps/web/lib/auth.ts)의 `public."User"` 조회·생성 필드와 FK를 먼저 맞춰야 합니다.

## 3. 로컬 실행

저장소 루트에서 실행합니다.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
```

`.env.local`에 실제 값을 설정한 뒤 실행합니다.

```bash
pnpm dev:web
```

[http://localhost:3000](http://localhost:3000)을 사용합니다. 파일 템플릿은 [.env.example](../apps/web/.env.example)입니다. 환경 변수 값은 Git에 커밋하지 않습니다.

### 환경 변수

| 변수 | 용도 |
| --- | --- |
| `DATABASE_URL` | 서버 PostgreSQL 연결 문자열 |
| `AUTH_SECRET` | NextAuth JWT·세션 처리 비밀 값 |
| `NEXTAUTH_URL` | 실행 환경의 앱 주소, 로컬은 `http://localhost:3000` |
| `KAKAO_CLIENT_ID` | 카카오 로그인 앱 ID |
| `KAKAO_CLIENT_SECRET` | 카카오 로그인 시크릿 |
| `NAVER_CLIENT_ID` | 네이버 로그인 앱 ID |
| `NAVER_CLIENT_SECRET` | 네이버 로그인 시크릿 |
| `KIS_APP_KEY` | KIS 현재가 조회 앱 키 |
| `KIS_APP_SECRET` | KIS 현재가 조회 시크릿 |
| `KIS_BASE_URL` | 선택 사항, 기본 KIS 실전 API 주소 |
| `LOCAL_ADMIN_USERNAME` | 선택 사항, 개발 환경 QA 사용자 이름 |
| `LOCAL_ADMIN_PASSWORD` | 선택 사항, 개발 환경 QA 비밀번호 |
| `LOCAL_ADMIN_USER_ID` | 선택 사항, 기존 `GUEST` 사용자 ID |

빗썸 공개 시세와 기준환율 조회에는 별도 키 환경 변수를 사용하지 않습니다. KIS 키가 없으면 주식 API 시세를 조회하지 못하지만 종목 마스터 검색과 캡처 기준 보유 정보는 사용할 수 있습니다.

현재 DB 연결은 SSL 인증서를 검증합니다. 연결 문제를 해결하려고 인증서 검증을 끄는 대신 연결 URL·호스트·인증서·접속 권한을 확인합니다.

## 4. DB 구성 확인

2026-10-09 시점별 기록·삭제 복원 기능에는 다음 두 마이그레이션이 필요합니다. 기존 운영 프로젝트에는 이미 적용했습니다. 새 DB는 아래 기본 자산 스키마를 구성한 뒤 이 두 파일을 순서대로 적용합니다.

1. [timed_history_and_flow_trash.sql](../supabase/migrations/20261009041736_timed_history_and_flow_trash.sql): 입출금 발생/삭제 시각, 시점 기록, 소유자 전용 서버 접근.
2. [bounded_automatic_snapshot_history.sql](../supabase/migrations/20261009042943_bounded_automatic_snapshot_history.sql): 직접 저장은 보존하고 자동 갱신 기록 증가를 제한.

`portfolio.snapshot_events`의 RLS와 클라이언트 권한 차단은 의도된 설정입니다. 브라우저 직접 조회 정책을 추가하지 않습니다. 서버 API가 세션 사용자 ID로 데이터를 제한합니다.

주요 자산 테이블은 [portfolio_schema.sql](../sql/portfolio_schema.sql)에 있습니다. 기존 사용자 테이블이 준비된 새 개발 DB에서는 이 파일을 기준으로 자산 스키마를 구성할 수 있습니다. 기존 운영 DB에서는 적용된 상태와 변경 SQL을 비교해 필요한 변경만 검토합니다.

| SQL 파일 | 목적 |
| --- | --- |
| [portfolio_schema.sql](../sql/portfolio_schema.sql) | 보유 주식·계획·포트·규칙·직접 입력 자산·가상자산·기록의 전체 정의 |
| [portfolio_crypto_assets.sql](../sql/portfolio_crypto_assets.sql) | 기존 DB의 가상자산 테이블 추가 |
| [portfolio_crypto_average_cost.sql](../sql/portfolio_crypto_average_cost.sql) | 기존 가상자산 원화 매입단가 필드 추가 |
| [portfolio_cash_flows.sql](../sql/portfolio_cash_flows.sql) | 환율 시각과 입출금 기록 관련 변경 |
| [portfolio_kis_token_cache.sql](../sql/portfolio_kis_token_cache.sql) | 비공개 KIS 토큰 캐시 |
| [portfolio_snapshot_position_signature.sql](../sql/portfolio_snapshot_position_signature.sql) | 평가 기록의 보유 구성 기준값 |

전체 스키마는 현재 테이블 정의를 포함하지만 예전 테이블의 모든 변경을 한 번에 대체하는 마이그레이션 도구는 아닙니다. SQL 파일을 파일명순으로 전부 실행하는 방법으로 운영 DB를 갱신하지 않습니다.

`portfolio`는 비공개 스키마이며 테이블 RLS가 켜져 있고 `PUBLIC`·`anon`·`authenticated`의 직접 접근을 차단합니다. 서버의 DB 역할이 쿼리를 실행하며 모든 자산 접근에는 로그인 사용자 ID 조건을 사용합니다. 서버 역할의 권한과 API의 사용자 범위 제한을 함께 유지해야 합니다.

`public_rls_lockdown.sql`은 공유 프로젝트의 `public` 테이블까지 다루는 별도 파일입니다. PortRhythm만 구성하기 위해 다른 서비스의 public 테이블 권한을 일괄 변경하는 절차로 사용하지 않습니다.

## 5. 소셜 로그인 설정

현재 공식 서비스 주소는 [https://pf.promleeblog.com](https://pf.promleeblog.com)입니다. 다음 주소를 제공자 앱의 Callback URL에 등록합니다.

```text
카카오: https://pf.promleeblog.com/api/auth/callback/kakao
네이버: https://pf.promleeblog.com/api/auth/callback/naver
```

로컬 로그인도 사용할 경우 실행 환경에 맞는 콜백을 등록합니다.

```text
http://localhost:3000/api/auth/callback/kakao
http://localhost:3000/api/auth/callback/naver
```

배포 환경 변수의 클라이언트 ID·시크릿과 콜백을 등록한 제공자 앱이 같은지 확인합니다. `NEXTAUTH_URL`은 실제 도메인과 프로토콜까지 맞춰야 합니다. 제공자 설정과 배포 환경 변수를 변경했다면 재배포한 환경에서 로그인 요청 주소도 확인합니다.

**같은 사용자 계정 사용**과 **서로 다른 도메인의 로그인 세션 공유**는 별개입니다. 사용자 테이블을 공유해도 기본 쿠키가 다른 호스트에 자동 전달되지는 않습니다. 도메인 간 SSO를 제공한다고 문서나 화면에서 안내하지 않습니다.

## 6. 개발 환경 QA 계정

별도 `GUEST` 사용자 ID를 준비한 뒤 `LOCAL_ADMIN_*` 변수 3개를 개발 `.env.local`에 설정하고 재시작합니다. 개발 로그인 화면의 **로컬 관리자 테스트 로그인**을 사용합니다.

이 로그인 제공자는 `NODE_ENV=development`일 때만 추가되고 `localhost`·`127.0.0.1` 요청에서만 인증합니다. 운영에 새 관리 권한을 주는 기능이 아니라 화면 검수용 로그인입니다. 실제 소셜 계정과 테스트 데이터를 분리하고 자격 증명은 캡처·문서·Git에 담지 않습니다.

## 7. Vercel 배포

1. GitHub 저장소를 연결합니다.
2. **Root Directory**를 `apps/web`으로 선택합니다.
3. Next.js 프레임워크와 `pnpm build` 빌드 명령을 사용합니다.
4. Production 환경 변수에 DB·인증·KIS 설정을 등록합니다.
5. Production의 `NEXTAUTH_URL`을 `https://pf.promleeblog.com`으로 지정합니다.
6. 배포 도메인을 연결하고 제공자 Callback URL과 일치하는지 확인합니다.
7. 로그인 → 자산 조회 → 가격 갱신 → 수정·저장 흐름을 확인합니다.

Preview 배포에서 로그인을 사용할 때도 해당 환경의 URL과 제공자 정책을 함께 맞춰야 합니다. 운영 비밀 값의 불필요한 복제와 공개 로그 출력을 피합니다.

## 8. 코드 검증

```bash
# 타입 검사
pnpm --dir apps/web exec tsc --noEmit -p tsconfig.json

# 운영 빌드
pnpm build:web

# KIS 국내 전일 종가 해석 테스트
pnpm --dir apps/web exec node --test tests/kis-quote-values.test.mjs tests/client-session.test.mjs
```

루트 `pnpm test`는 현재 TODO 안내를 출력하는 초기 스크립트입니다. 전체 테스트가 통과했다는 근거로 사용하지 않습니다. 위 KIS 테스트도 해당 응답 계산만 검증하며 인증·DB·UI 전체 검증을 대신하지 않습니다.

수동 검수는 서로 다른 테스트 사용자 간 데이터 분리, 소셜 로그인, OCR 저장 전 검토, 수량·매입단가·자산 이름 저장, 일간 손익, 배정과 리밸런싱, 모바일 내비게이션을 포함합니다.

## 9. 문제 확인

| 증상 | 우선 확인할 항목 |
| --- | --- |
| 로그인 서비스 설정 오류 | 콜백·`NEXTAUTH_URL`·제공자 앱 ID·시크릿·재배포 |
| 자산 조회·저장 실패 | `DATABASE_URL`, 기존 사용자 ID, 테이블·열 적용, 서버 로그 |
| KIS 조회 실패 | 앱 키·시크릿, 토큰 캐시, 거래소·코드, 요청 제한 |
| 접속마다 토큰 발급 안내 | 캐시 테이블·DB 접근, 같은 키 구성, 만료·발급 로그 |
| 일부 종목 가격 미확인 | 종목코드·거래소, 응답 유효값, 캡처 가격 대체 여부 |
| 환율 조회 실패 | 외부 API 응답, 기준일, 마지막 저장값·수동 모드 |
| 빗썸 가격 미확인 | 지원 KRW 마켓 코드·외부 응답·조회 시각 |

주식 시세는 보유 종목과 후보를 합친 고유 조회 대상이 한 요청에서 30개를 넘으면 현재 API 경로가 제한 메시지를 반환합니다. 많은 후보를 등록한 계정의 가격 조회 문제를 확인할 때 이 제한도 살펴봅니다.

## 10. 문서와 캡처 갱신

실제 동작을 확인한 뒤 [사용자 설명서](USER_GUIDE.md), [기능 기준](FEATURES.md), [FAQ](FAQ.md)를 함께 갱신합니다. 캡처는 운영 자격 증명이나 개인 계좌 대신 QA 데이터로 촬영하고, 문서용 파일만 `docs/screenshots`에 보관합니다. 캡처의 데이터가 저장돼 있는 환경을 그대로 공유하지 않습니다.

### 모바일 세션 복귀 점검

브라우저 세션 조회는 `app/providers.tsx`와 `lib/client-session.ts`에서 처리합니다. NextAuth v4의 기본 조회는 네트워크 오류와 실제 빈 세션을 모두 `null`로 반환하므로, 앱은 `/api/auth/session`의 성공·실패를 직접 구분해 `SessionContext`에 전달합니다. OAuth와 쿠키 발급, 서버 API의 인증 검증은 NextAuth를 사용합니다.

- 네트워크 실패·5xx·잘못된 응답: 기존 세션의 만료 시각까지만 유지하고 제한된 간격으로 재시도.
- 성공한 빈 세션·401: 로그인 상태 해제.
- `visibilitychange`, `pageshow`, `online`, `focus`: 중복 조회를 합쳐 재확인. 화면이 보이고 온라인일 때는 5분마다 확인.
- 다른 탭의 로그아웃 알림: 기존 화면 상태 해제. 계정 변경 시 자산 화면 상태를 초기화.
- 토큰과 세션은 localStorage에 저장하지 않음. API 접근은 서버 세션으로 검증.

실기기에서는 로그인 후 앱 전환 → 복귀, 와이파이·모바일 데이터 전환, 브라우저 탭 종료 → 재접속을 구분해 점검하세요. 브라우저가 쿠키를 삭제한 상황이나 서버의 JWT 해독 오류는 네트워크 재시도만으로 해결되지 않습니다.
