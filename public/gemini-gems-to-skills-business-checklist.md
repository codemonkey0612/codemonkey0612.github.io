---
title: Gemの指示文をSKILL.mdへ変換し検証するPythonスクリプト
tags:
  - Python
  - Gemini
  - 生成AI
  - zip
private: false
updated_at: '2026-11-12T09:30:08+09:00'
id: c74b02f9383c0a851402
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---
## 困りごと

GeminiのGemがスキルへ移行するため、保存しておいた指示文を、スキルとして再アップロードできる形に整えたくなりました。手作業だと、名前の書式ミスやSKILL.mdの置き場所の間違いが起きやすいです。この記事では、指示文のテキストからSKILL.mdとzipを作り、アップロード前に検証するPythonスクリプトを作ります。

## 前提と確認した仕様

環境は Python 3.10 以上で、標準ライブラリだけで動きます。

スキルの作成方法は、公式ヘルプの [Create & manage skills for Gemini Apps](https://support.google.com/gemini/answer/17094296?hl=en) で確認しました。スクリプトは次の点を前提にしています。

- SKILL.mdか、SKILL.mdを最上位フォルダに含むzipを読み込める
- SKILL.md内のスキル名は、小文字とハイフン区切りにする（例は my-new-skill）
- アップロードできるのはプレーンテキスト系のファイルである
- 対応する拡張子の例として、.txt、.md、.rst、.rtf、.tex、.log が挙げられている

ヘルプには、名前と説明と指示を編集する画面があると書かれています。そのため、SKILL.mdの先頭に name と description を書く形にしました。フロントマターの細かな書式は、アップロード後の確認画面で必ず見てください。

## 手順1：入力ファイルを用意する

指示文は、1つのGemにつき1つのMarkdownファイルに保存してある前提です。ディレクトリ構成は次のとおりです。

```text
estimate-mail/
  instructions.md      # Gemの指示文をそのまま保存したもの
  refs/
    price-list.txt     # 参考資料（テキスト化したもの）
```

## 手順2：変換と検証のスクリプト

次のスクリプトは、名前の検証、参考資料の拡張子チェック、zip作成までを行います。

```python:build_skill.py
import re
import sys
import zipfile
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
TEXT_EXT = {".txt", ".md", ".rst", ".rtf", ".tex", ".log"}


def validate(name: str, src: Path) -> list[str]:
    errors = []
    if not NAME_RE.match(name):
        errors.append(f"名前は小文字とハイフンのみ: {name}")
    if not (src / "instructions.md").is_file():
        errors.append("instructions.md がありません")
    refs = src / "refs"
    if refs.is_dir():
        for p in sorted(refs.rglob("*")):
            if p.is_file() and p.suffix.lower() not in TEXT_EXT:
                errors.append(f"テキスト系以外の資料: {p.name}")
    return errors


def build(name: str, description: str, src: Path, out: Path) -> None:
    body = (src / "instructions.md").read_text(encoding="utf-8").strip()
    skill_md = (
        f"---\nname: {name}\n"
        f"description: {description}\n---\n\n{body}\n"
    )
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        # SKILL.md は zip の最上位に置く
        z.writestr("SKILL.md", skill_md)
        refs = src / "refs"
        if refs.is_dir():
            for p in sorted(refs.rglob("*")):
                if p.is_file():
                    z.write(p, p.relative_to(src).as_posix())


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: build_skill.py <dir> <name> <description>")
        return 2
    src, name, desc = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    errors = validate(name, src)
    if errors:
        print("\n".join(f"NG: {e}" for e in errors))
        return 1
    out = Path(f"{name}.zip")
    build(name, desc, src, out)
    print(f"OK: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

各部分の役割は次のとおりです。

- `NAME_RE` は、小文字の英数字をハイフンでつないだ名前だけを通す
- `validate` は、指示文の有無と参考資料の拡張子の確認役
- `build` は、SKILL.mdを組み立ててzipの最上位に置く役
- 参考資料は `refs/` 以下の相対パスのまま同梱する

説明文に「:」を含める場合は、YAMLとして壊れることがあります。その場合は説明文を引用符で囲んでください。

## 手順3：実行する

```bash
python build_skill.py estimate-mail estimate-mail "見積メールの下書きを作る"
```

名前に日本語や大文字を入れると、`NG:` が出て終了コード1で止まります。複数のGemがあるなら、シェルのループで回せばまとめて作れます。

## 動作確認

zipの中身は、標準ツールで確認できます。

```bash
python -m zipfile -l estimate-mail.zip
```

一覧の先頭付近に `SKILL.md` が最上位のパスで出れば成功です。`estimate-mail/SKILL.md` のように一段下に入っていると、ヘルプの要件を満たしません。

その後、Skillsページの Upload でzipを選びます。確認画面で名前・説明・指示を見て、問題なければ Create を押します。

## つまずきやすい点

- 旧Office形式やPDFは、このスクリプトではエラー扱いとなる。テキストへ変換してから `refs/` に置く
- 参考資料の更新時は、スキル全体を参考ファイルごとアップロードし直す必要がある。ヘルプにその旨の注意がある
- モバイルアプリでは、現時点でアップロード機能が使えないと案内されている。操作はWeb版で行う
- 指示文に社外秘の情報が入っていないか、zipを作る前に目で確認する

## まとめ

Gemの指示文をテキストで保存しておけば、検証付きでSKILL.mdのzipに変換できます。名前の書式、SKILL.mdの位置、参考資料の形式という3点を機械的に確認するだけで、アップロード時の手戻りは減らせます。仕様は変わる可能性があるため、公式ヘルプの最新版も合わせて確認してください。
