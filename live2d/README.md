# Character rig PoC

`main` の静止画LPを変更せず、`codex/live2d-rig-poc` でだけ検証する。

## 採用候補

- Runtime: [Anime2.5DRig](https://github.com/852wa/Anime2.5DRig)
- Fixed revision: `d48825867acd081de22b0e7b5585bb562288796d`
- License: MIT
- Input: semantic-layer PSD
- Rendering: client-side WebGL 1

このPoCは公式Live2D Cubism形式ではない。1枚絵をパーツ分けし、WebGLメッシュとスプリング物理でLive2D風に動かす方式を採る。

## 現在の実装（v4）

- 元立ち絵: `source/abc_succubus_live2d_master_v4.png`
- 透過立ち絵: `source/abc_succubus_live2d_cutout_v4.png`
- PSD: `assets/abc_succubus_rig_v4.psd`
- 静止フォールバック: `../assets/character/succubus_STANDEE_live2d_v4.webp`
- 埋め込みプレイヤー: `vendor/anime25d/index.html`
- LP接続: 質問画面の静止画を残したまま、リグ準備完了後だけiframeへクロスフェード
- 失敗時: 静止画を継続表示
- `prefers-reduced-motion`: iframeを非表示にして静止画へ固定
- upstream license: `vendor/anime25d/LICENSE`

表示中のモーションは、まばたき、頭部スウェイ、前髪スプリング、ロングコート裾、呼吸、胸部局所スプリング。ランダム口パクと大きなランダム姿勢変更は記事LPでは無効にしている。

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

## 実機QA

- 375×812: リグ表示、顔・胸の非遮蔽、横overflow 0
- PSD再合成: 可視領域IoU `1.0`、欠損 `0px`、余分 `0px`
- 自動まばたき8秒計測: 開度 `1.000` → `0.00385`、閉眼サンプル8件
- 胸部変形8秒計測: 強度 `3.0`、`-7.23px` → `+6.22px`
- runtime warning: 0、runtime part: 15
- console / page error: 0（faviconのdata URI化後）
- reduced motion: iframe `display:none`、静止画opacity `1`
- 4問回答→ボス→結果: 4回答のreadback一致、横overflow 0

証跡は `qa/live2d-v4-mobile-motion.webm`、`qa/live2d-v4-mobile-open.png`、`qa/live2d-v4-mobile-closed.png`、`qa/live2d-v4-runtime-stress.png`、`qa/live2d-v4-reduced-motion.png`。

強い姿勢入力（angle X `0.65` / Y `-0.5` / Z `0.65` / body `0.7`）でも、顔・首・角・胸元に背景露出やパーツずれがないことを目視確認した。
