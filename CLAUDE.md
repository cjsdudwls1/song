# 댄스 리플레이 — 작업 맥락 (Claude용)

안무 연습용 모바일 웹/PWA 플레이어. 사용자(저장소 주인)가 여자친구(댄서)에게 쓰게 하려고 만든 개인 프로젝트.
기능·개발 명령은 `README.md`, 실기기 체크리스트는 `docs/DEVICE_TEST.md` 참고. 이 파일은 "지금 어디까지 왔나"만 적는다.

- 응답은 한국어로.
- 수치(BPM 정확도 등)에 대한 주장은 직접 계산·테스트한 것만 말한다. 추정이면 추정이라고 밝힌다.

## 현재 상태 (2026-11-12 기준)

- 저장소 **Public**, 기본 브랜치 **`main`**.
- GitHub Pages Source = **GitHub Actions**. `main`에 푸시하면 `.github/workflows/deploy.yml`이 `npm ci → npm test → npm run build → Pages 배포`.
- 배포 주소: **https://cjsdudwls1.github.io/song/** (200 응답, 타이틀 "댄스 리플레이" 확인).
  첫 화면 로드만 확인했고 기능은 아직 실기기에서 검증 안 됨.
- 공개 전에 키·비밀번호·개인 이메일이 커밋에 없는지 확인함. 커밋 작성자는 `noreply` 주소.
- 커밋 이력: `7d2ec37` MVP 1단계 → `348d49f` 구간 북마크 → `ab876f8` PWA.

## 구조 메모

| 파일 | 역할 |
|---|---|
| `src/main.ts` | UI 전체(약 800줄) |
| `src/player.ts` | 유튜브 IFrame API / HTML5 media 공통 래퍼 |
| `src/loop.ts` | A-B 반복 |
| `src/count.ts` | BPM 탭(`BpmTapper`), `songBpm`(배속 보정), `eightCount`, `countIn` 비프 |
| `src/url.ts` | 유튜브 링크 파싱 |
| `src/storage.ts` | localStorage + IndexedDB(로컬 파일 8개) |
| `public/sw.js`, `manifest.webmanifest` | PWA, Android Web Share Target |

테스트는 vitest(`*.test.ts`), 로컬 Node 22.

## BPM 탭 동작 (`src/count.ts` `BpmTapper`)

- 탭 사이가 2000ms를 넘으면 처음부터 다시 셈.
- 최근 9번만 사용. 3번 미만이면 `null` → **3번째 탭부터 BPM 표시**.
- BPM = 60000 × (탭 수 − 1) / (마지막 − 첫 탭).
- 표시값 = `songBpm(탭BPM, 배속)` = 탭BPM ÷ 배속 반올림.
- 사용자에게는 "8~9번 이상 탭, 틀리면 2초 쉬고 다시"라고 안내함.

## 남은 일 / 후보

1. **실기기 테스트**: `docs/DEVICE_TEST.md` 26개 항목 결과가 비어 있음. 여자친구 피드백 대기 중.
   특히 #12(0.05 단위 배속 지원 여부), #8(반복 끊김), #21(BPM 정확도) 결과가 다음 개선의 기준.
2. **힌트 문구 불일치**: `index.html` 118행 "탭을 4번 이상" vs 코드는 3번째 탭부터 표시. 문구를 "8번 정도"로 바꾸거나 최소 탭 수를 4로 올리는 것 중 택1(사용자에게 물어볼 것).
3. **Actions 경고**: 배포 로그에 "Node.js 20 actions deprecated"(Node 24로 강제 실행). 배포에는 영향 없음. `actions/*` 버전 올릴 때 같이 정리.
4. **옛 브랜치** `claude/dancer-music-player-mvp-7ga4ps`: `main`과 내용 동일. 지울지는 사용자에게 묻고 결정(임의 삭제 금지).

## 작업 규칙

- 배포 = `main` 푸시. 작업은 브랜치 → PR → 머지.
- 서버·로그인 없음, 데이터는 기기 안에만. 이 원칙을 깨는 기능(계정, 클라우드 동기화)은 먼저 사용자와 상의.
- 유튜브는 공식 IFrame API 임베드로만. 음원 추출·광고 우회 기능은 넣지 않는다.
