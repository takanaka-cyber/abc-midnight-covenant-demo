# Character rig PoC

`main` の静止画LPを変更せず、`codex/free-rig-editor-core` でだけ検証する。

## 採用候補

- Runtime: [Anime2.5DRig](https://github.com/852wa/Anime2.5DRig)
- Fixed revision: `d48825867acd081de22b0e7b5585bb562288796d`
- License: MIT
- Input: semantic-layer PSD
- Rendering: client-side WebGL 1

このPoCは公式Live2D Cubism形式ではない。1枚絵をパーツ分けし、WebGLメッシュとスプリング物理でLive2D風に動かす方式を採る。

## 現在の実装（v13 reward-flow performance）

- ユーザー採用元絵: `source/abc_succubus_live2d_master_v5_user_approved.png`
- 透過・デスピル元絵: `source/abc_succubus_live2d_master_v5.png`
- Live2D用レイヤー: `source/v6_layers/`
- PSD: `assets/abc_succubus_rig_v6.psd`
- 分解スクリプト: `tools/segment_approved_v6.py`、`tools/build_exact_head_v6.py`、`tools/build_exact_character_v6.py`
- PSD生成: `tools/write_psd_v6.js`
- 静止フォールバック: `../assets/character/succubus_STANDEE_live2d_v4.webp`
- 最終設問イベント差分: `../assets/character/succubus_EVENT_bust_press_v2_upper.png`
- 撃破後ご褒美差分: `../assets/character/succubus_REWARD_final_v1.png`
- BGM: `../assets/audio/midnight-covenant-bgm-v1.mp3`
- ご褒美CTA: `../assets/ui/cta-reward-v1.webp`
- 埋め込みプレイヤー: `free-rig-studio/?embed=1`
- LP接続: 質問画面の静止画を残したまま、リグ準備完了後だけiframeへクロスフェード
- 失敗時: 静止画を継続表示
- `prefers-reduced-motion`: iframeを非表示にして静止画へ固定
- upstream license: `vendor/anime25d/LICENSE`

v13のFree Rig Studioは、まばたき、口差分、頭部XY/Z、胸郭、肩、腰、左右脚、
髪、左右翼、尾、左右外套、両腕、呼吸、胸部局所スプリングを独立して駆動する。
全身Warpを親に、上半身・腰・頭・肩・翼根・外套根・尾根・脚根を子へ置き、
柔軟部は高密度Meshと複数BoneのSkinningで位相差を作る。
加えて、500msの表情クロスフェード、音節単位の口開閉・口形、笑顔・誘惑表情、
一回性の頷き・誘導ジェスチャーをLPの会話状態から駆動する。会話中は視線・頭・
肩・腰・腕を連動させ、誘導ジェスチャーでは物理演算後に翼・尾・外套の演技を
加算することで、物理出力によるモーション消失を防ぐ。
最終設問は局所Warpだけに依存せず、ローカルQwen Image Editで新規生成した
「両手で胸を下外側から中央・上方向へ押し上げる」専用イベント差分を3秒表示する。
イベント差分の終了後は通常リグへ戻り、`BustSqueeze`、両腕、胸部スプリング、
翼・尾・外套を連動させた誘惑ジェスチャーを継続する。
最終戦の撃破後は相談メモへ自動遷移しない。別構図で新規生成した前傾・低視点の
ご褒美CGを表示して停止し、画像CTAを押した時だけ相談メモへ進む。
各回答後は好感度上昇画面を約2.1秒保持し、`LILITH AFFECTION +1`と4段階ハートを
表示する。BGMはfal.ai `fal-ai/ace-step`で新規生成した歌なし60秒音源を、
先頭・末尾2秒のクロスフェードとラウドネス調整後、58秒ループとして再生する。
発話口は元PSDの`mouth_open` / `mouth_close`差分を主に使い、口パーツ全体の拡縮を
行わない。口形Warpは小振幅へ制限し、通常・笑顔・誘惑表情の連続フレームで
顔の輪郭とパーツ位置が崩れないことを確認する。

### Cubism標準パラメーターとの対応

このランタイム自体はCubismではなく、内部値は基本的に正規化した`-1..1`を使う。
ただし共有・移植時の意味を揃えるため、[Live2D Cubism Standard Parameter List](https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/)
のID・既定範囲を各パラメーターの`standard`メタデータへ保持する。

| 内部ID | Cubism標準ID | Cubism範囲 |
| --- | --- | --- |
| `AngleX` / `AngleY` / `AngleZ` | `ParamAngleX` / `ParamAngleY` / `ParamAngleZ` | `-30 / 0 / 30` |
| `BodyAngleX` / `BodyAngleY` / `BodyAngleZ` | `ParamBodyAngleX` / `ParamBodyAngleY` / `ParamBodyAngleZ` | `-10 / 0 / 10` |
| `ShoulderMotion` | `ParamShoulderY` | `-10 / 0 / 10` |
| `EyeOpenL` / `EyeOpenR` | `ParamEyeLOpen` / `ParamEyeROpen` | `0 / 1 / 1` |
| `EyeSmileL` / `EyeSmileR` | `ParamEyeLSmile` / `ParamEyeRSmile` | `0 / 0 / 1` |
| `EyeBallX` / `EyeBallY` / `EyeBallForm` | `ParamEyeBallX` / `ParamEyeBallY` / `ParamEyeBallForm` | `-1 / 0 / 1` |
| `MouthOpen` | `ParamMouthOpenY` | `0 / 0 / 1` |
| `MouthForm` | `ParamMouthForm` | `-1 / 0 / 1` |
| `Cheek` | `ParamCheek` | `0 / 0 / 1` |
| `Breath` | `ParamBreath` | `0 / 0 / 1` |
| `Bust` | `ParamBustY` | `-1 / 0 / 1` |
| `HairSwing` / `HairFlutter` | `ParamHairFront` / `ParamHairFluffy` | `-1 / 0 / 1` |

`BustSqueeze`、`HipShift`、翼、尾、外套、腕、脚の二次運動には一致する
Cubism標準IDがないため、
標準IDを偽装せず独自パラメーターとして保持する。

### 会話中の更新順

[Cubism SDKの推奨更新順](https://docs.live2d.com/en/cubism-sdk-manual/model-param-updater/)
を基準に、`自動まばたき → 表情 → 視線 → 呼吸 → 物理 → 口パク → 一回性ポーズ`
の順で合成する。表情はCubism Expression Motionと同じく500msを既定フェードとし、
口パクは`ParamMouthOpenY`と`ParamMouthForm`を音節ごとに変える。

## 必須モーション

1. 目が完全に閉じる自然な自動まばたき
2. 呼吸に伴う肩・胸郭の小さな上下
3. 髪先と衣装裾の遅れて追従する揺れ
4. 胸部の独立スプリング揺れ
5. 全身のごく小さな左右スウェイ
6. 会話中の音節口パクと口形変化
7. 笑顔・誘惑表情の500msクロスフェード
8. 選択時の頷きと最終設問の誘導ジェスチャー
9. 最終設問で両腕を内側へ寄せる胸元強調ポーズと専用イベント差分

胸部は全身拡縮や呼吸だけで代替しない。継ぎ目を作らない単一`bust`の内部頂点へ
局所Warpを掛け、呼吸・身体角度・肩運動から独立したスプリング状態を持たせる。
境界頂点は0変位へ固定し、胸部中心だけを動かす。

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

## v13ローカルQA

- PSD: 887×1774、35レイヤー、readback成功
- 可視RGB再合成: 欠損 `0px`、余分 `0px`、RGB最大誤差 `0`
- runtime: parts 40 / nodes 57 / params 32 / physics 12 / skin 7 / errors 0
- Cubism標準メタデータ: 21パラメーター、公式ID・範囲を実行時readback
- 境界処理: `body_base`の誤配分断片を`74→1`連結成分へ整理し、全可動レイヤーに元絵RGBの4px重なり代を付与
- 翼: 14×18の高密度Meshで細い翼端の三角形分断を防止
- 全身Idle: 頭・胸郭・肩・腰・脚を別周期で駆動し、髪・翼・尾・外套・腕を物理追従
- 原寸887×1774: 中立、実Idle、全パラメーター正負端で背景漏れ・黒線なし
- 375×812: 白・マゼンタ・暗背景、4時点の実Idleで継ぎ目なし
- 375×812: 横overflow 0、発話3口形、誘惑表情・全身ジェスチャーを実画面確認
- 375×812実測: 約119.8fps、frame interval p95 9.9ms、最大10.4ms
- `BustSqueeze`: 5×3局所Warpの外周頂点を固定し、中央だけを持ち上げつつ左右内側へ寄せる
- Q4イベント差分: 新規880×1768生成後、破綻のない顔・押し上げた胸元・両手だけを620×800 RGBAへ正本化
- Q4イベント復帰: 3秒後に通常リグへ戻り、誘惑ジェスチャーを継続
- 好感度画面: 375×812実測で選択後から非表示まで2573ms、`+1`と蓄積ハートを視認
- 撃破後: 880×1768 RGBAの別構図CGで停止し、画像CTA後だけ相談メモへ遷移
- 320×568: ご褒美CG・コピー・画像CTAの横overflow 0
- BGM: MP3 / stereo / 48kHz / 58秒、再生中`paused=false`、volume 0.18、readyState 4
- BGM実測: integrated -20.9 LUFS / LRA 7.1 LU / true peak -2.9 dBFS
- サウンドUI: OFF/ONとも`♫`固定、X・取消線なし、ONは発光と`aria-pressed=true`
- ブラウザconsole: errors 0 / warnings 0
- 自動テスト: 25件全件PASS

継ぎ目QA証跡は `output/playwright/v26-overlap-neutral-887.png`、
`output/playwright/v27-overlap-full-positive-887.png`、
`output/playwright/v27-overlap-full-negative-887.png`、
`output/playwright/v28-idle-white-375-montage.png`、
`output/playwright/v28-background-audit-montage.png`。
会話・表情QA証跡は `output/playwright/v30-talk-open-375x812.png`、
`output/playwright/v30-talk-mouth-montage.png`、
`output/playwright/v30-alluring-375x812.png`、
`output/playwright/v30-alluring-motion-montage.png`。
全身演技の追加証跡は `output/playwright/v31-full-body-invite-montage.png`、
`output/playwright/v31-smile-375x812.png`、
`output/playwright/v31-alluring-full-body-375x812.png`、
`output/playwright/v31-full-body-seam-audit.png`。
発話顔の連続QAは `output/playwright/v32-talk-before-face-collapse.png`、
`output/playwright/v32-talk-fixed-10frames.png`、
`output/playwright/v32-smile-talk-8frames.png`、
`output/playwright/v32-alluring-talk-8frames.png`。
50%チェックポイントと胸元強調差分のQAは
`output/playwright/v34-midpoint-375x812.png`、
`output/playwright/v34-event-pose-magenta.png`、
`output/playwright/v34-event-cut-in-cropped-375x812.png`、
`output/playwright/v34-event-return-cropped-375x812.png`。
v13の好感度・Q4・最終報酬・BGM UIのQAは
`output/playwright/v35-affection-early-375x812.png`、
`output/playwright/v35-q4-bust-reward-375x812.png`、
`output/playwright/v35-final-reward-screen-fixed-375x812.png`、
`output/playwright/v35-final-reward-320x568.png`、
`output/playwright/v35-sound-ui-375x812.png`、
`output/playwright/v35-result-after-reward-375x812.png`。

未完了: 実機での人間による動き評価と、承認後のPages/main反映。
