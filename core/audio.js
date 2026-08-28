// BGM and voice playback for the fan-game layer.
//
// Browsers block audio until the first gesture, so nothing here starts until
// unlock() has been called from a click handler. Games should call it from
// their start button.

const BGM_ROOT = "../audio/bgm/";
const VOICE_ROOT = "../audio/gacha/";

let unlocked = false;
let current = null;
let currentTrack = null;
let bgmVolume = 0.55;
let voiceVolume = 1;
const voices = new Set();

export function unlock() {
    unlocked = true;
}

export function isUnlocked() {
    return unlocked;
}

function fadeTo(element, target, duration, onDone) {
    if (duration <= 0) {
        element.volume = target;
        if (onDone) { onDone(); }
        return;
    }
    const start = element.volume;
    const startedAt = performance.now();
    function step(now) {
        // Clamped at both ends. The floor is not paranoia: the timestamp rAF
        // passes in is the frame's start time, which can predate the
        // performance.now() taken just above it, making the first `progress`
        // slightly negative. `volume` is a throwing setter, so an out-of-range
        // value is not a quiet glitch -- it raises IndexSizeError, and since this
        // runs inside the script's promise chain the whole chapter stops on a
        // fade-in that was a fraction of a millisecond early.
        const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
        element.volume = Math.max(0, Math.min(1, start + (target - start) * progress));
        if (progress < 1) {
            requestAnimationFrame(step);
        } else if (onDone) {
            onDone();
        }
    }
    requestAnimationFrame(step);
}

// Play a BGM track by manifest name, e.g. "bgm_battle_12_0".
// Re-requesting the playing track is a no-op, so scenes can declare their
// track without worrying about restarting it.
export function bgm(track, options) {
    const opts = options || {};
    const fade = opts.fade === undefined ? 900 : opts.fade;
    if (!unlocked) {
        currentTrack = track;
        return;
    }
    if (currentTrack === track && current && !current.paused) {
        return;
    }
    currentTrack = track;
    const previous = current;
    if (previous) {
        fadeTo(previous, 0, fade, function () {
            previous.pause();
            previous.src = "";
        });
    }
    if (!track) {
        current = null;
        return;
    }
    const element = new Audio(BGM_ROOT + track + ".mp3");
    element.loop = opts.loop !== false;
    element.volume = 0;
    current = element;
    const play = element.play();
    if (play && play.catch) {
        play.catch(function () { /* interrupted by a newer request */ });
    }
    fadeTo(element, bgmVolume, fade);
}

export function stopBgm(fade) {
    bgm(null, { fade: fade === undefined ? 600 : fade });
}

export function setBgmVolume(value) {
    bgmVolume = Math.max(0, Math.min(1, value));
    if (current) {
        current.volume = bgmVolume;
    }
}

// Fire-and-forget voice clip. Path is relative to audio/gacha/.
export function voice(file) {
    if (!unlocked || !file) {
        return null;
    }
    const element = new Audio(VOICE_ROOT + file);
    element.volume = voiceVolume;
    voices.add(element);
    element.addEventListener("ended", function () { voices.delete(element); });
    const play = element.play();
    if (play && play.catch) {
        play.catch(function () { voices.delete(element); });
    }
    return element;
}

export function stopVoices() {
    voices.forEach(function (element) {
        element.pause();
        element.src = "";
    });
    voices.clear();
}

export function setVoiceVolume(value) {
    voiceVolume = Math.max(0, Math.min(1, value));
}

// Track names present in audio/bgm/, grouped for scene selection.
export const TRACKS = {
    prologue: "bgm_Prologue_0",
    town: ["bgm_town_1_0", "bgm_town_2_0", "bgm_town_3_0", "bgm_town_4_0", "bgm_town_5_0"],
    townSeasonal: { newYear: "bgm_town_shougatu_0", christmas: "bgm_town_xmas_0" },
    battle: [
        "bgm_battle_1_0", "bgm_battle_2_0", "bgm_battle_3_0", "bgm_battle_4_0",
        "bgm_battle_5_0", "bgm_battle_6_0", "bgm_battle_7_0", "bgm_battle_8_0",
        "bgm_battle_9_0", "bgm_battle_10_0", "bgm_battle_11_0", "bgm_battle_12_0",
        "bgm_battle_13_0"
    ],
    battleWin: "bgm_battle_win_0",
    questSelect: ["bgm_questselect_0", "bgm_questselect_2_0", "bgm_questselect_3_0"],
    // Class victory themes, indexed to match cards.CLASSES.
    classTheme: [
        "bgm_5_fighter_0", "bgm_5_magician_0", "bgm_5_priest_0",
        "bgm_5_knight_0", "bgm_5_alchemist_0"
    ]
};
