var thumbnailMap = {
    "none": "imgs/kirara.png",
    "kirara": "imgs/kirara.png",
    "lamp": "imgs/lamp.png",
    "match": "imgs/match.png",
    "maintenance": "imgs/maintenance.png",
    "kanna": "imgs/kanna.png",
    "clea": "imgs/clea.png",
    "leine": "imgs/leine.png",
    "cork": "imgs/cork.png",
    "polka": "imgs/polka.png"
};



var elementsMap = {
    Sun: "imgs/Attribute_Sun.png",
    Moon: "imgs/Attribute_Moon.png",
    Fire: "imgs/Attribute_Fire.png",
    Water: "imgs/Attribute_Water.png",
    Wind: "imgs/Attribute_Wind.png",
    Earth: "imgs/Attribute_Earth.png",
    Gold: "imgs/Currency_gold_coin.png",
    Warrior: "imgs/Class_Warrior.png",
    Mage: "imgs/Class_Mage.png",
    Priest: "imgs/Class_Priest.png",
    Knight: "imgs/Class_Knight.png",
    Alchemist: "imgs/Class_Alchemist.png"
};

Vue.filter('addStars', function (str) {
    return str.replace(/3\*/g, "3★").replace(/4\*/g, "4★").replace(/5\*/g, "5★");
});
Vue.filter('elementImage', function (val) {
    return elementsMap[val];
});

Vue.directive('tooltip', {
    bind: function (el, binding) {
        $(el).tooltip({
            title: binding.value,
            placement: binding.arg,
            trigger: 'hover',
            html: true
        });
    },
    update: function (el, binding) {
        $(el).attr('data-original-title', binding.value);
    },
    unbind: function (el, binding) {
        $(el).tooltip('dispose');
    }
});

var vm = new Vue({
    el: '#app',
    data: {
        currentZone: "japan",
        japanTime: null,
        localTime: null,
        timersData: null,
        thumbChangeCount: 0,
        thumbChangeTime: 7,
        showHeader: true,
        columns: 3,
        filters: null,
        alerts: alertMessages,
        alertTypes: alertTypes
    },
    methods: {
        changeTimezone: function () {
            var c, t, e, col, ev, timer, data = this.timersData;

            for (c = 0; c < data.length; c++) { // Check each column
                col = data[c];
                for (e = 0; e < col.length; e++) { // Check each event group
                    ev = col[e];
                    if (ev.type == "DailyQuest") {
                        ev.displayMode = this.currentZone;
                        continue;
                    }
                    for (t = 0; t < ev.timers.length; t++) { // Check each individual timer
                        timer = ev.timers[t];
                        timer.displayMode = this.currentZone;
                    }
                }
            }
        },

        // SETUP FUNCTIONS
        loadQueryParams: function () {
            let uri = window.location.search.substring(1);
            let params = new URLSearchParams(uri);

            let tz = params.get("tz");
            if (tz && (tz == "japan" || tz == "local")) {
                this.currentZone = tz;
            }

            if (params.get("header")) {
                this.showHeader = params.get("header").toLowerCase() != "false";
            }

            let cols = parseInt(params.get("columns"), 10);
            if (cols && !isNaN(cols) && cols > 0) {
                this.columns = cols;
            }

            let filters = {};
            if (params.get("type")) {
                filters.type = params.get("type").split(",").map(function (x) {
                    return x.trim().toLowerCase();
                });
            }
            if (params.get("id")) {
                filters.id = params.get("id").split(",").map(function (x) {
                    return parseInt(x, 10);
                });
            }
            if (params.get("title")) {
                filters.title = params.get("title").split(",").map(function (x) {
                    return x.trim().toLowerCase();
                });
            }
            if (Object.keys(filters).length > 0) {
                this.filters = filters;
            }
        },
        buildTimerData: function (data) {
            var res = [];
            var ev, i, col;
            var nowMoment = moment.tz("Asia/Tokyo");
            var localZone = moment.tz.guess();

            for (i = 1; i <= this.columns; i++) {
                res.push([]);
            }

            // Loops through all data to build the event timers
            for (i = 0; i < data.length; i++) {
                ev = data[i];
                if (!ev.priority) {
                    ev.priority = 0;
                }
                ev.bonusPriority = 0;
                ev.visible = true;

                if (ev.type == "DailyQuest") {
                    ev = this.buildDailyQuestTimer(ev, nowMoment);
                } else {
                    ev = this.buildEventGroup(ev, localZone);
                }

                if (this.filterCheck(ev, this.filters, i)) {
                    col = ev.column ? ev.column : 0;
                    if (col >= res.length) {
                        col = 0;
                    }
                    res[col].push(ev);
                }
            }

            // Sort timers and remove empty columns
            for (i = res.length; i--;) {
                if (res[i].length === 0) {
                    res.splice(i, 1);
                }
            }

            this.timersData = res;
        },
        buildDailyQuestTimer: function (ev, nowMoment) {
            ev.displayMode = "japan";
            ev.deadlineMoment = nowMoment.clone().endOf("day");
            ev.current = "";
            ev.deadline = "";
            ev.japanend = "";
            ev.localend = "";
            ev.visible = !ev.hide;
            return ev;
        },
        buildEventGroup: function (ev, localZone) {
            let evExtra, timer, e;

            // Default settings
            ev.expiration = 0;
            ev.nextTimer = "";
            ev.normalTimerIndex = 0;

            // Sets event image
            if (!ev.image) {
                ev.image = thumbnailMap.none;
            } else {
                // If array, image will rotate through all images listed every few seconds
                if (Array.isArray(ev.image)) {
                    ev.imageStep = Math.floor(Math.random() * ev.image.length);
                    ev.imageList = ev.image.map(function (x) {
                        return thumbnailMap.hasOwnProperty(x.toLowerCase()) ? thumbnailMap[x.toLowerCase()] : x;
                    });
                    ev.image = ev.imageList[ev.imageStep];
                } else if (thumbnailMap.hasOwnProperty(ev.image.toLowerCase())) {
                    ev.image = thumbnailMap[ev.image.toLowerCase()];
                }
            }

            // How long the event will still be displayed after all of its timers are finished
            evExtra = this.toDurationObject(ev.keepAfterFinished);

            // Create all individual timers
            for (e = 0; e < ev.timers.length; e++) {
                timer = this.buildEventTimer(ev.timers[e], ev, localZone, e, evExtra);
            }

            return ev;
        },
        buildEventTimer: function (timer, ev, localZone, normalTimerIndex, evExtra) {
            let timerExtra, startMoment, endMoment, expiration, extraDays = 0;

            // Default settings
            timer.visible = true;
            timer.progress = 0;
            timer.displayMode = "japan";

            // Sets timer type; Also adds start/end time for dates
            if (timer.hasOwnProperty("date")) {
                timer.start = timer.date + ", 0:00";
                timer.end = timer.date + ", 23:59";
                if (timer.days) {
                    extraDays = timer.days - 1;
                }
                timer.type = "date";
            } else if (ev.type == "WeekendBoss") {
                if (!timer.type) {
                    timer.type = "weekend";
                } else if (timer.type == "normal") {
                    ev.normalTimerIndex = normalTimerIndex;
                }
            } else {
                timer.type = "normal";
            }

            // Converts start/end moments to Japan time
            // var strFormat = "MMM Do<br>ddd, H:mm";
            //下面俩时间的显示
            var strFormat = "MMM D YYYY<br>ddd H:mm";
            moment.locale("zh-cn");
            startMoment = this.parseMoment(timer.start);
            endMoment = this.parseMoment(timer.end);
            if (ev.type == "Memorial") {
                strFormat = "YYYY年M月D日<br>ddd HH:mm";
            }
            if (extraDays > 0) {
                endMoment = endMoment.add(extraDays, "days");
            }

            timer.rawStart = startMoment._d.getTime();
            timer.rawEnd = endMoment._d.getTime();
            timer.operationDuration = this.timeDescription(timer.rawEnd - timer.rawStart, 4);
            timer.sinceEnd = "";

            // Creates markers
            var marks = [];
            if (timer.hasOwnProperty("markers")) {
                let marker;
                for (var m = 0; m < timer.markers.length; m++) {
                    marker = this.createMarker(timer.markers[m], timer, localZone);
                    marks.push(marker);
                }
                timer.nextMarker = "";
            }
            if (timer.hasOwnProperty("banners")) {
                let marker;
                for (var m = 0; m < timer.banners.length; m++) {
                    marker = this.createMarker(timer.banners[m], timer, localZone);
                    if (marker.rawtime != timer.rawStart) {
                        marks.push(marker);
                    }
                }
                timer.nextMarker = "";
            }
            timer.markersInfo = marks;


            // Timer expiration = End Time + Timer's extra time
            timerExtra = this.toDurationObject(timer.keepAfterFinished);
            expiration = endMoment.clone().add(timerExtra);
            timer.expiration = expiration._d.getTime();

            // Event expiration = Last Timer's Expiration + Event's extra time
            expiration = expiration.add(evExtra)._d.getTime();
            if (expiration > ev.expiration) {
                ev.expiration = expiration;
            }

            // Stores date/time strings to display in timers
            if (timer.type == "date") {
                strFormat = "MMM Do<br>H:mm";
            } else if (timer.type == "weekend") {
                strFormat = "MMM Do";
            }
            timer.dateDisplay = {
                jpstart: startMoment.format(strFormat),
                localstart: startMoment.tz(localZone).format(strFormat),
                jpend: endMoment.format(strFormat),
                localend: endMoment.tz(localZone).format(strFormat),
                badgeStart: "",
                badgeEnd: "",
                barLabel: ""
            };
            return timer;
        },
        createMarker: function (marker, timer, localZone) {
            var markTime = this.parseMoment(marker.time);
            var tooltipFormat = "ddd, MMM Do, H:mm";
            var rawTime = markTime._d.getTime();
            var mark = {
                label: marker.title,
                type: marker.type || "star",
                jptime: markTime.format(tooltipFormat),
                localtime: markTime.tz(localZone).format(tooltipFormat),
                rawtime: rawTime,
                position: (rawTime - timer.rawStart) / (timer.rawEnd - timer.rawStart) * 100 + "%",
                started: false,
                tip: ""
            };
            return mark;
        },
        filterCheck: function (data, filters, id) {
            if (filters == null) {
                return true;
            }
            if (filters.hasOwnProperty("type")) {
                if (filters.type.indexOf(data.type.toLowerCase()) != -1) {
                    return true;
                }
            }
            if (filters.hasOwnProperty("title")) {
                let titles = Array.isArray(data.title) ? data.title : [data.title];
                let words = filters.title;
                for (let e = 0; e < titles.length; e++) {
                    for (let i = 0; i < words.length; i++) {
                        if (titles[e].toLowerCase().indexOf(words[i]) != -1) {
                            return true;
                        }
                    }
                }

            }
            if (filters.hasOwnProperty("id")) {
                if (filters.id.indexOf(id) != -1) {
                    return true;
                }
            }
            return false;
        },

        // UPDATE FUNCTIONS 切换时间 那里的显示数据
        updateClocks: function () {
            moment.locale("zh-cn");
            this.japanTime = moment().tz('Asia/Tokyo').format("dddd, MMMM Do YYYY, h:mm:ss");
            this.localTime = moment().format("dddd, MMMM Do YYYY, h:mm:ss");
            this.updateTimerData();
        },
        updateTimerData: function () {
            var c, e, ev, col, data = this.timersData;
            var nowMoment = moment.tz("Asia/Tokyo");
            var now = nowMoment._d.getTime();
            var localZone = moment.tz.guess();

            var changeThumbs = this.thumbChangeCount >= this.thumbChangeTime;
            this.thumbChangeCount += 1;
            if (changeThumbs) {
                this.thumbChangeCount = 0;
            }

            for (c = 0; c < data.length; c++) { // Check each column
                col = data[c];
                for (e = 0; e < col.length; e++) { // Check each event group
                    ev = col[e];
                    ev.bonusPriority = 0;
                    if (ev.type == "DailyQuest") {
                        this.updateDailyQuest(ev, now, nowMoment, localZone);
                    } else {
                        this.updateEventGroup(ev, now, changeThumbs);
                    }

                }

                col.sort(this.prioritySort);
            }
        },
        updateDailyQuest: function (ev, now, nowMoment, localZone) {
            let deadline = ev.deadlineMoment;
            if (deadline.date() != nowMoment.date()) {
                deadline = ev.deadlineMoment = nowMoment.clone().endOf("day");
            }
            ev.current = nowMoment.format("dddd").toLowerCase();

            ev.deadline = this.remainingTimeString(now, deadline._d.getTime(), 2);
            ev.japanend = deadline.format("MMM Do, H:mm");
            ev.localend = deadline.clone().tz(localZone).format("MMM Do, H:mm");
        },
        updateEventGroup: function (ev, now, changeThumbs) {
            var allExpired = true,
                nextDate = Infinity,
                nextType = "finished",
                lastDate = 0;

            // Check each individual timer
            for (var t = 0; t < ev.timers.length; t++) {
                var timer = ev.timers[t];
                if (this.updateEventTimer(timer, ev, now)) {
                    allExpired = false;
                }

                if (timer.rawStart > now && timer.rawStart < nextDate) {
                    nextDate = timer.rawStart;
                    nextType = "upcoming";
                }
                if (timer.rawEnd > now && timer.rawEnd < nextDate) {
                    nextDate = timer.rawEnd;
                    nextType = "ongoing";
                }
                if (timer.rawEnd > lastDate) {
                    lastDate = timer.rawEnd;
                }
            }

            // Updates text for LoginDays timers
            if (nextType == "finished") {
                ev.nextTimer = "已结束 " + this.remainingTimeString(now, lastDate, 2);
            } else if (nextType == "upcoming") {
                ev.nextTimer = "下一阶段将在 " + this.remainingTimeString(now, nextDate, 2) + " 后开始";
            } else {
                ev.nextTimer = "当前阶段还剩 " + this.remainingTimeString(now, nextDate, 2);
            }

            // Changes thumbnail for Event Group
            if (changeThumbs && ev.imageList) {
                ev.imageStep++;
                if (ev.imageStep >= ev.imageList.length) {
                    ev.imageStep = 0;
                }
                ev.image = ev.imageList[ev.imageStep];
            }

            // Check if event should be visible
            if (allExpired && now >= ev.expiration && (typeof ev.keepAfterFinished != "boolean" || ev.keepAfterFinished === false)) {
                ev.visible = false;
            }
        },
        updateEventTimer: function (timer, ev, now) {
            // Check if timer should be visible
            timer.visible = false;
            timer.progress = this.countProgress(now, timer.rawStart, timer.rawEnd);
            timer.sinceEnd = now >= timer.rawEnd
                ? this.timeDescription(now - timer.rawEnd, 4)
                : this.timeDescription(timer.rawEnd - now, 4) + " 后";
            if (timer.keepAfterFinished === true || timer.type == "weekend" || timer.expiration > now) {
                timer.visible = true;

                // Write strings for progress bar dates according to state
                if (timer.progress <= 0) {
                    timer.dateDisplay.barLabel = this.remainingTimeString(now, timer.rawStart, 2) + " 后开始";
                    timer.dateDisplay.badgeStart = this.remainingTimeString(now, timer.rawStart, 5) + " 后开始";
                    timer.dateDisplay.badgeEnd = this.remainingTimeString(now, timer.rawEnd, 5) + " 后结束";
                } else if (timer.progress >= 100) {
                    timer.dateDisplay.barLabel = "已结束 " + this.remainingTimeString(now, timer.rawEnd, 5);
                    timer.dateDisplay.badgeEnd = "结束于 " + this.remainingTimeString(now, timer.rawEnd, 5) + " 前";
                    timer.dateDisplay.badgeStart = "开始于 " + this.remainingTimeString(now, timer.rawStart, 5) + " 前";
                } else {
                    timer.dateDisplay.barLabel = "剩余 " + this.remainingTimeString(now, timer.rawEnd, 2) + (timer.type == "weekend" ? "" : "（" + timer.progress.toFixed(1) + "%）");
                    timer.dateDisplay.badgeEnd = this.remainingTimeString(now, timer.rawEnd, 5) + " 后结束";
                    timer.dateDisplay.badgeStart = "已开始 " + this.remainingTimeString(now, timer.rawStart, 5);

                    // Increase priority if timer is active
                    if (timer.extraPriority) {
                        ev.bonusPriority += timer.extraPriority;
                    }
                }

                // Update markers
                if (timer.markersInfo.length > 0) {
                    var marks = timer.markersInfo, m, mark, next = Infinity, nextName, nextFound = false;
                    for (m = 0; m < marks.length; m++) {
                        mark = marks[m];
                        mark.tip = "<b>" + mark.label + "</b><br/>" + (timer.displayMode == "japan" ? mark.jptime : mark.localtime) + (now >= mark.rawtime ? "" : "<br/>（" + this.remainingTimeString(now, mark.rawtime, 5) + " 后开始）");
                        if (mark.rawtime > now && mark.rawtime < next) {
                            nextFound = true;
                            nextName = mark.label;
                            next = mark.rawtime;
                        }
                        if (now >= mark.rawtime) {
                            mark.started = true;
                            mark.color = "#2fc551";
                        }
                    }
                    if (nextFound && now >= timer.rawStart) {
                        timer.nextMarker = nextName + " 将在 " + this.remainingTimeString(now, next, 5) + " 后开始";
                    } else {
                        timer.nextMarker = "";
                    }
                } else {
                    timer.nextMarker = "";
                }
            }
            return timer.visible && timer.type != "weekend";
        },

        // HELPER FUNCTIONS
        prioritySort: function (a, b) {
            return (b.priority + b.bonusPriority) - (a.priority + a.bonusPriority);
        },
        toDurationObject: function (str) {
            if (typeof str !== "string") {
                return {};
            }
            var info = str.split(","),
                out = {},
                unitNames = ["seconds", "minutes", "hours", "days", "weeks", "months", "years"],
                part, val, unit;

            for (var i = 0; i < info.length; i++) {
                part = info[i].toLowerCase().trim().split(" ");
                val = parseInt(part[0], 10);
                unit = part[1];
                if (unit[unit.length - 1] != "s") {
                    unit = unit + "s";
                }
                if (unitNames.indexOf(unit) !== -1 && !isNaN(val)) {
                    out[unit] = val;
                }
            }
            return out;
        },
        countProgress: function (now, start, end) {
            var duration = end - start;
            var elapsed = now - start;

            if (elapsed <= 0) {
                return 0;
            } else if (elapsed >= duration) {
                return 100;
            } else {
                return elapsed / duration * 100;
            }
        },
        parseMoment: function (str) {
            var formats = [
                "MMMM D YYYY, H:mm",
                "MMM D YYYY, H:mm",
                "MMMM D YYYY",
                "MMM D YYYY"
            ];
            var parsed = moment.tz(str, formats, "en", true, "Asia/Tokyo");
            if (parsed.isValid()) {
                return parsed;
            }
            var match = /^(\d{1,2})月\s*(\d{1,2})日\s*(\d{4})(?:,\s*(\d{1,2}):(\d{2}))?$/.exec(String(str).trim());
            if (match) {
                return moment.tz({
                    year: Number(match[3]),
                    month: Number(match[1]) - 1,
                    day: Number(match[2]),
                    hour: Number(match[4] || 0),
                    minute: Number(match[5] || 0)
                }, "Asia/Tokyo");
            }
            return moment.invalid();
        },
        timeDescription: function (time, steps) {
            var sec = time / 1000;

            var s = [];
            var n;
            var d = [[24 * 60 * 60, "天"], [60 * 60, "小时"], [60, "分"], [1, "秒"]];
            for (var j = 0; j < 4; ++j) {
                n = parseInt(sec / d[j][0], 10);
                if (n > 0) {
                    s.push((n + "" + d[j][1] + (n > 1 ? "" : "")));
                    sec -= n * d[j][0];
                }
            }
            if (s.length === 0) {
                return "0秒";
            } else {
                return s.splice(0, steps).join("");
            }
        },
        remainingTimeString: function (now, target, steps) {
            var diff = target - now;

            if (diff >= 0) {

                return this.timeDescription(diff, steps || 2);
            } else {
                return this.timeDescription(-diff, steps || 2);
            }
        }
    },
    created: function () {
        this.loadQueryParams();
        this.buildTimerData(timerData);
        this.updateTimerData();
        this.updateClocks();
        this.changeTimezone();
        // 设置语言环境

        setInterval(this.updateClocks, 1 * 1000);
    }
});

(function () {
    var offerings = [
        { message: "你为琪拉拉献上了一束星光", image: "imgs/kirara_b.png" },
        { message: "你为兰普献上了一束星光", image: "imgs/lamp_b.png" },
        { message: "你为克蕾雅献上了一束星光", image: "imgs/clea_b.png" }
    ];
    var storageKey = "kirafan-offering-count";
    var closeTimer;

    function readOfferingCount() {
        try {
            return Number(window.localStorage.getItem(storageKey)) || 0;
        } catch (error) {
            return 0;
        }
    }

    function writeOfferingCount(count) {
        try {
            window.localStorage.setItem(storageKey, String(count));
        } catch (error) {
            return;
        }
    }

    function initOffering() {
        var button = document.getElementById("offeringButton");
        var modal = document.getElementById("offeringModal");
        var image = document.getElementById("offeringImage");
        var message = document.getElementById("offeringMessage");
        var countLabel = document.getElementById("offeringCount");
        var count = readOfferingCount();

        if (!button || !modal || !image || !message || !countLabel) {
            return;
        }

        function renderCount() {
            countLabel.textContent = count > 0 ? "你已献上 " + count + " 次" : "";
        }

        function closeOffering() {
            window.clearTimeout(closeTimer);
            modal.classList.remove("is-visible");
            window.setTimeout(function () {
                modal.hidden = true;
            }, 240);
        }

        button.addEventListener("click", function () {
            var offering = offerings[Math.floor(Math.random() * offerings.length)];
            count += 1;
            writeOfferingCount(count);
            renderCount();
            image.src = offering.image;
            image.alt = offering.message;
            message.textContent = offering.message;
            modal.hidden = false;
            window.requestAnimationFrame(function () {
                modal.classList.add("is-visible");
            });
            closeTimer = window.setTimeout(closeOffering, 2600);
        });

        modal.querySelectorAll("[data-close-offering]").forEach(function (element) {
            element.addEventListener("click", closeOffering);
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && !modal.hidden) {
                closeOffering();
            }
        });
        renderCount();
    }

    function markCounterUnavailable() {
        ["vercount_value_site_uv", "vercount_value_site_pv"].forEach(function (id) {
            var element = document.getElementById(id);
            if (element && element.textContent.trim() === "读取中") {
                element.textContent = "暂不可用";
                element.classList.add("is-unavailable");
            }
        });
    }

    window.handleVisitorCounterError = markCounterUnavailable;

    document.addEventListener("DOMContentLoaded", function () {
        initOffering();
        window.setTimeout(markCounterUnavailable, 6000);
        initGiscus();
    });

    function initGiscus() {
        var config = window.kirafanGiscus;
        var target = document.getElementById("giscusThread");
        var setupNotice = document.getElementById("giscusSetupNotice");
        if (!config || !target || !setupNotice) {
            return;
        }
        if (!config.categoryId) {
            setupNotice.hidden = false;
            return;
        }

        var script = document.createElement("script");
        script.src = "https://giscus.app/client.js";
        script.async = true;
        script.crossOrigin = "anonymous";
        Object.keys(config).forEach(function (key) {
            if (key === "categoryId") {
                script.dataset.categoryId = config[key];
                return;
            }
            script.dataset[key] = config[key];
        });
        target.appendChild(script);
    }
})();
