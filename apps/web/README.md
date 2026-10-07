# PortRhythm 웹 앱

서비스: [pf.promleeblog.com](https://pf.promleeblog.com)

PortRhythm의 화면, NextAuth 인증, 자산 관리 API가 들어 있는 Next.js 앱입니다.

## 실행

저장소 루트에서 다음 명령을 사용합니다.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dev:web
```

환경 변수의 값은 [개발·배포 안내](../../docs/SETUP.md)에 따라 설정합니다. 현재 계정 시스템은 NextAuth와 기존 Supabase PostgreSQL의 `public."User"` 테이블을 사용하며 Supabase Auth 로그인은 사용하지 않습니다.

## 문서

- [사용자 설명서](../../docs/USER_GUIDE.md)
- [기능과 계산 기준](../../docs/FEATURES.md)
- [개발·배포 안내](../../docs/SETUP.md)
- [실제 화면 캡처](../../docs/screenshots/README.md)

사용자별 데이터는 비공개 `portfolio` 스키마에 저장되고, 서버 API가 로그인 사용자 ID로 접근 범위를 제한합니다. 잔고 캡처 이미지는 브라우저에서 OCR 처리하며 서버에 업로드하지 않습니다. KIS 키와 DB 연결 정보는 서버 환경 변수로만 설정합니다.
