# Free Rig Studio — core P1

Live2D Cubismの公開機能を棚卸しした上で、キャラクター品質に直結する
データ構造だけをブラウザ上へ再構成する検証実装。

Live2Dの独自ファイルを解析・互換実装するものではない。
既存Anime2.5DRigのMITコードはPSD前処理に使用し、描画・階層・Keyform評価は
`free-rig-studio`側のデータ駆動実装で行う。

## 現在の縦切り

- JSONモデルschema v1
- Rotation / Warp / Partの任意親子階層
- Parameterと複数Keyformの補間
- PartのMesh頂点とパラメータ別Mesh offset
- Warp grid offset
- Draw order / Opacity / Visibility
- StencilによるClipping mask
- JSON保存・再読込
- NeutralでのMesh頂点編集
- PSDからのParts・Texture生成
- PSD group hierarchyの保持
- source path由来の安定node ID
- Warp control pointの直接編集とParameter別Keyform保存
- 任意Parameter間を接続するspring Physics group
- Physics groupの追加・削除・設定UI
- 全Parameter極値での有限頂点監査

## 起動

repo rootから:

```bash
python3 -m http.server 4173
```

ブラウザ:

```text
http://127.0.0.1:4173/live2d/free-rig-studio/
```

## 決定的テスト

```bash
node --test live2d/free-rig-studio/tests/core.test.mjs
```

## 現在の制限 / 未実装

- 同一PSD再import時の既存編集内容の自動merge
- Physics UIでの複数input / output行編集
- 複数Parameterの2D格子補間
- Glue / Skinning / ArtPath
- 汎用Physics group authoring UI
- Undo stack
- Timeline / Graph Editor
- Texture Atlas
- LP runtime用の軽量export

これらは機能棚卸しから削除したのではなく、P0の後続として残す。
