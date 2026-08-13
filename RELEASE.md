# 빌드 및 릴리즈

내부망 배포용 Tabby 포크의 빌드/릴리즈 절차입니다. 업스트림 문서는 [HACKING.md](HACKING.md)를 참고하세요.

- 저장소: `https://github.com/jooyoung-mirae/tabby.git`
- 기준 업스트림: `v1.0.235`

---

## 1. 버전 체계

이 포크는 업스트림과 **동일한 semver 태그 규칙**을 씁니다. 별도의 포크 표식은 쓰지 않습니다.

```
v<major>.<minor>.<patch>
```

| 태그 | 최종 버전 | 의미 |
|---|---|---|
| `v1.0.236` | `1.0.236` | 내부 릴리즈 1차 |
| `v1.0.237` | `1.0.237` | 내부 릴리즈 2차 |

내부 개정은 **patch 자리를 올려서** 냅니다. 어느 업스트림을 기반으로 했는지는 버전
문자열이 아니라 릴리즈 노트와 이 문서 상단(`기준 업스트림`)에 적습니다.

> **예전 `v1.0.235M1` 표식 규칙에서 넘어왔습니다.** 엄격한 semver가 아니어서
> (`semver.valid('1.0.235M1')` → `null`) 태그를 읽는 도구가 걸려 넘어졌습니다 —
> [.github/workflows/release.yml](.github/workflows/release.yml)의
> `marvinpinto/action-automatic-releases`가 바로 이 이유로 실패했고,
> [scripts/vars.mjs](scripts/vars.mjs)에도 포크 전용 패치가 필요했습니다. 둘 다 원복했습니다.
>
> **기존 `v1.0.235M1` 태그는 로컬·리모트 모두에서 지워야 합니다.** 남겨두면 이후 커밋에서
> `git describe`가 `v1.0.235M1-<n>-g<sha>`를 반환하고, 원복된 `vars.mjs`의
> `semver.inc()`가 여기서 `null`을 돌려줘 `Cannot read properties of null`로 죽습니다.
> 이 파일은 루트 `postinstall`이 import하므로 **`yarn install` 자체가 실패합니다.**

### 동작 원리

버전은 `package.json`이 아니라 **git 태그에서 유도**됩니다.
[scripts/vars.mjs](scripts/vars.mjs)가 `git describe --tags` 결과를 가공하고, 각 빌드
스크립트가 그 값을 electron-builder의 `extraMetadata.version`으로 주입합니다.

```js
version = version.substring(1).trim()   // 앞 한 글자(v) 제거
version = version.replace('-', '-c')
if (version.includes('-c')) {           // 하이픈이 있으면 "태그 이후 N커밋"으로 판단
    version = semver.inc(version, 'prepatch').replace('-0', `-nightly.${REV ?? 0}`)
}
```

| `git describe` 결과 | 최종 버전 |
|---|---|
| `v1.0.236` | `1.0.236` |
| `v1.0.236-3-gabc1234` | `1.0.237-nightly.0` (태그 이후 3커밋) |

**태그 이름에 하이픈을 넣지 마세요.** 위 로직은 첫 하이픈 뒤를 "태그 이후 커밋"으로
해석하므로 `v1.0.236-rc1` 같은 prerelease 태그도 `1.0.237-nightly.0`이 되어 `rc1`이
사라집니다. 순수한 `v<major>.<minor>.<patch>`만 쓰세요.

### 반드시 알아둘 점

**태그를 새로 달지 않고 커밋만 올리면 버전이 `<patch+1>-nightly.0`이 됩니다.**
`git describe`가 `v...-<커밋수>-g<sha>`를 반환하기 때문입니다. 정식 산출물을 내려면
릴리즈 커밋에 태그를 달아야 합니다.

**이미 태그가 있는 커밋에 새 태그를 겹쳐 달지 마세요.** 한 커밋에 태그가 둘 이상이면
`git describe`가 어느 쪽을 고를지 보장되지 않습니다. 변경사항을 커밋한 **새 커밋**에
태그하세요.

**Windows FileVersion 구분**: 태그는 앞 세 자리만 채우므로, 워크플로가
`BUILD_NUMBER: ${{ github.run_number }}`를 넘겨 4번째 자리를 채웁니다
(`1.0.236.<run_number>`). 같은 태그를 재빌드해도 이 자리로 구분됩니다.
로컬 빌드에서 구분이 필요하면 `BUILD_NUMBER`를 직접 지정하세요.

---

## 2. GitHub Actions로 릴리즈 (권장)

[.github/workflows/build.yml](.github/workflows/build.yml)이 `push`와 `pull_request` 모두에서
동작합니다. macOS / Linux / Windows 빌드가 병렬로 돌고 결과물이 artifact로 올라갑니다.

```bash
# 1) 변경사항 커밋
git add -A
git commit -m "설명"

# 2) 릴리즈 태그: v<major>.<minor>.<patch>  (하이픈·표식 금지)
git tag v1.0.236

# 3) 브랜치와 태그를 각각 push
git push origin master
git push origin v1.0.236
```

태그 push도 `push` 이벤트이므로 워크플로가 실행됩니다.
**Actions → 해당 run → 하단 Artifacts** 에서 내려받으세요.

### 산출물

기본 실행은 **Windows x64 portable zip 하나만** 만듭니다. 빌드 시간을 줄이기 위한 설정입니다.

| Artifact 이름 | 파일 |
|---|---|
| `Windows portable build (x64)` | `tabby-<ver>-portable-x64.zip` |

압축을 푼 폴더가 그대로 실행 환경입니다. `Tabby.exe` 옆에 **`data`** 폴더를 만들어 두면
설정이 `%APPDATA%` 대신 그 안에 저장됩니다 ([app/lib/portable.ts](app/lib/portable.ts)).

> **electron-builder의 `portable` 타깃(단일 exe)을 쓰지 않는 이유**
> 그 타깃은 자기 자신을 임시 폴더에 풀고 거기서 실행하는 자동 압축 해제 exe입니다. 그래서
> (1) `Tabby.exe` 위치가 임시 폴더가 되어 위의 `data` 폴더를 못 찾고,
> (2) 실행할 때마다 앱 전체를 다시 풀었다가 지웁니다 — 이미 떠 있는 인스턴스에 인자만
> 넘기면 되는 `tabby telnet://...` 호출에서도 매번 발생합니다.

관련 설정 (모두 [.github/workflows/build.yml](.github/workflows/build.yml)):

| 항목 | 현재 | 늘리는 방법 |
|---|---|---|
| 빌드 타깃 | `WINDOWS_TARGETS: zip` | `nsis,zip` 로 변경 (설치본 추가) |
| 아키텍처 | x64 | `ARCH` / `RUST_TARGET_TRIPLE` 을 arm64로 변경 |
| macOS / Linux | 건너뜀 | 아래 "전체 플랫폼 빌드" 참고 |

로컬 `node scripts/build-windows.mjs`는 이 변수가 없으면 **세 타깃 모두** 만듭니다.

### 전체 플랫폼 빌드 (macOS / Linux 포함)

macOS·Linux 잡은 기본적으로 실행되지 않습니다. 필요할 때만 수동으로 돌리세요.

**Actions → Package-Build → Run workflow → "Also build macOS and Linux packages" 체크 → Run**

(`workflow_dispatch` 이벤트에서만 `inputs`가 정의되므로, 일반 push에서는 자동으로
건너뛰어집니다.)

### 서명

코드 서명은 자격 증명이 있을 때만 수행됩니다.

- **Windows**: DigiCert Software Trust Manager. `secrets.SM_API_KEY`가 비어 있으면
  `SIGNING_AVAILABLE`이 `false`가 되어 미서명 빌드로 진행됩니다.
  (업스트림 워크플로는 태그 push 시 무조건 서명 경로를 타서, 인증서가 없는 포크에서는
  빌드가 실패했습니다. 이 포크는 시크릿 유무로 분기하도록 수정되어 있습니다.)
- **macOS**: `secrets.CSC_LINK`가 없으면 `forceCodeSigning`이 false가 되어 미서명 진행.

미서명 Windows 빌드는 실행 시 SmartScreen 경고가 뜰 수 있습니다.

### 사전 조건

- **Lint 통과 필수** — `Windows-Build`/`macOS-Build`/`Linux-Build` 모두 `needs: Lint`입니다.
  로컬에서 미리 확인: `yarn run lint`
- **태그를 fetch할 수 있어야 함** — 워크플로는 `fetch-depth: 0`으로 체크아웃합니다.
  `vars.mjs`가 `git describe --tags`를 쓰기 때문에 태그가 없으면 빌드가 즉시 실패합니다.

---

## 3. 로컬 빌드

### 공통 사전 준비

- Node.js 22 (CI 기준. Node 24에서는 네이티브 모듈 빌드가 불안정할 수 있음)
- Yarn 1.x
- Rust 툴체인 — `russh`가 Rust napi 모듈입니다

```bash
rustup target add <타깃 트리플>   # 예: aarch64-apple-darwin, x86_64-pc-windows-msvc
yarn --network-timeout 1000000    # 루트 1회 (내부적으로 app/, web/, 플러그인 13개 설치)
yarn build                        # typings + webpack (메인/렌더러/전 플러그인)
```

`yarn build`는 `build:typings`(플러그인별 `tsc`)와 `build-modules.mjs`(webpack)를 순차 실행합니다.
개발 실행은 `yarn start`, 반복 개발은 `yarn watch`입니다.
(`app/lib` 즉 메인 프로세스 변경은 앱 재시작이 필요합니다.)

### Windows

Windows 머신에서만 가능합니다. **macOS/Linux에서 크로스 빌드는 불가**합니다 —
`electron-builder.yml`에 `npmRebuild: false`가 걸려 있어 electron-builder가 네이티브 모듈을
다시 빌드하지 않고, `node_modules`에 있는 `.node` 바이너리를 그대로 패키징합니다.
호스트에서 설치하면 그게 전부 호스트 플랫폼용이라 실행 즉시 깨집니다.

VS 2022 Build Tools(MSVC)가 필요합니다.

```powershell
npm i -g yarn node-gyp@10.2.0
npm prefix -g | % {npm config set node_gyp "$_\node_modules\node-gyp\bin\node-gyp.js"}
rustup target add x86_64-pc-windows-msvc

$env:ARCH="x64"
$env:RUST_TARGET_TRIPLE="x86_64-pc-windows-msvc"

# NSIS 설치본을 만들려면 필요 (build/installer.nsh가 참조)
curl -sSL -o build/vc_redist.exe "https://aka.ms/vs/17/release/vc_redist.x64.exe"

yarn --network-timeout 1000000
yarn build
node scripts/prepackage-plugins.mjs
node scripts/build-windows.mjs
```

`dist/`에 setup exe, portable exe, portable zip이 생성됩니다.

**Portable만 필요하면** [scripts/build-windows.mjs](scripts/build-windows.mjs)의
`win: ['nsis', 'zip', 'portable']`에서 `'nsis'`를 빼면 됩니다. `vc_redist.exe` 다운로드도
불필요해집니다.

**로컬 portable zip 배포 시 주의**: CI는 빌드 후 별도 단계에서 `vcruntime140.dll`,
`vcruntime140_1.dll`, `msvcp140.dll`을 zip에 넣어줍니다. 로컬 빌드에는 이 과정이 없어서,
VC++ 재배포 패키지가 없는 PC에서는 **스플래시만 뜨고 터미널이 안 뜹니다**
(node-pty 네이티브 모듈이 로드되지 않습니다). 직접 배포할 때는 위 3개 DLL을
`Tabby.exe` 옆에 함께 넣으세요. NSIS 설치본은 vc_redist로 자체 처리합니다.

### macOS

```bash
export ARCH=arm64            # 또는 x86_64
export RUST_TARGET_TRIPLE=aarch64-apple-darwin

yarn build
node scripts/prepackage-plugins.mjs

# CI가 적용하는 워크어라운드 2개 — 없으면 실패할 수 있음
sed -i '' 's/updateInfo = await/\/\/updateInfo = await/g' node_modules/app-builder-lib/out/targets/ArchiveTarget.js
ln -s ../../node_modules/electron app/node_modules

node scripts/build-macos.mjs
```

### Linux

```bash
sudo gem install fpm
sudo apt-get install libfontconfig1-dev libarchive-tools zsh
export ARCH=x64
export RUST_TARGET_TRIPLE=x86_64-unknown-linux-gnu

yarn build
node scripts/prepackage-plugins.mjs
node scripts/build-linux.mjs
```

---

## 4. CLI 실행

터미널에서 Tabby를 열려면 [extras/tabby-cli](extras/tabby-cli)를 PATH에 두세요.
Tabby는 GUI 앱이라 직접 실행하면 셸이 앱 종료까지 반환되지 않는데, 이 스크립트는
분리 실행(`nohup`)하고 개발 체크아웃일 때 `TABBY_DEV=1`도 자동으로 설정합니다.

```bash
ln -s "$PWD/extras/tabby-cli" /usr/local/bin/tabby

tabby telnet://10.0.0.5:2323                    # 기존 창에 새 탭 (기본)
tabby telnet://10.0.0.5:2323 -w                 # 새 창
tabby telnet://10.0.0.5:2323 --title "장비A"     # 탭 제목 지정
tabby ssh://root@10.0.0.5:2222
tabby --help
```

Windows에서는 GUI 서브시스템이라 `Tabby.exe`를 직접 호출해도 프롬프트가 바로 돌아옵니다.

---

## 5. 문제 해결

### `Could not determine version` / `git describe` 실패
태그가 없는 체크아웃입니다. `git fetch --tags` 후 다시 시도하세요.

### `Unable to find electron app`
`yarn build`를 실행하지 않아 `app/dist/main.js`가 없는 상태입니다.

### `Electron failed to install correctly`
`yarn install --ignore-scripts`로 설치해 electron의 install 스크립트가 실행되지 않은 경우입니다.

```bash
cd node_modules/electron && node install.js
```

### `TypeError: stripAnsi is not a function` (eslint, yargs `--help`)
yarn v1이 별칭 스펙(`strip-ansi-cjs@npm:strip-ansi@^6.0.1`)과 일반 스펙(`strip-ansi@^6.0.1`)을
하나의 lockfile 항목으로 병합하면서 `name strip-ansi-cjs`를 붙이는 버그입니다. 그러면
평범한 `strip-ansi@^6` 소비자(`cliui` 등)에게 줄 v6 패키지가 설치되지 않고, 호이스팅된
ESM 전용 v7으로 떨어져 CJS `require()`가 함수 대신 네임스페이스 객체를 받습니다.

`yarn.lock`에서 해당 항목을 별칭용과 일반용 두 개로 분리하고 `name ...-cjs` 줄을 제거한 뒤:

```bash
rm -f node_modules/.yarn-integrity
rm -rf node_modules/strip-ansi node_modules/string-width node_modules/wrap-ansi
yarn install
```

동일 증상이 `string-width-cjs`, `wrap-ansi-cjs`에도 발생합니다.

### 앱이 반응하지 않거나 CLI 명령이 아무 일도 안 함
macOS는 창을 닫아도 앱 프로세스가 남고, 그 프로세스가 single-instance 락을 쥐고 있으면
이후 CLI 실행이 조용히 종료됩니다.

```bash
pgrep -f "electron/dist/Electron.app" | xargs kill -9
```
