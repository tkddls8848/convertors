/**
 * 제3자 고지를 **실제 설치본에서** 만들어 낸다.
 *
 * 손으로 적은 고지는 의존성을 올리는 순간 조용히 어긋난다. 판본이 바뀌어도,
 * 라이브러리가 라이선스를 바꿔도, 새 의존성이 딸려 들어와도 문서는 그대로다.
 * 그렇게 어긋난 고지는 없느니만 못하다 — 지키고 있다고 믿게 만들기 때문이다.
 * 그래서 이 스크립트가 `node_modules` 를 직접 읽어 매번 다시 만든다.
 *
 *   node web/scripts/gen_licenses.mjs
 *
 * 내는 것:
 *   web/public/licenses/<이름>.LICENSE   — 상류 원문 그대로
 *   web/public/licenses/<이름>.NOTICE    — Apache-2.0 의 NOTICE (있으면)
 *   web/public/licenses/index.json       — 화면이 읽어 고지 목록을 그릴 표
 *   THIRD-PARTY-NOTICES.md               — 사람이 읽을 표
 *
 * 담는 것:
 *   1. web/package.json 의 dependencies 와 **거기서 딸려 오는 런타임 의존성**.
 *      직접 적은 것만 담으면 번들에 실제로 실리는 pako·tslib 같은 것이 빠진다.
 *   2. 그 패키지들이 저마다 함께 싣는 제3자 고지. pdfjs-dist 가 대표적이다 —
 *      cmap·기본 글꼴·wasm 이 전부 남의 것이고 제 라이선스가 따로 있다.
 *      개수를 코드에 박지 않고 폴더를 훑는다. 판본이 오르면 늘거나 줄기 때문이다.
 *   3. web/public/fonts/*.LICENSE.txt — 심는 한글 글꼴 (SIL OFL 1.1).
 *   4. web/src/assets/python-hwpx.{LICENSE,NOTICE} — HWPX 쓰는 쪽의 배치 값이
 *      python-hwpx(Apache-2.0) 말뭉치에서 왔다.
 *
 * **못 찾으면 죽는다.** 고지가 빠진 채 배포되는 것이 이 스크립트가 막으려는
 * 사고다. 조용히 넘어가면 아무도 모르고, 아무도 모르는 채로 상용 배포가 나간다.
 * 죽는 자리는 `죽는다()` 를 부르는 곳들이고, 그중 중요한 둘은:
 *   - 라이선스의 흔적을 **하나도** 못 찾은 패키지
 *   - Apache-2.0 인데 전문이 없는 패키지 (4조가 사본 동봉을 의무로 건다)
 *
 * 반대로 전문을 이쪽에서 **대신 적어 넣지는 않는다.** 기억이나 템플릿에서 옮겨
 * 적은 전문은 상류가 실제로 건 조건과 다를 수 있고, 그런 고지는 법적으로 쓸모가
 * 없다. 상류가 전문을 안 내놓으면 배포본에서 확인한 저작권 고지만 그대로 싣고
 * 그 사실을 고지 안에 적는다.
 *
 * **같은 입력이면 같은 출력이다.** 시각을 찍지 않고, 목록을 id 로 정렬하고,
 * 폴더를 훑을 때도 이름순으로 정렬한다 (readdir 순서는 파일시스템이 정한다).
 * 두 번 돌려 `git diff` 가 비지 않으면 그것이 버그다.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const web = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const modules = join(web, 'node_modules');
const outDir = join(web, 'public', 'licenses');

/**
 * 배포물에서 빠지는 자산.
 *
 * `web/pdf-assets.json` 이 "무엇이 실려 나가는가"의 정본이고 빌드
 * (`web/vite.config.ts`)도 같은 파일을 읽는다. 고지는 **실제로 나가는 것**만
 * 말해야 한다 — 싣지 않은 것을 고지하면 거짓이고, 실은 것을 빠뜨리면 위반이다.
 *
 * 지금 빠지는 것은 Liberation 글꼴(GPLv2 + 글꼴 예외)이다.
 */
const 자산정본 = JSON.parse(readFileSync(join(web, 'pdf-assets.json'), 'utf8'));
const 빠지는_이름 = new RegExp(자산정본.excludePattern);
const 빠진다 = 이름 => 빠지는_이름.test(이름);

const 경고 = [];

function 죽는다(말) {
  console.error(`\n[고지 생성 실패] ${말}\n`);
  console.error('고지가 빠진 채로는 배포하지 않는다. 위 원인을 고친 뒤 다시 돌려라.');
  process.exit(1);
}

function 알린다(말) {
  경고.push(말);
  console.warn(`  ! ${말}`);
}

// --- 파일 훑기 ---------------------------------------------------------------

// 라이선스 원문으로 볼 만한 파일 이름. COPYING 은 GNU 계열이 즐겨 쓰는 이름이다.
const 라이선스_이름 = /^(licen[cs]e|copying)([._-].*)?(\.(txt|md|html?))?$/i;
const 고지_이름 = /^notice([._-].*)?(\.(txt|md))?$/i;

/**
 * 폴더 하나를 훑는다.
 *
 * 중첩 `node_modules` 는 들어가지 않는다 — 거기 있는 것은 그 패키지의 의존성이고,
 * 의존성 그래프를 따로 걷고 있으므로 두 번 담긴다.
 */
function 훑는다(root, 걸러낸다) {
  const 찾음 = [];
  const 걷는다 = dir => {
    let 목록;
    try { 목록 = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    // 정렬해야 두 기계에서 같은 순서가 난다.
    const 차례 = [...목록].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const it of 차례) {
      if (it.name === 'node_modules' || it.name.startsWith('.')) continue;
      const path = join(dir, it.name);
      if (it.isDirectory()) 걷는다(path);
      else if (it.isFile() && 걸러낸다(it.name)) 찾음.push(path);
    }
  };
  걷는다(root);
  return 찾음;
}

const 읽는다 = path => readFileSync(path, 'utf8');
const 해시 = text => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** 파일 이름으로 쓸 수 있게 다듬는다. `@pdf-lib/fontkit` → `pdf-lib-fontkit`. */
const 이름표 = name => name.replace(/^@/, '').replace(/[\\/]/g, '-').replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * 어떤 폴더에 실제로 놓여 있는 것들의 이름.
 *
 * 고지 하나가 폴더 하나를 덮을 때, 사람이 알고 싶은 것은 "그래서 무슨 파일이
 * 나가는가" 다. cmaps 처럼 수백 개인 곳이 있으니 앞쪽만 보이고 나머지는 센다.
 */
function 곁에있는것(dir, 최대 = 24) {
  let 목록;
  try { 목록 = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const 이름들 = 목록
    // 배포에서 빠진 파일은 여기 적지 않는다. 고지는 실제로 나가는 것만 말한다.
    .filter(it => it.isFile() && !라이선스_이름.test(it.name) && !고지_이름.test(it.name) && !빠진다(it.name))
    .map(it => it.name)
    .sort();
  if (!이름들.length) return null;
  return 이름들.length > 최대
    ? [...이름들.slice(0, 최대), `…외 ${이름들.length - 최대}개`]
    : 이름들;
}

// --- 라이선스 갈래 알아보기 ---------------------------------------------------

/**
 * 원문을 보고 어느 라이선스인지 **짐작한다.**
 *
 * 함께 실려 오는 고지(pdfjs-dist 의 cmap·글꼴·wasm)는 package.json 이 없어
 * SPDX 값을 물어볼 데가 없다. 짐작은 표를 그릴 때만 쓰고 원문을 대신하지
 * 않는다 — index.json 의 `licenseSource` 가 짐작인지 아닌지를 밝힌다.
 *
 * 카피레프트(GPL 계열)를 알아보는 것이 이 함수의 진짜 일이다. 이 저장소는
 * 상용 비공개라, GPL 조건이 걸린 것이 함께 실려 나가는지는 사람이 알아야 한다.
 */
const 갈래표 = [
  [/GNU\s+(LESSER\s+)?GENERAL\s+PUBLIC\s+LICEN[CS]E/i, 'GPL 계열'],
  [/SIL\s+OPEN\s+FONT\s+LICENSE/i, 'OFL-1.1'],
  [/Apache\s+License[\s\S]{0,80}Version\s+2\.0/i, 'Apache-2.0'],
  [/CC0\s+1\.0\s+Universal/i, 'CC0-1.0'],
  [/Permission\s+is\s+hereby\s+granted,\s+free\s+of\s+charge/i, 'MIT 계열'],
  [/Redistribution\s+and\s+use\s+in\s+source\s+and\s+binary\s+forms/i, 'BSD 계열'],
  [/Permission\s+to\s+use,\s+copy,\s+modify,\s+and(\/or)?\s+distribute/i, 'ISC/0BSD 계열'],
];

function 짐작한다(text) {
  // 하나만 집지 않고 걸리는 것을 전부 잇는다. 한 파일에 여러 라이선스가 담긴
  // 경우가 실제로 있다 — pdfjs-dist 의 wasm/LICENSE_JBIG2 는 PDFium 의 BSD 와
  // Apache-2.0 전문을 함께 담는다. 첫 줄만 보고 하나로 적으면 나머지를 숨긴다.
  const 걸린것 = 갈래표.filter(([무늬]) => 무늬.test(text)).map(([, 이름]) => 이름);
  return 걸린것.length ? 걸린것.join(' + ') : null;
}

const 카피레프트 = text => /GNU\s+(LESSER\s+)?GENERAL\s+PUBLIC\s+LICEN[CS]E/i.test(text);
const 아파치 = spdxId => /apache/i.test(spdxId ?? '');

// --- 전문이 없을 때 쓸 증거 ---------------------------------------------------

/**
 * README 의 라이선스 절을 그대로 떠 온다.
 *
 * 전문을 배포하지 않는 패키지가 있다. 그때 상류가 남긴 유일한 문장이 여기다.
 */
function readme절(dir) {
  for (const name of ['README.md', 'readme.md', 'README.markdown', 'README']) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const 줄 = 읽는다(path).split('\n');
    const 시작 = 줄.findIndex(l => /^#{1,6}\s*licen[cs]e\b/i.test(l));
    if (시작 < 0) continue;
    const 깊이 = (줄[시작].match(/^#+/) ?? ['#'])[0].length;
    let 끝 = 줄.length;
    for (let i = 시작 + 1; i < 줄.length; i += 1) {
      const m = 줄[i].match(/^(#+)\s/);
      if (m && m[1].length <= 깊이) { 끝 = i; break; }
    }
    const 본문 = 줄.slice(시작, 끝).join('\n').trim();
    if (본문) return { text: 본문, source: `${name} 의 라이선스 절` };
  }
  return null;
}

/**
 * 배포본 첫머리의 주석에서 저작권 고지를 떠 온다.
 *
 * MIT 가 보존하라는 것이 바로 이 저작권 고지다. 전문 파일이 없어도 이 블록은
 * 실제로 사용자에게 배포되는 코드 안에 들어 있으니 원문으로서 힘이 있다.
 */
function 머리말주석(dir, meta) {
  const 후보들 = [meta.module, meta.main, 'index.js', 'dist/index.js'].filter(Boolean);
  for (const 후보 of 후보들) {
    const path = join(dir, 후보);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    // 첫 주석 덩어리 **하나만** 떠 온다. 빈 줄을 건너뛰며 이어 붙이면 그 아래의
    // API 설명 주석까지 딸려 와 고지 파일에 저작권과 상관없는 글이 섞인다.
    // 다만 `/* */` 안의 빈 줄은 같은 덩어리이므로 거기서는 끊지 않는다.
    const 모은다 = [];
    let 블록안 = false;
    for (const l of 읽는다(path).split('\n')) {
      const t = l.trim();
      if (블록안) {
        모은다.push(l);
        if (t.includes('*/')) 블록안 = false;
        continue;
      }
      if (t.startsWith('/*')) {
        모은다.push(l);
        if (!t.includes('*/')) 블록안 = true;
        continue;
      }
      if (t.startsWith('//') || t.startsWith('#')) { 모은다.push(l); continue; }
      break;
    }
    const 본문 = 모은다.join('\n').trim();
    // 저작권 표시가 없으면 라이선스 고지가 아니라 그냥 주석이다.
    if (본문 && /copyright|\(c\)|©/i.test(본문)) return { text: 본문, source: `${후보} 의 머리말 주석` };
  }
  return null;
}

/** 전문이 없는 패키지를 위해, 상류가 남긴 것만 모아 고지 문서를 짠다. */
function 부분고지(entry, 증거) {
  const 머리 = [
    `${entry.name} ${entry.version}`,
    `SPDX: ${entry.license ?? '(package.json 에 없음)'}`,
  ];
  if (entry.author) 머리.push(`저작권자(package.json): ${entry.author}`);
  if (entry.contributors) 머리.push(`기여자(package.json): ${entry.contributors}`);
  if (entry.homepage) 머리.push(`프로젝트: ${entry.homepage}`);
  if (entry.repository && entry.repository !== entry.homepage) 머리.push(`저장소: ${entry.repository}`);
  return [
    ...머리,
    '',
    '-'.repeat(78),
    '상류가 라이선스 전문을 배포하지 않는다. 아래는 배포본에서 확인한 저작권 고지',
    '원문이며, 전문은 위 주소에서 확인할 수 있다.',
    '',
    '전문을 이쪽에서 대신 적어 넣지 않는다. 기억이나 템플릿에서 옮겨 적은 전문은',
    '상류가 실제로 건 조건과 다를 수 있고, 어긋난 고지는 없느니만 못하다.',
    '',
    `확인한 자리: ${증거.source}`,
    '-'.repeat(78),
    '',
    증거.text,
    '',
  ].join('\n');
}

// --- 의존성 훑기 --------------------------------------------------------------

const 글자 = v => String(v ?? '');

function 사람(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return [v.name, v.email && `<${v.email}>`, v.url && `(${v.url})`].filter(Boolean).join(' ');
}

function 주소(v) {
  if (!v) return '';
  const url = typeof v === 'string' ? v : 글자(v.url);
  return url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
}

function spdx(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license === 'object') return 글자(pkg.license.type);
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map(l => 글자(l.type)).filter(Boolean).join(' OR ');
  return '';
}

const 웹pkg = JSON.parse(읽는다(join(web, 'package.json')));
const 직접 = Object.keys(웹pkg.dependencies ?? {}).sort();
if (!직접.length) 죽는다('web/package.json 에 dependencies 가 없다. 읽는 자리가 맞는지 보라.');

/**
 * 직접 적은 것에서 시작해 **런타임 의존성 그래프**를 넓힌다.
 *
 * devDependencies 는 담지 않는다 — 번들에 실리지 않으므로 사용자에게 배포되지
 * 않는다. 반대로 여기서 나오는 것은 실릴 수 있으니 전부 담는다. 실제로 pako 는
 * pdf-lib 를 타고 들어와 번들에 들어간다.
 */
const 패키지 = new Map();

function 넓힌다(name, 끌고온이) {
  if (패키지.has(name)) return;
  const dir = join(modules, ...name.split('/'));
  if (!existsSync(join(dir, 'package.json'))) {
    죽는다(`${name} 이 node_modules 에 없다 (${dir}). 의존성을 설치한 뒤 다시 돌려라.`);
  }
  const meta = JSON.parse(읽는다(join(dir, 'package.json')));
  패키지.set(name, { name, dir, meta, 끌고온이 });
  for (const dep of Object.keys(meta.dependencies ?? {}).sort()) 넓힌다(dep, name);
}

for (const name of 직접) 넓힌다(name, null);

// --- 구성요소를 모은다 --------------------------------------------------------

const 구성요소 = [];
const 낼파일 = new Map();   // 파일이름 → 내용

function 낸다(파일, 내용) {
  if (낼파일.has(파일) && 낼파일.get(파일) !== 내용) {
    죽는다(`고지 파일 이름이 겹친다: ${파일}. 이름 짓는 규칙을 고쳐라.`);
  }
  낼파일.set(파일, 내용);
}

console.log('=== 제3자 고지를 만든다');
console.log(`  설치본: ${modules}`);

for (const name of [...패키지.keys()].sort()) {
  const { dir, meta, 끌고온이 } = 패키지.get(name);
  const id = 이름표(name);
  const 선언 = spdx(meta);

  // 이 패키지가 담은 라이선스·고지 파일을 전부 찾는다. 루트의 것이 제 것이고,
  // 하위 폴더의 것은 함께 싣고 있는 남의 것이다.
  // 배포에서 빠진 자산의 고지는 담지 않는다 (예: LICENSE_LIBERATION).
  const 라이선스들 = 훑는다(dir, n => 라이선스_이름.test(n) && !빠진다(n));
  const 고지들 = 훑는다(dir, n => 고지_이름.test(n) && !빠진다(n));
  const 루트 = p => !relative(dir, p).includes(sep);

  const 전문경로 = 라이선스들.find(루트) ?? null;
  const 전문 = 전문경로 ? 읽는다(전문경로) : null;

  const entry = {
    id,
    name,
    version: 글자(meta.version),
    license: 선언 || null,
    licenseSource: 선언 ? 'package.json' : 'content-sniff',
    kind: 직접.includes(name) ? 'npm' : 'npm-transitive',
    via: 끌고온이,
    author: 사람(meta.author),
    contributors: (meta.contributors ?? []).map(사람).filter(Boolean).join(', '),
    homepage: 글자(meta.homepage),
    repository: 주소(meta.repository),
  };

  let 본문;
  let full = true;
  let textSource;

  if (전문) {
    본문 = 전문;
    textSource = `node_modules/${name}/${relative(dir, 전문경로).split(sep).join('/')}`;
  } else {
    // Apache-2.0 은 4조가 사본 동봉을 의무로 건다. 대체 경로를 두지 않는다.
    if (아파치(선언)) {
      죽는다(`${name}@${entry.version} 은 ${선언} 인데 라이선스 전문이 없다. `
        + 'Apache-2.0 은 사본 동봉이 의무다 (4조). 설치본이 온전한지 확인하라.');
    }
    const 증거 = readme절(dir) ?? 머리말주석(dir, meta);
    if (!증거) {
      죽는다(`${name}@${entry.version} 에서 라이선스의 흔적을 하나도 찾지 못했다. `
        + 'LICENSE 파일도, README 의 라이선스 절도, 배포본 머리말의 저작권 고지도 없다. '
        + '상류에서 원문을 받아 넣기 전에는 배포할 수 없다.');
    }
    본문 = 부분고지(entry, 증거);
    full = false;
    textSource = `node_modules/${name}/${증거.source}`;
    알린다(`${name}@${entry.version}: 상류가 전문을 배포하지 않는다. 대신 실은 것 — ${증거.source}.`);
  }

  entry.full = full;
  entry.textSource = textSource;
  entry.file = `${id}.LICENSE`;
  if (!선언) entry.license = 짐작한다(본문);
  entry.copyleft = 카피레프트(본문);
  낸다(entry.file, 본문);

  // Apache-2.0 의 NOTICE 는 전파가 의무다. 루트에 있으면 반드시 함께 낸다.
  const 고지경로 = 고지들.find(루트) ?? null;
  if (고지경로) {
    entry.notice = `${id}.NOTICE`;
    entry.noticeSource = `node_modules/${name}/${relative(dir, 고지경로).split(sep).join('/')}`;
    낸다(entry.notice, 읽는다(고지경로));
  } else if (아파치(선언)) {
    // 없는 것이 정상일 수 있다 — NOTICE 는 상류가 둔 경우에만 전파 의무가 생긴다.
    // 그래도 null 로 적어 둔다. 판본이 오르며 생겼는데 못 보고 지나가지 않게.
    entry.notice = null;
  }
  구성요소.push(entry);

  // 이 패키지가 함께 싣는 남의 고지. 개수를 박지 않고 찾은 만큼 담는다.
  const 이미 = new Set([전문 && 해시(전문), 고지경로 && 해시(읽는다(고지경로))].filter(Boolean));
  for (const path of [...라이선스들, ...고지들]) {
    if (루트(path)) continue;
    const 내용 = 읽는다(path);
    const h = 해시(내용);
    // 같은 내용을 두 자리에 둔 것뿐이면(xlsx/LICENSE 와 xlsx/dist/LICENSE) 한 번만 낸다.
    if (이미.has(h)) continue;
    이미.add(h);

    const 조각 = relative(dir, path).split(sep);
    const base = 조각.pop();
    const 꼬리 = base
      .replace(/^(licen[cs]e|notice|copying)/i, '')
      .replace(/^[._-]+/, '')
      .replace(/\.(txt|md|html?)$/i, '');
    const 하위id = `${id}-${[...조각, 꼬리].filter(Boolean).join('-') || h.slice(0, 8)}`;
    const 자리 = [...조각, base].join('/');

    const sub = {
      id: 하위id,
      // 조사를 붙이지 않는다. 패키지 이름이 무엇으로 끝날지 모르는데 "이/가" 를
      // 코드로 고르면 절반은 틀린 문장이 된다.
      name: `${name} 에 함께 실린 것: ${자리}`,
      version: 글자(meta.version),
      license: 짐작한다(내용),
      licenseSource: 'content-sniff',
      kind: 'npm-bundled',
      via: name,
      author: '',
      contributors: '',
      homepage: entry.homepage,
      repository: entry.repository,
      full: true,
      textSource: `node_modules/${name}/${자리}`,
      file: `${하위id}.LICENSE`,
      copyleft: 카피레프트(내용),
      // 이 고지가 덮는 자산이 어디에 있는지. pdfjs-dist 의 cmap·기본 글꼴·wasm·ICC 는
      // 코드가 아니라 런타임이 이름으로 찾아 읽는 자료라, 번들러가 손대지 않고
      // `/pdf-assets/<폴더>/` 로 그대로 실려 나간다 (web/vite.config.ts).
      covers: 조각.length ? `node_modules/${name}/${조각.join('/')}/` : null,
      // 그 자리에 실제로 무엇이 놓여 있는지. 카피레프트가 걸린 고지를 만났을 때
      // 사람이 "그래서 무슨 파일이 나가는가" 를 바로 볼 수 있어야 한다.
      // 이름만 적는다 — 어느 파일이 어느 고지에 걸리는지는 기계가 알 수 없고,
      // 지어내느니 실린 목록을 그대로 보이는 편이 낫다.
      contents: 조각.length ? 곁에있는것(join(dir, ...조각)) : null,
    };
    낸다(sub.file, 내용);
    구성요소.push(sub);
    if (sub.copyleft) {
      알린다(`${sub.textSource} 가 GPL 계열이다. THIRD-PARTY-NOTICES.md 의 카피레프트 절을 보라.`);
    }
  }
}

// --- 글꼴 --------------------------------------------------------------------

/**
 * 심는 한글 글꼴.
 *
 * `web/public/fonts/` 는 생성물이다 — `web/scripts/fetch_fonts.py` 가 배포할 때
 * npm 에서 받는다 (한 벌이 2~14MB 라 저장소에 담지 않는다). 그래서 비어 있을 수
 * 있고, 비었다고 죽지는 않는다. cf_build.sh 가 글꼴을 먼저 받고 이 스크립트를
 * 돌리므로 배포에서는 늘 차 있다.
 *
 * 다만 **파일이 있는데 읽히지 않으면 죽는다.** 그건 설치가 깨진 것이고, 조용히
 * 넘어가면 글꼴은 실려 나가는데 고지만 빠진다.
 */
const fontsDir = join(web, 'public', 'fonts');
let 글꼴수 = 0;

if (existsSync(fontsDir)) {
  for (const 파일 of readdirSync(fontsDir).filter(n => n.endsWith('.LICENSE.txt')).sort()) {
    let 내용;
    try { 내용 = 읽는다(join(fontsDir, 파일)); }
    catch (e) { 죽는다(`글꼴 고지 ${파일} 이 있는데 읽히지 않는다: ${e.message}`); }
    const 글꼴id = 파일.replace(/\.LICENSE\.txt$/, '');
    const id = `font-${이름표(글꼴id)}`;
    const entry = {
      id,
      name: 내용.split('\n')[0].trim() || 글꼴id,
      version: '',
      license: 짐작한다(내용) ?? 'OFL-1.1',
      // 글꼴 자신이 name table 에 적어 둔 것에서 뽑았다. 래퍼 npm 패키지의
      // LICENSE 는 래퍼의 것이라 글꼴의 고지로 쓸 수 없다 (fetch_fonts.py 참고).
      licenseSource: 'font-name-table',
      kind: 'font',
      via: null,
      author: '',
      contributors: '',
      homepage: 'https://scripts.sil.org/OFL',
      repository: '',
      // 전문이 이 파일에 없다고 빠진 것은 아니다 — 여덟 종이 같은 OFL 1.1 을 쓰므로
      // 전문은 아래 `font-SIL-OFL-1.1.LICENSE` 하나로 함께 낸다.
      full: true,
      fullTextIn: 'font-SIL-OFL-1.1.LICENSE',
      textSource: `web/public/fonts/${파일}`,
      file: `${id}.LICENSE`,
      copyleft: 카피레프트(내용),
      covers: `/fonts/${글꼴id}.ttf`,
    };
    낸다(entry.file, 내용);
    구성요소.push(entry);
    글꼴수 += 1;
  }

  // 글꼴 고지는 전부 "전문은 OFL-1.1.txt 를 보라" 로 끝난다. 그 전문을 함께 내지
  // 않으면 고지가 가리키는 곳이 비어 버린다.
  const ofl = join(fontsDir, 'OFL-1.1.txt');
  if (글꼴수 && !existsSync(ofl)) {
    죽는다(`글꼴 고지 ${글꼴수} 건이 OFL-1.1.txt 를 가리키는데 ${ofl} 이 없다.`);
  }
  if (글꼴수) {
    const 내용 = 읽는다(ofl);
    const entry = {
      id: 'font-SIL-OFL-1.1',
      name: `SIL Open Font License 1.1 (한글 글꼴 ${글꼴수}종이 따르는 전문)`,
      version: '1.1',
      license: 'OFL-1.1',
      licenseSource: 'content-sniff',
      kind: 'font',
      via: null,
      author: '',
      contributors: '',
      homepage: 'https://scripts.sil.org/OFL',
      repository: '',
      full: true,
      textSource: 'web/public/fonts/OFL-1.1.txt',
      file: 'font-SIL-OFL-1.1.LICENSE',
      copyleft: 카피레프트(내용),
      covers: '/fonts/*.ttf',
    };
    낸다(entry.file, 내용);
    구성요소.push(entry);
  }
}

if (!글꼴수) {
  알린다('이번 빌드에 글꼴이 없다 (web/public/fonts 가 비었다). 글꼴 고지를 내지 않는다. '
    + '커밋하기 전이라면 web/scripts/fetch_fonts.py 를 먼저 돌려라.');
}

// --- 저장소가 직접 담고 있는 제3자 자료 ----------------------------------------

/**
 * HWPX 쓰는 쪽의 빈 문서 뼈대와 배치 값이 python-hwpx(Apache-2.0) 에서 왔다.
 * npm 이 아니라 저장소가 직접 담고 있으니 `node_modules` 훑기로는 잡히지 않는다.
 * 빠뜨리면 아무도 눈치채지 못하므로 여기서 이름을 박아 두고, 없으면 죽는다.
 */
const hwpx = {
  license: join(web, 'src', 'assets', 'python-hwpx.LICENSE'),
  notice: join(web, 'src', 'assets', 'python-hwpx.NOTICE'),
};
for (const path of Object.values(hwpx)) {
  if (!existsSync(path)) {
    죽는다(`${path} 가 없다. HWPX 쪽이 python-hwpx 를 쓰는 한 이 고지는 빠질 수 없다.`);
  }
}
{
  const 내용 = 읽는다(hwpx.license);
  const entry = {
    id: 'python-hwpx',
    name: 'python-hwpx (HWPX 빈 문서 뼈대와 배치 값)',
    // npm 판본이 아니라 가져온 커밋이다 (web/src/assets/README.md 가 못박는다).
    version: 'bf40152e5202a55af76f97fe8c2d60eed43f0b00',
    license: 'Apache-2.0',
    licenseSource: 'upstream-license-file',
    kind: 'vendored',
    via: null,
    author: 'airmang',
    contributors: '',
    homepage: 'https://github.com/airmang/python-hwpx',
    repository: 'https://github.com/airmang/python-hwpx',
    full: true,
    textSource: 'web/src/assets/python-hwpx.LICENSE',
    file: 'python-hwpx.LICENSE',
    notice: 'python-hwpx.NOTICE',
    noticeSource: 'web/src/assets/python-hwpx.NOTICE',
    copyleft: 카피레프트(내용),
    covers: 'web/src/assets/Skeleton.hwpx',
  };
  낸다(entry.file, 내용);
  낸다(entry.notice, 읽는다(hwpx.notice));
  구성요소.push(entry);
}

// --- 낸다 --------------------------------------------------------------------

구성요소.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const 종류별 = new Map();
for (const c of 구성요소) {
  const k = c.license ?? '(알 수 없음)';
  종류별.set(k, (종류별.get(k) ?? 0) + 1);
}
const 종류별차례 = [...종류별.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
const 카피레프트목록 = 구성요소.filter(c => c.copyleft);
const 부분목록 = 구성요소.filter(c => !c.full);
const 갈래들 = [...new Set(구성요소.map(c => c.kind))].sort();

const index = {
  generator: 'web/scripts/gen_licenses.mjs',
  schema: 1,
  note: '이 파일은 생성물이다. 손으로 고치지 마라. 시각을 찍지 않으므로 같은 설치본이면 같은 내용이 나온다.',
  counts: {
    total: 구성요소.length,
    byKind: Object.fromEntries(갈래들.map(k => [k, 구성요소.filter(c => c.kind === k).length])),
    byLicense: Object.fromEntries(종류별차례),
    textIncomplete: 부분목록.length,
    copyleft: 카피레프트목록.length,
  },
  components: 구성요소,
};
낸다('index.json', `${JSON.stringify(index, null, 2)}\n`);

mkdirSync(outDir, { recursive: true });

// 지난 실행이 남긴 것을 먼저 치운다. 의존성이 빠졌는데 고지만 남아 있으면 쓰지도
// 않는 라이브러리를 쓴다고 적어 두는 셈이고, 그것도 틀린 고지다.
for (const 있던것 of readdirSync(outDir).sort()) {
  if (낼파일.has(있던것)) continue;
  rmSync(join(outDir, 있던것), { recursive: true, force: true });
  console.log(`  - ${있던것} (더 이상 쓰지 않는다)`);
}

for (const [파일, 내용] of [...낼파일.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  // 줄바꿈은 LF 로 못박는다 (.gitattributes 와 같은 약속). 윈도우에서 돌려 CRLF 가
  // 섞이면 리눅스에서 돌린 기계와 diff 가 어긋나 결정적 생성이 깨진다.
  const 고정 = 내용.replace(/\r\n/g, '\n');
  const path = join(outDir, 파일);
  if (!existsSync(path) || 읽는다(path) !== 고정) writeFileSync(path, 고정, { encoding: 'utf8' });
}

// --- 사람이 읽을 표 -----------------------------------------------------------

const 칸 = v => 글자(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const 링크 = c => `[\`${c.file}\`](web/public/licenses/${c.file})`
  + (c.notice ? ` · [\`${c.notice}\`](web/public/licenses/${c.notice})` : '');

const 묶음 = [
  ['직접 의존하는 npm 패키지', 'npm',
    '`web/package.json` 의 `dependencies`. 번들에 실려 사용자에게 배포된다.'],
  ['딸려 오는 런타임 npm 패키지', 'npm-transitive',
    '위 패키지가 끌고 오는 것. 직접 적지 않았을 뿐 **번들에는 똑같이 실린다** — 이를테면 pako 는 pdf-lib 를 타고 들어온다.'],
  ['패키지가 함께 싣는 제3자 자료', 'npm-bundled',
    'pdfjs-dist 가 대표적이다. cmap·기본 글꼴·wasm·ICC 는 코드가 아니라 런타임이 이름으로 찾아 읽는 자료라 번들러가 손대지 않고 `/pdf-assets/…` 로 그대로 실려 나간다. 각자 제 라이선스가 있다.'],
  ['심는 한글 글꼴', 'font',
    '`web/scripts/fetch_fonts.py` 가 배포할 때 npm 에서 받아 `/fonts/` 로 넣는다. 고지는 글꼴 자신이 제 안에 적어 둔 것에서 뽑았다 — 래퍼 패키지의 LICENSE 는 래퍼의 것이라 글꼴의 고지로 쓸 수 없다.'],
  ['저장소가 직접 담은 제3자 자료', 'vendored',
    'npm 을 거치지 않고 저장소가 들고 있는 것.'],
];

const md = [];
md.push('# 제3자 구성요소 고지 (Third-Party Notices)');
md.push('');
md.push('> **이 목록은 `node web/scripts/gen_licenses.mjs` 가 만든다. 손으로 고치지 마라.**');
md.push('> 손으로 적으면 의존성을 올릴 때 조용히 어긋나고, 어긋난 고지는 없느니만 못하다 —');
md.push('> 지키고 있다고 믿게 만들기 때문이다. 고칠 것이 있으면 그 스크립트를 고치고 다시 돌려라.');
md.push('');
md.push('이 저장소 자체는 상용 비공개다 ([`LICENSE`](LICENSE)). **아래 구성요소에는 그');
md.push('라이선스가 적용되지 않고 각자의 라이선스가 그대로 적용된다.** 원문은 전부');
md.push('[`web/public/licenses/`](web/public/licenses/) 에 함께 배포한다.');
md.push('');
md.push(`구성요소 **${구성요소.length}건**. 라이선스별로는 `
  + 종류별차례.map(([k, v]) => `${k} ${v}건`).join(', ') + '.');
md.push('');

if (카피레프트목록.length) {
  md.push('## ⚠ 카피레프트(GPL 계열)가 섞여 있다');
  md.push('');
  md.push('이 저장소는 상용 비공개인데, 아래 구성요소는 GPL 계열 조건을 달고 함께 배포된다.');
  md.push('**여기서는 사실만 적는다. 법적 판단은 하지 않는다.** 배포 전에 사람이 판단할 일이다.');
  md.push('');
  md.push('| 구성요소 | 고지가 덮는 자리 | 원문 |');
  md.push('| --- | --- | --- |');
  for (const c of 카피레프트목록) md.push(`| ${칸(c.name)} | \`${칸(c.covers ?? '번들')}\` | ${링크(c)} |`);
  md.push('');
  for (const c of 카피레프트목록.filter(x => x.contents)) {
    md.push(`\`${칸(c.covers)}\` 에 놓인 것 — 이 폴더는 통째로 정적 자산이 되어 나간다:`);
    md.push('');
    md.push(c.contents.map(n => `\`${n}\``).join(', '));
    md.push('');
  }
}

if (부분목록.length) {
  md.push('## 상류가 전문을 배포하지 않는 것');
  md.push('');
  md.push('아래는 상류가 라이선스 전문 파일을 담지 않아, 배포본에서 확인한 **저작권 고지');
  md.push('원문**만 실은 것이다. 전문을 이쪽에서 대신 적어 넣지 않는다 — 기억이나 템플릿에서');
  md.push('옮겨 적은 전문은 상류가 실제로 건 조건과 다를 수 있고, 그런 고지는 법적으로');
  md.push('쓸모가 없다. 각 파일 안에 그 사실과 확인한 자리를 적어 두었다.');
  md.push('');
  md.push('| 구성요소 | 선언된 라이선스 | 확인한 자리 |');
  md.push('| --- | --- | --- |');
  for (const c of 부분목록) md.push(`| ${칸(c.name)} | ${칸(c.license)} | \`${칸(c.textSource)}\` |`);
  md.push('');
}

for (const [제목, kind, 설명] of 묶음) {
  const 것들 = 구성요소.filter(c => c.kind === kind);
  if (!것들.length) continue;
  md.push(`## ${제목} (${것들.length})`);
  md.push('');
  md.push(설명);
  md.push('');
  md.push('| 이름 | 판본 | 라이선스 | 원문 |');
  md.push('| --- | --- | --- | --- |');
  for (const c of 것들) {
    const 라이선스 = `${칸(c.license ?? '원문 참조')}`
      + (c.licenseSource === 'content-sniff' ? ' (원문에서 짐작)' : '')
      + (c.full ? '' : ' · 전문 없음');
    md.push(`| ${칸(c.name)} | ${칸(c.version) || '—'} | ${라이선스} | ${링크(c)} |`);
  }
  md.push('');
}

md.push('## 다시 만드는 법');
md.push('');
md.push('```sh');
md.push('node web/scripts/gen_licenses.mjs');
md.push('```');
md.push('');
md.push('같은 설치본이면 같은 결과가 나온다 (시각을 찍지 않는다). 두 번 돌린 뒤');
md.push('`git status --short web/public/licenses THIRD-PARTY-NOTICES.md` 가 비어 있어야 한다.');
md.push('');
md.push('원문을 못 찾으면 이 스크립트는 0 이 아닌 값으로 죽고, `web/scripts/cf_build.sh` 가');
md.push('거기서 빌드를 세운다. 고지가 빠진 채로 나가는 배포를 막는 것이 그 규칙의 목적이다.');
md.push('');

writeFileSync(join(repo, 'THIRD-PARTY-NOTICES.md'), md.join('\n'), { encoding: 'utf8' });

// --- 끝 ----------------------------------------------------------------------

console.log(`  구성요소 ${구성요소.length}건, 파일 ${낼파일.size}개`);
for (const [k, v] of 종류별차례) console.log(`    ${k}: ${v}`);
console.log(`  전문 없이 저작권 고지만 실은 것: ${부분목록.length}건`);
console.log(`  카피레프트(GPL 계열): ${카피레프트목록.length}건`);
if (경고.length) console.log(`  경고 ${경고.length}건 (위를 보라)`);
console.log(`=== 냈다: ${outDir}`);
console.log(`=== 냈다: ${join(repo, 'THIRD-PARTY-NOTICES.md')}`);
