"""PDF 글자 고치기가 심을 글꼴을 정적 자산으로 함께 내보낸다.

글꼴을 저장소에 커밋하지 않는 이유는 데스크톱 EXE 와 같다
(``fetch_desktop_app.sh``) — 한글 글꼴은 한 벌이 2~14MB 이고 바이너리는 델타
압축이 먹지 않아 한 번 커밋하면 git 이력에서 되돌릴 방법이 없다. 이 저장소는
생성물도 제3자 배포물도 추적하지 않는다.

받는 곳은 npm 레지스트리다. Cloudflare 빌드가 이미 ``npm ci`` 로 쓰는 길이라
새로 열 곳이 없다. 판본은 아래 표에 못박는다 — 배포마다 글꼴이 바뀌면 같은
PDF 가 배포 시점에 따라 달라 보인다.

받지 못해도 빌드를 세우지 않는다. 그때 화면은 PDF 기본 라틴 글꼴과 "내 글꼴
불러오기" 로 물러난다 (``converters/web/src/fonts.ts``).
"""
from __future__ import annotations

import json
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

# id · 화면 이름 · npm 패키지@판본 · 패키지 안의 경로 · 갈래 · 배포 라이선스
FONTS = [
    ("noto-sans-kr", "본고딕 (Noto Sans KR)", "@expo-google-fonts/noto-sans-kr@0.4.3",
     "400Regular/NotoSansKR_400Regular.ttf", "고딕", "SIL OFL 1.1"),
    ("noto-sans-kr-bold", "본고딕 굵게", "@expo-google-fonts/noto-sans-kr@0.4.3",
     "700Bold/NotoSansKR_700Bold.ttf", "고딕", "SIL OFL 1.1"),
    ("nanum-gothic", "나눔고딕", "@expo-google-fonts/nanum-gothic@0.4.0",
     "400Regular/NanumGothic_400Regular.ttf", "고딕", "SIL OFL 1.1"),
    ("nanum-gothic-bold", "나눔고딕 굵게", "@expo-google-fonts/nanum-gothic@0.4.0",
     "700Bold/NanumGothic_700Bold.ttf", "고딕", "SIL OFL 1.1"),
    ("pretendard", "프리텐다드", "pretendard@1.3.9",
     "dist/public/static/alternative/Pretendard-Regular.ttf", "고딕", "SIL OFL 1.1"),
    ("noto-serif-kr", "본명조 (Noto Serif KR)", "@expo-google-fonts/noto-serif-kr@0.4.3",
     "400Regular/NotoSerifKR_400Regular.ttf", "명조", "SIL OFL 1.1"),
    ("nanum-myeongjo", "나눔명조", "@expo-google-fonts/nanum-myeongjo@0.4.1",
     "400Regular/NanumMyeongjo_400Regular.ttf", "명조", "SIL OFL 1.1"),
    ("d2coding", "D2Coding", "d2coding@1.3.2", "src/d2coding.ttf", "고정폭", "SIL OFL 1.1"),
]

SFNT_SIGNATURES = (b"\x00\x01\x00\x00", b"OTTO", b"true")
LICENSE_FILE = re.compile(r"(LICENSE|OFL)([.-].*)?", re.IGNORECASE)


def name_table(data: bytes) -> dict[int, str]:
    """글꼴이 제 안에 적어 둔 이름·저작권·라이선스.

    npm 패키지가 담은 LICENSE 파일을 그대로 쓰면 안 된다 — ``@expo-google-fonts``
    는 **래퍼의 MIT** 를 담고 있고 글꼴의 OFL 이 아니다. 글꼴 자신이 적어 둔
    것이 유일하게 믿을 수 있는 고지다.
    """
    if len(data) < 12:
        return {}
    count = struct.unpack_from(">H", data, 4)[0]
    start = None
    for i in range(count):
        tag, _checksum, offset, _length = struct.unpack_from(">4sIII", data, 12 + i * 16)
        if tag == b"name":
            start = offset
            break
    if start is None or start + 6 > len(data):
        return {}

    _format, records, storage = struct.unpack_from(">HHH", data, start)
    found: dict[int, str] = {}
    for i in range(records):
        pid, _eid, lid, nid, length, offset = struct.unpack_from(">HHHHHH", data, start + 6 + i * 12)
        at = start + storage + offset
        raw = data[at:at + length]
        try:
            text = raw.decode("utf-16-be") if pid in (0, 3) else raw.decode("latin-1")
        except UnicodeDecodeError:
            continue
        # 영어(en-US) 항목을 우선한다. 없으면 먼저 본 것을 쓴다.
        if nid not in found or (pid == 3 and lid == 0x409):
            found[nid] = text.strip()
    return found


def notice_for(label: str, license_name: str, names: dict[int, str]) -> str:
    lines = [f"{label} — {names.get(4) or names.get(1) or label}", ""]
    for key in (0, 13, 14):  # 저작권 · 라이선스 설명 · 라이선스 주소
        if names.get(key):
            lines.append(names[key])
    lines += ["", f"배포 라이선스: {license_name}. 전문은 같은 자리의 OFL-1.1.txt 를 보세요."]
    return "\n".join(lines) + "\n"


def ofl_body(text: str) -> str:
    """OFL 전문만 잘라 낸다.

    패키지의 LICENSE 파일은 그 글꼴의 저작권 줄로 시작한다. 그대로 담으면 여덟
    글꼴 전부가 한 사람 것처럼 보인다. 저작권은 글꼴마다 제 고지 파일에 있으니
    여기서는 **모두에게 같은 부분** 만 남긴다.
    """
    for index, line in enumerate(text.splitlines()):
        if "SIL OPEN FONT LICENSE" in line.upper():
            # 바로 위의 구분선까지 살린다 — 원문의 생김새를 지킨다.
            lines = text.splitlines()
            start = index - 1 if index and set(lines[index - 1].strip()) <= {"-"} and lines[index - 1].strip() else index
            return "\n".join(lines[start:]).strip() + "\n"
    return text


def install(work: Path) -> bool:
    packages = sorted({spec for _, _, spec, _, _, _ in FONTS})
    # 윈도우에서 npm 은 ``npm.cmd`` 다. shell 없이 부르면 이름 그대로 찾다가
    # WinError 2 로 죽으므로 PATHEXT 까지 보는 which 로 실제 경로를 집는다.
    npm = shutil.which("npm")
    if npm is None:
        print("    npm 을 찾지 못했습니다. 화면은 라틴 기본 글꼴로 물러납니다.")
        return False
    print("    npm 에서 글꼴 받는 중…")
    try:
        subprocess.run([npm, "init", "-y"], cwd=work, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run([npm, "install", "--no-audit", "--no-fund", "--no-save",
                        "--loglevel=error", *packages], cwd=work, check=True,
                       stdout=subprocess.DEVNULL, timeout=900)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as error:
        print(f"    글꼴을 받지 못했습니다 ({error}). 화면은 라틴 기본 글꼴로 물러납니다.")
        return False
    return True


def main() -> int:
    out = Path(__file__).resolve().parent.parent / "public" / "fonts"
    if out.exists():
        shutil.rmtree(out)

    with tempfile.TemporaryDirectory() as temp:
        work = Path(temp)
        if not install(work):
            return 0

        out.mkdir(parents=True, exist_ok=True)
        catalog, ofl = [], None
        for key, label, spec, inside, group, license_name in FONTS:
            package = spec.rsplit("@", 1)[0]
            source = work / "node_modules" / package / inside
            if not source.is_file():
                print(f"    건너뜀: {label} — 패키지 안에 {inside} 이(가) 없습니다.")
                continue
            data = source.read_bytes()
            # sfnt 서명만 본다. 반쯤 받은 파일을 배포하면 화면에서 글꼴을 심다 죽는다.
            if data[:4] not in SFNT_SIGNATURES:
                print(f"    건너뜀: {label} — TrueType·OpenType 파일이 아닙니다.")
                continue

            (out / f"{key}.ttf").write_bytes(data)
            (out / f"{key}.LICENSE.txt").write_text(
                notice_for(label, license_name, name_table(data)), encoding="utf-8")
            catalog.append({"id": key, "label": label, "group": group, "file": f"{key}.ttf",
                            "bytes": len(data), "license": license_name,
                            "notice": f"{key}.LICENSE.txt"})
            print(f"    {label} {len(data) / 1048576:.1f}MB")

            # OFL 전문은 모든 글꼴이 같다. 전문을 담은 패키지에서 한 번만 가져온다.
            if ofl is None:
                for candidate in (work / "node_modules" / package).rglob("*"):
                    if not candidate.is_file() or not LICENSE_FILE.fullmatch(candidate.name):
                        continue
                    text = candidate.read_text(encoding="utf-8", errors="replace")
                    if "SIL OPEN FONT LICENSE" in text.upper():
                        ofl = ofl_body(text)
                        break

        if not catalog:
            print("    담을 글꼴이 없습니다. 화면은 라틴 기본 글꼴로 물러납니다.")
            shutil.rmtree(out, ignore_errors=True)
            return 0
        if ofl is None:
            # 전문 없이 내보내면 OFL 의 재배포 조건을 지키지 못한다. 반쪽으로 내보내지 않는다.
            print("    OFL 전문을 찾지 못해 글꼴을 담지 않습니다. 화면은 라틴 기본 글꼴로 물러납니다.")
            shutil.rmtree(out, ignore_errors=True)
            return 0

        (out / "OFL-1.1.txt").write_text(ofl, encoding="utf-8")
        (out / "fonts.json").write_text(
            json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        total = sum(font["bytes"] for font in catalog) / 1048576
        print(f"    글꼴 {len(catalog)}종 / 합계 {total:.0f}MB (OFL 전문 포함)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # noqa: BLE001 - 무엇이 터지든 배포를 막지 않는다
        # 글꼴은 있으면 좋은 것이다. 디스크가 찼든 패키지 모양이 바뀌었든,
        # 그것 때문에 사이트가 안 올라가서는 안 된다. 화면은 라틴 기본 글꼴로
        # 물러나고 빌드는 계속한다.
        print(f"    글꼴을 담지 못했습니다 ({type(error).__name__}: {error}). "
              "화면은 라틴 기본 글꼴로 물러납니다.")
        sys.exit(0)
