# Post ideas from your own work

Each idea comes from a project or review already in `profile.yml`, so the numbers
are yours: validate accepts them without an outside source, and the fact-checker
checks them against the profile. Keep clients anonymous, as on Lancers, and ask
before using any detail that isn't already public.

## note: for the people who hire you (link to the service page)

| Working title | Built from | Service |
|---|---|---|
| 社内の問い合わせをAIに任せる前に、決めておく3つのこと | rag-docs, ai-saas: show sources, answer 「分からない」, measure with test questions | ai-chatbot |
| Excelの転記・集計を約75%減らしたとき、最初にやったこと | desktop-automation | system |
| 前任者がいなくなったシステム、最初の1週間で確認すること | stress-check review (引き継ぎ, 5 repeat orders) | quality |
| WordPressの更新が怖い会社のための、サイト移行の段取り | wp-real-estate, site-renewal review | wordpress |
| 生成AI導入の見積もりが妥当か、発注前に聞くべき5つの質問 | ai-saas, rag-docs | ai-consulting |
| 配送状況の確認時間を約70%短縮した、電話と管理表をやめるまで | delivery-management | system |

## Zenn / Qiita: for engineers (show you can do the work)

| Working title | Built from | Service |
|---|---|---|
| マルチテナントRAGで、テナント間の情報漏えいを防ぐ設計 | ai-saas | ai-chatbot |
| RAGの回答を「分からない」で止める：根拠不足の判定を実装する | rag-docs | ai-chatbot |
| 評価用の質問セットで、RAGの検索精度を測って改善する | rag-docs | ai-chatbot |
| 機能ごとにばらばらな認可を、OAuth 2.0とRBACで統一する | auth-security | quality |
| PySideとpandasで、現場の人が使えるExcel集計ツールを作る | desktop-automation | system |
| 既存のWordPressにOpenAI APIの機能を足すときの注意点 | stress-check | ai-apps |

Start a post with, for example:

```bash
npm run new -- note ai-faq-before-launch --title "社内の問い合わせをAIに任せる前に、決めておく3つのこと" --hashtags 生成AI,業務効率化 --service ai-chatbot
npm run new -- zenn multitenant-rag-isolation --title "マルチテナントRAGで、テナント間の情報漏えいを防ぐ設計" --topics rag,llm,security --service ai-chatbot
```
