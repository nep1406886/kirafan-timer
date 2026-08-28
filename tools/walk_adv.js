// Headless walkthrough for game/adv.html, driven from the Browser pane.
//
// The pane is hidden while this runs, which breaks the two scheduling
// primitives a walker would normally reach for: requestAnimationFrame never
// fires at all, and setTimeout is clamped to roughly one second. MessageChannel
// delivery is not throttled, so that is the yield used here. Timed waits the
// stage owns (a 3200 ms background fade, a title card's hold) still need real
// wall-clock time to elapse, so on stall the walker waits on a clamped timer
// instead of only flushing microtasks -- the earlier version gave up in
// milliseconds and reported a phantom stall.
(function () {
    const tick = function () {
        return new Promise(function (resolve) {
            const channel = new MessageChannel();
            channel.port1.onmessage = function () { resolve(); };
            channel.port2.postMessage(0);
        });
    };
    const realTime = function (ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    };

    window.__walk = async function (opts) {
        const options = opts || {};
        const budgetMs = options.budgetMs || 60000;
        const pickChoice = options.pickChoice === undefined ? 0 : options.pickChoice;
        const api = window.kirafanAdv;
        const player = api && api.player;
        if (!player) {
            return { error: "no player -- has start() run?" };
        }
        const log = [];
        const started = Date.now();
        let last = -1;
        let stuck = 0;
        let choicesTaken = 0;

        while (!player.done && Date.now() - started < budgetMs) {
            const at = player.index;
            if (at !== last) {
                last = at;
                stuck = 0;
                const name = document.querySelector(".adv-name");
                const primary = document.querySelector(".adv-primary");
                log.push({
                    at: at,
                    name: name ? name.textContent.trim() : "",
                    text: primary ? primary.textContent.trim().slice(0, 40) : ""
                });
            } else {
                stuck += 1;
            }

            // A visible choice box is the runner waiting on a click, not a stall:
            // context.index is pre-incremented and there is no player.choice, so
            // the only way to see a pending branch is in the DOM.
            const box = document.querySelector(".adv-choices");
            const buttons = box && !box.hidden
                ? Array.from(box.querySelectorAll("button"))
                : [];
            if (buttons.length) {
                const pick = typeof pickChoice === "function"
                    ? pickChoice(choicesTaken, buttons.map(function (b) { return b.textContent.trim(); }))
                    : pickChoice;
                log.push({
                    at: at,
                    choice: buttons.map(function (b) { return b.textContent.trim(); }),
                    picked: pick
                });
                choicesTaken += 1;
                buttons[pick].click();
                await tick();
                continue;
            }

            player.advance();
            await tick();
            // The page's own render loop is rAF-driven and therefore dead while
            // hidden, so character fades and camera pushes only move if the
            // walker steps the stage itself.
            api.step(1 / 60);
            // Let real work land: model loads, fetches, and the stage's own
            // timers. Short bursts first, then longer waits, so a fast run stays
            // fast but a 3.2 s fade still gets its time.
            if (stuck > 2) {
                await realTime(stuck > 12 ? 1000 : 250);
            }
            if (stuck > 60) {
                log.push({ at: at, stalled: true });
                break;
            }
        }

        return {
            done: player.done,
            index: player.index,
            elapsedMs: Date.now() - started,
            flags: JSON.parse(JSON.stringify(player.context.flags || {})),
            choicesTaken: choicesTaken,
            log: log
        };
    };
    return "installed";
})();
