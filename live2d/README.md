# Character rig PoC

`main` の静止画LPを変更せず、`codex/free-rig-editor-core` でだけ検証する。

## 採用候補

- Runtime: [Anime2.5DRig](https://github.com/852wa/Anime2.5DRig)
- Fixed revision: `d48825867acd081de22b0e7b5585bb562288796d`
- License: MIT
- Input: semantic-layer PSD
- Rendering: client-side WebGL 1

このPoCは公式Live2D Cubism形式ではない。1枚絵をパーツ分けし、WebGLメッシュとスプリング物理でLive2D風に動かす方式を採る。

## 現在の実装（v7 full-body）

- ユーザー採用元絵: `source/abc_succubus_live2d_master_v5_user_approved.png`
- 透過・デスピル元絵: `source/abc_succubus_live2d_master_v5.png`
- Live2D用レイヤー: `source/v6_layers/`
- PSD: `assets/abc_succubus_rig_v6.psd`
- 分解スクリプト: `tools/segment_approved_v6.py`、`tools/build_exact_head_v6.py`、`tools/build_exact_character_v6.py`
- PSD生成: `tools/write_psd_v6.js`
- 静止フォールバック: `../assets/character/succubus_STANDEE_live2d_v4.webp`
- 埋め込みプレイヤー: `free-rig-studio/?embed=1`
- LP接続: 質問画面の静止画を残したまま、リグ準備完了後だけiframeへクロスフェード
- 失敗時: 静止画を継続表示
- `prefers-reduced-motion`: iframeを非表示にして静止画へ固定
- upstream license: `vendor/anime25d/LICENSE`

v7のFree Rig Studioは、まばたき、口差分、頭部XY/Z、胸郭、肩、腰、左右脚、
髪、左右翼、尾、左右外套、両腕、呼吸、胸部局所スプリングを独立して駆動する。
全身Warpを親に、上半身・腰・頭・肩・翼根・外套根・尾根・脚根を子へ置き、
柔軟部は高密度Meshと複数BoneのSkinningで位相差を作る。

## 必須モーション

1. 目が完全に閉じる自然な自動まばたき
2. 呼吸に伴う肩・胸郭の小さな上下
3. 髪先と衣装裾の遅れて追従する揺れ
4. 胸部の独立スプリング揺れ
5. 全身のごく小さな左右スウェイ

胸部は全身拡縮や呼吸だけで代替しない。`bust_1` / `bust_2` の胸部頂点へ
局所Warpを掛け、呼吸・身体角度・肩運動から独立したスプリング状態を持たせる。

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

## v7ローカルQA

- PSD: 887×1774、28レイヤー、readback成功
- 可視RGB再合成: 欠損 `0px`、余分 `0px`、RGB最大誤差 `0`
- runtime: parts 32 / nodes 48 / params 25 / physics 13 / skin 12 / errors 0
- 全身Idle: 頭・胸郭・肩・腰・脚を別周期で駆動し、髪・翼・尾・外套・腕を物理追従
- 8秒実測: 翼中心 `48–51px`、尾 `21px`、腕 `11–15px`、外套 `2–8px`、脚 `3–4px`
- 変形実測: 翼幅 `77–91px`、尾幅 `49px`、腕幅 `17–20px`、髪幅 `13px`
- 375×812: overflow `0`、記事内stage `373×299`、canvas cover `373×746`
- Canvas直録: 887×1774 / VP9 / 30fps / 299frames、全身10秒
- 強制閉眼: `EyeOpenL 0.027 / EyeOpenR 0.086`で実画面保存
- 記事LPの表情通知: neutral / concerned / serious / smileをiframeで受信
- 既存20テスト: 全件PASS

v7証跡は `output/playwright/v7-article-viewport-375x812.png`、
`output/playwright/v7-fullbody-embedded-375x812.png`、
`output/playwright/v7-fullbody-blink-closed-375x812.png`、
`output/playwright/v7-fullbody-canvas-30fps.webm`。

未完了: 実機での人間による動き評価と、承認後のPages/main反映。
