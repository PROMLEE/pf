# 검색 노출 설정

## 검색 대상

- 서비스 소개: https://pf.promleeblog.com/about
- 사용 가이드: https://pf.promleeblog.com/guide

두 페이지는 사이트맵에 포함하고 `index, follow`와 정규 URL(canonical)을 지정합니다. 실제 변경 시각을 별도로 관리하지 않으므로 사이트맵에 생성 시각을 임의의 `lastmod`로 넣지 않습니다.

로그인·개인 자산 화면(`/`, `/?view=...`), 관리자(`/admin`) 등 나머지 페이지는 공통 메타데이터의 `noindex, follow`를 상속합니다. 관리자 페이지를 robots.txt로 막지 않으므로 크롤러가 noindex를 읽을 수 있습니다. 실제 데이터 접근은 로그인·서버 권한 검사로 보호하며 검색 설정이 접근 통제를 대체하지 않습니다.

API는 robots.txt에서 수집을 제한하고 응답에도 `X-Robots-Tag: noindex, nofollow`를 설정합니다.

## 배포 후 Google Search Console 등록

1. Google Search Console에서 `pf.promleeblog.com` 도메인 또는 `https://pf.promleeblog.com/` URL 접두어 속성을 선택합니다.
2. 소유권을 확인합니다. 도메인 속성은 DNS TXT 인증을 사용합니다. 사이트맵 등록만으로 소유권 인증이 되지는 않습니다.
3. 사이트맵 메뉴에서 `https://pf.promleeblog.com/sitemap.xml`을 제출합니다.
4. `/about`, `/guide`를 URL 검사하고 필요하면 색인 생성을 요청합니다.

등록은 Google 계정과 속성 권한이 필요한 별도 작업입니다. 사이트맵을 배포했다고 제출·색인이 완료된 것은 아닙니다.

## 확인 주소

- https://pf.promleeblog.com/sitemap.xml
- https://pf.promleeblog.com/robots.txt

사이트맵에는 공개 안내 페이지 두 개만 있어야 합니다. 소개·가이드에는 `index, follow`, 개인 자산·관리자에는 `noindex, follow`가 표시되어야 합니다.
