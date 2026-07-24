# Character rig PoC

`main` の静止画LPを変更せず、`codex/free-rig-editor-core` でだけ検証する。

## 採用候補

- Runtime: [Anime2.5DRig](https://github.com/852wa/Anime2.5DRig)
- Fixed revision: `d48825867acd081de22b0e7b5585bb562288796d`
- License: MIT
- Input: semantic-layer PSD
- Rendering: client-side WebGL 1

このPoCは公式Live2D Cubism形式ではない。1枚絵をパーツ分けし、WebGLメッシュとスプリング物理でLive2D風に動かす方式を採る。

## 現在の実装（v6）

- ユーザー採用元絵: `source/abc_succubus_live2d_master_v5_user_approved.png`
- 透過・デスピル元絵: `source/abc_succubus_live2d_master_v5.png`
- Live2D用レイヤー: `source/v6_layers/`
- PSD: `assets/abc_succubus_rig_v6.psd`
- 分解スクリプト: `tools/segment_approved_v6.py`、`tools/build_exact_head_v6.py`、`tools/build_exact_character_v6.py`
- PSD生成: `tools/write_psd_v6.js`
- 静止フォールバック: `../assets/character/succubus_STANDEE_live2d_v4.webp`
- 埋め込みプレイヤー: `vendor/anime25d/index.html`
- LP接続: 質問画面の静止画を残したまま、リグ準備完了後だけiframeへクロスフェード
- 失敗時: 静止画を継続表示
- `prefers-reduced-motion`: iframeを非表示にして静止画へ固定
- upstream license: `vendor/anime25d/LICENSE`

v6のFree Rig Studioは、まばたき、口差分、頭部スウェイ、4層の髪スキニング、翼、尾、外套、腕、呼吸、胸部局所スプリングを独立パラメータで持つ。ランダム口パクと大きなランダム姿勢変更は記事LPでは無効にする。

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

## v6ローカルQA

- PSD: 887×1774、26レイヤー、readback成功
- 可視RGB再合成: 欠損 `0px`、余分 `0px`、RGB最大誤差 `0`
- runtime: parts 30 / params 14 / physics 6 / skin 4 / errors 0
- 自動Idle: 60Hz、106fps、`blink 1`を実測
- 1秒差のIdle 2フレーム: 変化 `46,560px`
- 極値入力で変化確認: 髪、胸、左右翼、腕、外套、尾
- 開眼・閉眼・口開きの実画面拡大スクリーンショットを保存
- 既存20テスト: 全件PASS

v6証跡は `output/playwright/v6-neutral-underlay.png`、`output/playwright/v6-open-closed-despill-qa.png`、`output/playwright/v6-mouth-closed-open-qa.png`、`output/playwright/v6-motion-extreme-despill.png`、`output/playwright/v6-idle-frame-pair.png`。

未完了: v6を375×812の記事LPへ接続した状態での再検証と、可動部の実運用振幅調整。
