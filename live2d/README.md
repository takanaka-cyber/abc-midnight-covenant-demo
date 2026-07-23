# Character rig PoC

`main` の静止画LPを変更せず、`codex/live2d-rig-poc` でだけ検証する。

## 採用候補

- Runtime: [Anime2.5DRig](https://github.com/852wa/Anime2.5DRig)
- Fixed revision: `d48825867acd081de22b0e7b5585bb562288796d`
- License: MIT
- Input: semantic-layer PSD
- Rendering: client-side WebGL 1

このPoCは公式Live2D Cubism形式ではない。1枚絵をパーツ分けし、WebGLメッシュとスプリング物理でLive2D風に動かす方式を採る。

## 必須モーション

1. 目が完全に閉じる自然な自動まばたき
2. 呼吸に伴う肩・胸郭の小さな上下
3. 髪先と衣装裾の遅れて追従する揺れ
4. 胸部の独立スプリング揺れ
5. 全身のごく小さな左右スウェイ

胸部は全身拡縮や呼吸だけで代替しない。`topwear` の胸部頂点へ局所変形を掛け、呼吸・身体角度・揺り戻しから独立したスプリング状態を持たせる。

## 停止条件

- 顔の輪郭が崩れる
- まばたきが閉眼に見えない
- 胸ではなく胴体全体がゴムのように伸縮する
- 髪・衣装・肌の境界に穴や背景の露出が出る
- 375px幅で30fpsを継続して下回る
- `prefers-reduced-motion` で静止表示に切り替わらない

## 作業順

1. 元立ち絵を意味レイヤーへ分解
2. PSD再合成と元画像の差分を確認
3. 自動メッシュ・ピボットを生成
4. まばたき、呼吸、髪・衣装、胸の順に単体検証
5. LPへ組み込み、静止フォールバックと負荷を検証
