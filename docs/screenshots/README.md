# 실제 화면 캡처

촬영일: **2026-10-08 (Asia/Seoul)**. 앱 구현 기준: `a46d6b2`.

실제 PortRhythm을 로컬 프로덕션 빌드로 실행한 뒤 브라우저에서 촬영한 JPEG입니다. 개발 도구 표시가 없는 화면을 사용했으며 합성 UI나 이미지 생성 결과가 아닙니다. 데스크톱은 브라우저 기본 화면 크기, 모바일은 390 × 844 뷰포트로 확인했습니다. 전체 페이지 캡처는 스크롤 영역과 스크롤바 때문에 결과 폭·높이가 달라질 수 있습니다.

## 예시 데이터

- 별도 QA 계정의 애플 10주, 비트코인 0.01개, 원화 현금 500,000원.
- 목표 포트: 미국 지수 35%, 한국 지수 25%, 우량주 20%, 금 10%, 비트코인 10%.
- 매수 후보와 허용 오차는 시연용 설정.
- 보유 수량·매입단가·계좌 구분은 테스트 값이며 실제 개인 계좌 자료가 아닙니다.
- 주식·가상자산 가격은 촬영 중 API 갱신으로 변할 수 있어 화면 간 금액이 완전히 같지는 않습니다.
- `desktop-import.jpg`는 **직접 추가**로 검토 항목을 입력한 화면입니다. 특정 실제 캡처의 OCR 정확도를 보여주는 사례는 아닙니다. 이 예시 항목은 저장하지 않았습니다.

목표 비중·매수 후보·화면의 손익은 제품 설명을 위한 예시이며 투자 추천이나 성과 증빙으로 사용하지 않습니다. 캡처에 개인 이름·계좌번호·OAuth 정보·API 키·토큰·비밀번호를 담지 않았습니다.

## 데스크톱

| 파일 | 내용 | 크기 |
| --- | --- | --- |
| [desktop-login.jpg](desktop-login.jpg) | 브랜드·핵심 기능 문구와 소셜 로그인 | 1280 × 720 |
| [desktop-dashboard.jpg](desktop-dashboard.jpg) | 전체 평가액·손익·종목 목록·비중 요약 | 1265 × 970 |
| [desktop-holdings.jpg](desktop-holdings.jpg) | 시장별 평가액과 주식 보유 목록 | 1280 × 720 |
| [desktop-asset-detail.jpg](desktop-asset-detail.jpg) | 주식 상세·평균 매입단가·계좌별 보유 | 1265 × 940 |
| [desktop-asset-edit.jpg](desktop-asset-edit.jpg) | 주식 수정 펼침·가상자산 매입가·현금 이름 | 1265 × 1206 |
| [desktop-strategy.jpg](desktop-strategy.jpg) | 사용자 정의 포트·목표 비중·허용 오차 | 1265 × 848 |
| [desktop-composition.jpg](desktop-composition.jpg) | 미국 지수를 선택한 도넛 그래프 상세 | 1280 × 720 |
| [desktop-allocation.jpg](desktop-allocation.jpg) | 주식·가상자산·직접 입력 자산 배정 | 1280 × 720 |
| [desktop-3d.jpg](desktop-3d.jpg) | 자산 배정 화면에서 펼친 Three.js 분석 | 1265 × 1104 |
| [desktop-rebalance.jpg](desktop-rebalance.jpg) | 매도 후 매수 제안과 결과 미리보기 | 1265 × 1078 |
| [desktop-candidates.jpg](desktop-candidates.jpg) | 리밸런싱 하단 후보 종목 설정 펼침 | 1265 × 1800 |
| [desktop-import.jpg](desktop-import.jpg) | 주식 직접 추가·저장 전 검토 | 1265 × 882 |
| [desktop-history.jpg](desktop-history.jpg) | 일별 평가액 추이·입출금 기록 펼침 | 1265 × 851 |

## 모바일

`mobile-dashboard-compact.jpg`는 **2026-10-08, `99b2157` 기준**의 추가 캡처입니다. 로컬 개발 서버에서 같은 QA 계정으로 촬영했고 개발 도구를 열지 않았습니다. 수익 토글·정렬 선택과 축소된 상단/종목 여백, 하단 집계 안내를 보여줍니다. 기존 캡처는 위의 초기 구현 기준을 유지합니다.

| 파일 | 내용 | 크기 |
| --- | --- | --- |
| [mobile-dashboard.jpg](mobile-dashboard.jpg) | 핵심 지표·투자 및 현금 목록·하단 탭 | 390 × 844 |
| [mobile-dashboard-compact.jpg](mobile-dashboard-compact.jpg) | 최신 컴팩트 요약·수익 토글·정렬·하단 보조 정보 | 390 × 844 뷰포트 |
| [mobile-crypto-detail.jpg](mobile-crypto-detail.jpg) | 비트코인 수량·매입단가·손익·수정 연결 | 390 × 844 |
| [mobile-composition.jpg](mobile-composition.jpg) | 비중 그래프와 현재·목표 비교 | 375 × 916 |
| [mobile-menu.jpg](mobile-menu.jpg) | 기능별로 분류한 전체 메뉴 | 375 × 1081 |

## 새 캡처로 교체할 때

1. 최신 코드의 실제 앱을 실행하고 QA 계정으로 확인합니다.
2. 로딩·조회 실패·알림이 아닌 해당 기능의 정상 화면을 촬영합니다.
3. 운영 개인 자산·로그인 자격 증명·계좌 캡처 원본을 사용하지 않습니다.
4. 파일명은 유지해 기존 문서 링크를 보존하거나 참조 문서를 함께 수정합니다.
5. 촬영일·코드 기준·크기와 시연 데이터 조건을 이 문서에 갱신합니다.

실제 API 가격은 달라질 수 있으므로 설명서의 계산 예시를 캡처 금액에 종속시키지 않습니다.


## 2026-10-09 리밸런싱 개선 화면

이번 리밸런싱 개선 코드를 로컬 개발 서버에서 실행해 같은 QA 예시 자산으로 촬영했습니다. 개발 표시를 숨겼고 보유 수량·배정·후보 설정은 변경하지 않았습니다. 제외·예산 모드 선택은 화면 내 계산 상태입니다.

| 파일 | 내용 | 이미지 크기 |
| --- | --- | --- |
| [desktop-rebalance-details-20261009.jpg](desktop-rebalance-details-20261009.jpg) | 실제 매도 제안의 가격·환율·계좌·선택 이유 | 1265 × 1087 |
| [mobile-rebalance-budget-20261009.jpg](mobile-rebalance-budget-20261009.jpg) | 빈 신규 자금 입력은 0원, 계산 기준 총액 | 375 × 812 |
| [mobile-rebalance-no-trades-20261009.jpg](mobile-rebalance-no-trades-20261009.jpg) | 모든 주식 매도 제외 후 제안 없음과 구체적 이유 | 375 × 812 |

뷰포트는 데스크톱 1280 × 1100, 모바일 390 × 844로 요청했으며 실제 저장된 이미지 크기는 표와 같습니다. 촬영 중 시세 갱신으로 금액은 화면마다 다를 수 있습니다.

### 2026-10-09 사용자 이해·기록 화면 개선

- `desktop-history-ux-20261009.png`: 1280×900 뷰포트, 기록 차트 점 선택과 집계 범위.
- `mobile-history-ux-20261009.png`: 390×844 뷰포트, 핵심 기록 요약과 날짜·금액 조회.
- 로컬 QA 계정 예시 데이터. 테스트 입출금은 최종 삭제했으며 실사용 자산을 변경하지 않았습니다.

### 2026-10-09 후속 개선

- `mobile-timed-history-20261009.png`: 390×844, 당일의 보존된 시점과 순입금 집계 범위.
- `mobile-asset-editor-20261009.png`: 390×844, 주식 단건 편집 카드와 통화 단위.
- `mobile-detail-allocation-20261009.png`: 390×844, 자산 상세의 계좌별 포트 배정.
- `desktop-timed-history-20261009.png`: 데스크톱 시점별 기록.
- QA 예시 자산으로 검증했으며 임시 입출금은 제거하고 배정은 원래대로 복구했습니다.

### 일 단위 그래프 정리

`mobile-daily-history-20261009.png`: 모바일 금액 눈금을 숨긴 일별 그래프. 점을 누르면 선택 날짜와 평가액을 표시합니다. 시간별 조회는 화면에서 제거했습니다.

`mobile-grouped-input-20261009.png`: 자산 수정의 천 단위 쉼표와 소수점 수량. QA 계정에서 화면 입력만 검증했으며 변경을 저장하지 않았습니다.
