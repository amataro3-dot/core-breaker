# CORE BREAKER — Claudeへの引き継ぎ

このリポジトリをつないだClaudeが最初に読むメモです。ルールの詳細は `docs/spec.md`(仕様書)が基準です。

## 進め方のルール(作る人の希望)

- 作る人はプログラミング初心者。説明はやさしく、1ステップずつ。専門用語は使うたびに説明する
- **「書いて」と言われるまでコードは書かない**(仕様書やこのメモの更新はOK)
- 返答はスマホで読むので短めに
- 遊ぶのも確認するのもスマホ(縦持ち)のみ。PC版は作らない
- スレッドが長くなったら、作る人が新しく立てる。そのときは「GitHubの amataro3-dot/core-breaker をつないで、続きをやって」と言われる
- 本番(main)に直接上げてよい。上げたらGitHub Pagesの反映まで確認して、作る人には「スマホで遊んで確かめるだけ」の状態で渡す
- 決まったことや状況が変わったら、このメモと `docs/spec.md` を更新する

## 公開・環境

- 公開URL: https://muddys-games.com/core-breaker/ (GitHub Pages、main ブランチ、ルート)
- サイト本体: リポジトリ `amataro3-dot.github.io`(Muddy's Games のトップ、運営者情報など)
- Firebase: プロジェクト `core-breaker-ed593`、Realtime Database(シンガポール asia-southeast1)、匿名認証オン(2026-10-26 作成)
  - データベースはロックモードで作成したまま。セキュリティルールは、オンライン部分を作るときに書いて、作る人に貼ってもらう(仕様書12章の方針)
  - 接続設定(公開してよい値):

```js
const firebaseConfig = {
  apiKey: "AIzaSyAf6G1aYL8QDhQHnaJS9xXlaDPTkWinuig",
  authDomain: "core-breaker-ed593.firebaseapp.com",
  databaseURL: "https://core-breaker-ed593-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "core-breaker-ed593",
  storageBucket: "core-breaker-ed593.firebasestorage.app",
  messagingSenderId: "623787285512",
  appId: "1:623787285512:web:ea774e04973834b58705bd"
};
```
- 作りかけのうちは、Muddy's Games のトップページにのせない(AdSense審査のため)

## 今の状態(2026-10-26)

- 仕様が決まり、`docs/spec.md` にまとめた。コードはまだない
- GitHub Pages オン、Firebaseプロジェクト作成済み
- 次にやること: 「書いて」の合図で、仕様書14章の1(縦画面の土台、マップ表示、カメラ、移動とジャンプ)から作る

## 作る側(Claude)への注意

- 他のゲーム(富豪大富豪など)で分かったFirebaseの注意:
  - `update` で、同じ経路の親子(例: `game/x` と `game/x/y`)を同時に書くとエラーになる
  - 配列や空のオブジェクトは、Firebaseから消えて返ることがある(`|| []`、`|| {}` で受ける)
  - 操作は「受付箱(actions)」に書き、ホストが検証して反映する作りにすると食い違いが起きにくい
- 確認は、構文チェック(`node --check`)、Nodeでのロジックテスト、スマホ幅(390×780くらい)の画面確認で行う
