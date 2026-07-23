# MIDNIGHT COVENANT

ABCクリニック向け「セクシー × ダークRPG」記事LPの独立PoCです。

## 現在の範囲

- 成人のサキュバス案内人による4問の相談内容整理
- 回答ごとの契約印解放
- 中間クエストマップ
- 「迷いの影」を対象にした短いボス演出
- 回答内容を読み戻す相談メモ
- ABCクリニック公式情報を根拠にした確認事項
- 外部CTAはABCクリニック公式トップのみ

## 明示的に含めないもの

- 診断結果
- 効果保証
- 架空の残り枠・期限・利用者数
- 価格訴求
- 予約API、Lステップ、計測タグ

## 公開先

- GitHub Pages: <https://takanaka-cyber.github.io/abc-midnight-covenant-demo/>
- 公開版は静止画ベースの確定版
- Live2D検証は公開版から分岐した別ブランチで行い、検証前に公開版へ混ぜない

## ローカル確認

静的ファイルだけで動作します。ローカルHTTPサーバー経由で `index.html` を開いてください。

## 画像アセット

- 人物: 選定済みの同一キャラクター5点と、同一人物を参照した玉座ポーズのFV v2
- 世界観: built-in imagegenで生成した非人物アセット6点
- タイトル: imagegenで生成したソーシャルゲーム風イベントロゴをクロマキー経由で透過化
- 配信用はWebPを参照し、PNG原版も同じフォルダに保持

## 検証

- 375×812: タイトルから相談メモまで完走、横overflow 0、回答4件のreadback一致
- 320×568: タイトルから相談メモまで完走、横overflow 0、回答4件のreadback一致
- キーボード: Tabで開始ボタンへ移動し、Enterで開始可能
- `prefers-reduced-motion`: 粒子停止を確認
- コンソール: error 0 / warning 0
- 静的ファイル: 参照アセットすべてHTTP 200または304
- スクリーンショット: `output/playwright/`

## 参照

- ABCクリニック公式: <https://abc-clinic.com/>
- ABCクリニック治療費一覧: <https://abc-clinic.com/price>
- Web Animations API: <https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API>
- RPGUI: <https://github.com/RonenNess/RPGUI>
