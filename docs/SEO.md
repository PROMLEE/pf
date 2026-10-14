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

## 검색 의도와 문구 (2026-10-14)

현재 제목·설명에는 한글 브랜드 `포트리듬`, 영문 브랜드 `PortRhythm`과 실제 기능에 맞는 표현을 반영합니다.

| 검색 의도 | 페이지 | 관련 표현 |
| --- | --- | --- |
| 관리 서비스를 찾기 | `/about` | 자산관리, 포트폴리오 관리, 자산 배분, 리밸런싱, 국내·미국 주식·ETF |
| 사용 방법을 찾기 | `/guide` | 목표 비중 설정, 증권 계좌 등록, 자산 수정·배정, 환율 손익, 리밸런싱 수량 |

위 표현은 제품 기능을 기준으로 선정했으며 검색량·경쟁도 조사 결과가 아닙니다. 검색량이 높거나 상위 노출된다고 가정하지 않습니다. 제목뿐 아니라 소개 본문의 주요 설명에도 관련 기능을 자연스럽게 명시합니다. 캐치프라이즈는 유지합니다.

`meta keywords`는 Google의 색인·검색 순위에 사용되지 않으므로 키워드 목록을 나열하는 태그를 추가하지 않습니다. 제목·설명·실제 본문이 일치하도록 관리합니다. Open Graph·Twitter 메타데이터는 링크 공유 미리보기용이며 검색 순위를 직접 올리는 설정으로 취급하지 않습니다.

## 아직 완료되지 않은 검색 성장 작업

- Search Console의 실제 노출·클릭·검색어와 공개 페이지 색인 상태 확인
- 검색량·경쟁도를 확인한 뒤 이용자 질문에 답하는 설명 콘텐츠 보강
- 메인 `/`의 비로그인 랜딩 페이지 전환 여부 결정: 현재 로그인·대시보드 경로이므로 검색 제외를 유지
- 실제 모바일 페이지 성능과 Core Web Vitals 측정 및 개선

사이트맵·메타데이터 설정이 있다고 전체 SEO 최적화나 검색 유입이 검증된 것은 아닙니다.

공식 기준: [Google 지원 메타태그](https://developers.google.com/search/docs/crawling-indexing/special-tags), [검색 결과 설명](https://developers.google.com/search/docs/appearance/snippet).
