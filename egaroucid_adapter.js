/*
 * egaroucid_adapter.js
 * ---------------------------------------------------------
 * あなたのフォーク(Egaroucid-originalver/web_resources/ja/web/ai.js + ai.wasm)を
 * 実際に解析した結果に基づいて書いています。TODOはもうありません。
 *
 * 前提として、同じフォルダに以下を置いてください：
 *   - egaroucid_adapter.js（このファイル）
 *   - ai.js
 *   - ai.wasm
 *
 * 判明した実際の仕様：
 *   - グローバル変数 Module を、ai.js を読み込む「前」に用意しておく必要がある
 *     （Module.onRuntimeInitialized が呼ばれたらAI初期化完了の合図）。
 *   - 初期化: _init_ai(percent_pointer) を1回呼ぶ。戻り値0で成功。
 *   - 盤面は 64個の Int32Array（行優先、y*8+x）。値は 0=黒, 1=白, -1=空。
 *     （script.js内で className="black_stone" が grid値0、"white_stone"が1
 *       であることを確認済み）
 *   - 最善手取得: _ai_js(pointer, level, ai_player)
 *       pointer: 上記盤面をmallocして書き込んだアドレス
 *       level:   0〜15（大きいほど強いが遅い。単一スレッドで同期実行＝
 *                この呼び出し中はブラウザが固まるので注意）
 *       ai_player: 手番の色を 0(黒) か 1(白) で指定（+1/-1ではない）
 *   - 戻り値 val のデコード：
 *       y = floor(val / 8000)
 *       x = floor((val - y*8000) / 1000)
 *       （※ dif_stones = val - y*8000 - x*1000 - 100 という石差の情報も
 *         同じ戻り値に含まれているが、指し手だけならy,xだけで良い）
 * ---------------------------------------------------------
 */

const EgaroucidEngine = (function () {
    let ready = false;
    let readyPromise = null;
    let loadingStarted = false;
    let readyResolve, readyReject;

    function ensureModuleAndScript() {
        if (loadingStarted) return;
        loadingStarted = true;

        // ai.js が読み込まれる前に、グローバルの Module を必ず用意しておく。
        window.Module = window.Module || {};
        window.Module['noInitialRun'] = true;
        const prevCallback = window.Module['onRuntimeInitialized'];
        window.Module['onRuntimeInitialized'] = function () {
            if (typeof prevCallback === 'function') prevCallback();
            initAfterRuntimeReady();
        };

        const script = document.createElement('script');
        script.src = 'ai.js'; // 同じフォルダに ai.js を置くこと
        script.onerror = () => {
            if (readyReject) readyReject(new Error('ai.js の読み込みに失敗しました。ファイルの配置場所を確認してください。'));
        };
        document.body.appendChild(script);
    }

    function initAfterRuntimeReady() {
        try {
            // _init_ai はグローバル関数として ai.js 読み込み後に生えてくる
            const percentPointer = _malloc(4);
            const initResult = _init_ai(percentPointer);
            _free(percentPointer);
            if (initResult === 0) {
                ready = true;
                readyResolve();
            } else {
                readyReject(new Error('_init_ai が失敗コードを返しました: ' + initResult));
            }
        } catch (e) {
            readyReject(e);
        }
    }

    function load() {
        if (readyPromise) return readyPromise;
        readyPromise = new Promise((resolve, reject) => {
            readyResolve = resolve;
            readyReject = reject;
            ensureModuleAndScript();
        });
        return readyPromise;
    }

    /**
     * board: 2D配列 board[r][c]、あなたの既存コードの規約(BLACK=1, WHITE=-1, EMPTY=0)
     * colorToMove: 1(黒) または -1(白) ※あなたの既存コードの規約のまま渡してOK
     * level: 0〜15（デフォルト12。大きいほど強いが遅い。15は非常に重い可能性あり）
     * 戻り値: { r, c } または、合法手が無い場合は null
     */
    async function getBestMove(board, colorToMove, level = 12) {
        if (!ready) {
            await load();
        }

        // 既存コード(BLACK=1, WHITE=-1) → エンジン仕様(黒=0, 白=1, 空=-1) へ変換
        const res = new Int32Array(64);
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const v = board[r][c];
                if (v === 1) res[r * 8 + c] = 0;       // 黒
                else if (v === -1) res[r * 8 + c] = 1; // 白
                else res[r * 8 + c] = -1;              // 空
            }
        }
        const aiPlayer = colorToMove === 1 ? 0 : 1; // 黒番なら0、白番なら1

        const pointer = _malloc(64 * 4);
        HEAP32.set(res, pointer / 4);
        const val = _ai_js(pointer, level, aiPlayer);
        _free(pointer);

        if (val < 0) return null; // 合法手なし(パス)

        const y = Math.floor(val / 8000);
        const x = Math.floor((val - y * 8000) / 1000);
        if (y < 0 || y > 7 || x < 0 || x > 7) return null;
        return { r: y, c: x };
    }

    return {
        load,
        getBestMove,
        isReady: () => ready,
    };
})();

window.EgaroucidEngine = EgaroucidEngine;
