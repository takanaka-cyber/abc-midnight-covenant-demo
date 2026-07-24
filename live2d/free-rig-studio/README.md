# Free Rig Studio — core P2

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
- Physics groupの複数Input / Output編集UI
- 描画fpsから独立した固定60Hz Physicsとsubstep診断
- 位相差を持つIdle、自然瞬き、ON/OFFのfade
- `prefers-reduced-motion`時の動作振幅抑制
- 安定node IDによるPSD再import merge
- PSD画像・階層更新時のKeyform / Warp / Mesh / Physics / Glue / Skin保持
- 頂点pair・directional weight・compatibilityを持つGlue
- 階層Bone・parameter angle・vertex weightを持つSkinning
- 高密度Hair meshと隣接Bone間の連続weight配分
- Mesh密度変更を伴う再import時のSkin weight再配分
- 可逆なTexture Atlas生成・再生成・source texture復元
- Atlasの重複・範囲外検証と再import後の自動再生成
- 全Parameter極値での有限頂点監査
- v6キャラの翼・尾・外套・腕・左右胸・4髪層の独立Parts
- 翼・尾・外套・腕の独立spring Physics
- ユーザー採用元絵の可視RGBを保持した分解と、生成した頭部隠れ下地

Glue、Skinning、Texture Atlasの操作概念はLive2D Cubismの公開マニュアルを
参照し、独自JSON schemaと独自評価器として実装している。

- [Glue](https://docs.live2d.com/en/cubism-editor-manual/glue/)
- [Skinning](https://docs.live2d.com/en/cubism-editor-manual/skinning/)
- [Texture Atlas](https://docs.live2d.com/en/cubism-editor-manual/texture-atlas-edit/)

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

- 複数Parameterの2D格子補間
- Glue compatibilityのParameter別Keyform
- Skinning用Mesh自動分割とGlue自動生成
- 複数Texture Atlasと手動配置・回転
- ArtPath
- Undo stack
- Timeline / Graph Editor
- LP runtime用の軽量export

Live2D独自形式の読込・出力や互換性は対象外。
