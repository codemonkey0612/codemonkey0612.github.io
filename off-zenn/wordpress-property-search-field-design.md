---
title: 物件情報の更新時間を約65%削減した話：WordPress物件検索サイトで最初にやった項目設計
emoji: 🏠
type: tech
topics:
  - wordpress
  - php
  - mysql
  - cms
published: false
---

<!-- autopilot: not published, these checks still failed:
- fact-check (self_claim, unverifiable): 「この2つは別の問題に見えますが、原因は同じことが多いと私は考えます。」 — 意見として述べられており、検証対象外に近いです。
-->

## 冒頭

不動産会社向けの物件検索サイトで、物件情報の更新作業時間を約65%削減しました。私は、画面の工夫より先に「検索条件から逆算して項目を設計する」ことが効くと考えています。この記事は、項目数の多いデータをWordPressで管理・検索させたいエンジニアに向けて、その考え方と実装の骨組みを紹介します。

## 最初の状況：項目が多く、更新も条件検索も使いにくかった

対象は、2016年5月から2017年3月にかけて担当した不動産会社向けのWordPress物件検索サイト構築です。体制はディレクター1名、エンジニア2名、クライアント担当1名の4名でした。私はサイト設計、オリジナルテーマ、カスタム投稿・フィールド設計、検索機能、レスポンシブ、SEO内部対策を担当しました。

課題は2つありました。

- 物件情報の項目が多く、更新が煩雑だった
- エリアや価格帯での条件検索が使いにくかった

この2つは別の問題に見えますが、原因は同じことが多いと私は考えます。「データの持ち方」が整理されていないことです。入力しにくいのは、項目の粒度や型が揃っていないからです。検索しにくいのも、検索に使える形で値が保存されていないからです。

以降の設計例は、私の経験を一般化した考え方と、手元で再現できる実装例です。案件の実コードそのものではない点にご注意ください。

## まず物件種別・価格・所在地・間取り・設備に項目を整理した

このときは、項目を「物件種別・価格・所在地・間取り・設備」の5つの軸で整理しました。

同じ課題に当たったら、私なら項目を次の3つに分類します。

- 絞り込みに使う項目：検索UIで選ばせたいもの
- 表示だけに使う項目：詳細ページに出すだけのもの
- 管理用の項目：社内の整理や掲載可否のためのもの

最初にやるのは、検索画面のワイヤーを書いて「ユーザーが何で絞るか」を確定させることです。そこから逆算して、各項目の保存先と型を決めます。

### 保存先の使い分け

WordPressでは、大きく2つの保存先があります。

- タクソノミー（ターム）：選択肢が有限で、複数物件で共有されるもの
- カスタムフィールド（postmeta）：物件ごとに固有の値や数値

私なら次のように割り当てます。

- 物件種別：タクソノミー（マンション、戸建てなど）
- 所在地：階層タクソノミー（都道府県→市区町村）
- 間取り：タクソノミー（1LDK、2LDKなど）
- 設備：タクソノミー（複数選択、AND検索したい）
- 価格：数値のカスタムフィールド（範囲検索したい）

価格は範囲検索があるので、数値として持つ必要があります。ここが最大の分かれ目です。

## カスタム投稿とカスタムフィールドで管理画面を入力しやすくした

物件は通常の投稿とは性質が違うため、カスタム投稿タイプに分けます。投稿と混ぜると、管理画面もテンプレートも混乱するからです。

### カスタム投稿タイプとタクソノミーの登録

```php:functions.php
<?php
add_action( 'init', function () {
	register_post_type( 'property', array(
		'label'         => '物件',
		'public'        => true,
		'has_archive'   => 'property',
		'menu_icon'     => 'dashicons-building',
		'supports'      => array( 'title', 'editor', 'thumbnail' ),
		'show_in_rest'  => true,
		'rewrite'       => array( 'slug' => 'property' ),
	) );

	$taxes = array(
		'property_type'  => array( '物件種別', false ),
		'property_area'  => array( '所在地', true ),
		'property_layout' => array( '間取り', false ),
		'property_equip' => array( '設備', false ),
	);
	foreach ( $taxes as $slug => $args ) {
		register_taxonomy( $slug, 'property', array(
			'label'             => $args[0],
			'hierarchical'      => true,
			'show_admin_column' => true,
			'show_in_rest'      => true,
			'rewrite'           => array( 'slug' => $slug ),
		) );
	}
} );
```

ポイントは次のとおりです。

- 設備や間取りも `hierarchical => true` にする。管理画面でチェックボックス表示になり、入力が速いためである。
- `show_admin_column` を使うと、一覧画面にタームが列として並ぶ。
- `show_in_rest` を有効にすると、ブロックエディタでもタクソノミーを扱える。

### 数値フィールドの登録とメタボックス

価格は整数で保存します。単位は「万円」に固定し、入力欄の横にも単位を表示します。

```php:functions.php
<?php
add_action( 'init', function () {
	foreach ( array( 'price', 'area_m2', 'built_year' ) as $key ) {
		register_post_meta( 'property', $key, array(
			'type'              => 'integer',
			'single'            => true,
			'show_in_rest'      => true,
			'sanitize_callback' => 'absint',
			'auth_callback'     => function () {
				return current_user_can( 'edit_posts' );
			},
		) );
	}
} );

add_action( 'add_meta_boxes', function () {
	add_meta_box( 'property_spec', '物件スペック', 'property_spec_box', 'property', 'normal', 'high' );
} );

function property_spec_box( $post ) {
	wp_nonce_field( 'property_spec', 'property_spec_nonce' );
	$fields = array(
		'price'      => '価格（万円）',
		'area_m2'    => '専有面積（㎡）',
		'built_year' => '築年（西暦）',
	);
	foreach ( $fields as $key => $label ) {
		printf(
			'<p><label>%s<br><input type="number" min="0" name="%s" value="%s"></label></p>',
			esc_html( $label ),
			esc_attr( $key ),
			esc_attr( get_post_meta( $post->ID, $key, true ) )
		);
	}
}

add_action( 'save_post_property', function ( $post_id ) {
	if ( ! isset( $_POST['property_spec_nonce'] )
		|| ! wp_verify_nonce( $_POST['property_spec_nonce'], 'property_spec' ) ) {
		return;
	}
	if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
		return;
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}
	foreach ( array( 'price', 'area_m2', 'built_year' ) as $key ) {
		if ( isset( $_POST[ $key ] ) && '' !== $_POST[ $key ] ) {
			update_post_meta( $post_id, $key, absint( $_POST[ $key ] ) );
		} else {
			delete_post_meta( $post_id, $key );
		}
	}
} );
```

- `type="number"` は、全角や「万円」などの混入を入力時点で防ぐ。
- nonce、権限、自動保存の3点チェックは省略してはならない。
- 空欄は `delete_post_meta` で消す。空文字を残すと、範囲検索の挙動が読みにくくなる。

### 一覧画面に主要項目を出す

更新作業では、一覧で状態が見えるかどうかが効きます。価格列を足しておくと、開かずに確認できます。

```php:functions.php
<?php
add_filter( 'manage_property_posts_columns', function ( $cols ) {
	$cols['price'] = '価格（万円）';
	return $cols;
} );

add_action( 'manage_property_posts_custom_column', function ( $col, $post_id ) {
	if ( 'price' === $col ) {
		echo esc_html( number_format_i18n( (int) get_post_meta( $post_id, 'price', true ) ) );
	}
}, 10, 2 );
```

更新時間の短縮に効く要素は、一般に次のとおりです。

- 入力欄を使う順に並べる
- 選択式にできるものは選択式にする
- 単位と型を固定して、表記ゆれの修正作業をなくす
- 一覧で確認できるようにして、開く回数を減らす

## 複数条件の絞り込み検索を、項目設計から逆算して実装した

検索は、前節の保存設計がそのままクエリになります。種別・エリア・間取り・設備はtax_query、価格はmeta_queryで処理します。

```php:functions.php
<?php
add_action( 'pre_get_posts', function ( $query ) {
	if ( is_admin() || ! $query->is_main_query() || ! $query->is_post_type_archive( 'property' ) ) {
		return;
	}

	$tax_query = array( 'relation' => 'AND' );
	$single    = array(
		'type'   => 'property_type',
		'area'   => 'property_area',
		'layout' => 'property_layout',
	);
	foreach ( $single as $param => $tax ) {
		if ( ! empty( $_GET[ $param ] ) ) {
			$tax_query[] = array(
				'taxonomy' => $tax,
				'field'    => 'slug',
				'terms'    => sanitize_title( wp_unslash( $_GET[ $param ] ) ),
			);
		}
	}

	if ( ! empty( $_GET['equip'] ) && is_array( $_GET['equip'] ) ) {
		$tax_query[] = array(
			'taxonomy' => 'property_equip',
			'field'    => 'slug',
			'terms'    => array_map( 'sanitize_title', wp_unslash( $_GET['equip'] ) ),
			'operator' => 'AND',
		);
	}
	if ( count( $tax_query ) > 1 ) {
		$query->set( 'tax_query', $tax_query );
	}

	$min = isset( $_GET['price_min'] ) && '' !== $_GET['price_min'] ? absint( $_GET['price_min'] ) : 0;
	$max = isset( $_GET['price_max'] ) && '' !== $_GET['price_max'] ? absint( $_GET['price_max'] ) : PHP_INT_MAX;
	if ( $min > 0 || PHP_INT_MAX !== $max ) {
		$query->set( 'meta_query', array(
			array(
				'key'     => 'price',
				'value'   => array( $min, $max ),
				'type'    => 'NUMERIC',
				'compare' => 'BETWEEN',
			),
		) );
	}
} );
```

要点です。

- 設備は `operator => 'AND'` により、選んだ設備をすべて満たす物件に絞る。
- 価格は `type => 'NUMERIC'` を指定する。文字列比較だと「900」が「2500」より大きいと判定される。
- 入力は `sanitize_title` と `absint` で正規化する。
- `pre_get_posts` を使うと、アーカイブのページネーションや件数表示がそのまま動く。

### 検索フォーム

フォームはGETで送ります。URLを共有でき、SEOの面でも扱いやすいからです。

```php:searchform-property.php
<form method="get" action="<?php echo esc_url( get_post_type_archive_link( 'property' ) ); ?>">
	<?php
	wp_dropdown_categories( array(
		'taxonomy'          => 'property_area',
		'name'              => 'area',
		'value_field'       => 'slug',
		'show_option_all'   => 'エリアを選択',
		'selected'          => isset( $_GET['area'] ) ? sanitize_title( wp_unslash( $_GET['area'] ) ) : '',
		'hide_empty'        => true,
	) );
	?>
	<input type="number" name="price_min" min="0" placeholder="下限（万円）">
	<input type="number" name="price_max" min="0" placeholder="上限（万円）">
	<button type="submit">検索</button>
</form>
```

フォームはサーバー側で完結させ、JavaScriptやjQueryは補助に留めます。たとえば、絞り込み結果の件数をリアルタイムに出したい場合に後から足す、という順序が安全です。

### スマホ対応と問い合わせ導線

検索フォームは、スマホでは縦積みにして、タップしやすい大きさにします。詳細ページには、物件名を引き継いだ問い合わせリンクを置きます。たとえば `?property=<投稿ID>` を付けて問い合わせフォームに渡せば、どの物件への問い合わせかが分かります。

## 結果：更新作業時間を約65%削減、検索性と問い合わせ導線も改善

この案件では、物件情報の更新作業時間を約65%削減しました。あわせて、検索性と問い合わせ導線も改善しました。

効く要因として次が考えられます。

- 項目を5つの軸で整理し、入力の迷いを減らす
- 管理画面を物件専用に整え、入力と確認の手間を減らす
- 検索条件と保存形式を一致させ、検索が素直に動くようにする

## 同じ課題に直面したら最初にやること

私なら、コードを書く前に次の順で進めます。

1. 検索画面の絞り込み条件を、実際の利用者目線で確定する
2. 全項目を洗い出し、「絞り込み用・表示用・管理用」に分類する
3. 絞り込み用を、タクソノミー（有限の選択肢）と数値メタ（範囲検索）に振り分ける
4. 単位と型を固定する（価格は整数の万円など）
5. 管理画面の入力順と一覧列を、更新担当者の作業順に合わせる
6. 最後に検索クエリとフォームを実装する

### 落とし穴

- 価格を単位付きの文字列で保存すると、範囲検索が破綻する。
- タクソノミーを細かくしすぎると、管理が重くなる。選択肢が数個の項目で十分である。
- 既存データの移行では、表記ゆれの洗い出しが必要である。最初に一括変換のルールを決める。
- `meta_query` は件数が増えると重くなる。価格など検索の中心になる項目は、インデックスやキャッシュも検討する。
- 入力値は必ずサニタイズし、nonceと権限チェックを省略してはならない。

## まとめ

物件情報の更新時間を約65%削減できた鍵は、検索条件から逆算した項目設計だったと私は考えています。物件種別・価格・所在地・間取り・設備に整理し、タクソノミーと数値メタに振り分けると、管理画面も検索も素直になります。同じ課題に当たったら、コードより先に検索条件と項目の分類を固めることをおすすめします。

---

私は「WordPress・Webサイト制作」をお仕事としてお受けしています。物件情報のように項目の多いデータを、検索と更新の両面から設計し直す案件に、この記事の考え方を活かせます。
→ [WordPress・Webサイト制作について](https://shanaiai.com/services/wordpress/) ／ [ランサーズで相談する](https://www.lancers.jp/profile/navi_work/contact_light)
