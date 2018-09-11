var timerData = [
    {
        type: "DailyQuest",
        title: "Daily Quests",
        priority: 10,
        days: {
            "sunday": { element: "Sun", image: "imgs/Attribute_Sun.png", short:"Sun" },
            "monday": { element: "Moon", image: "imgs/Attribute_Moon.png", short:"Mon" },
            "tuesday": { element: "Fire", image: "imgs/Attribute_Fire.png", short:"Tue" },
            "wednesday": { element: "Water", image: "imgs/Attribute_Water.png", short:"Wed" },
            "thursday": { element: "Wind", image: "imgs/Attribute_Wind.png", short:"Thu" },
            "friday": { element: "Gold", image: "imgs/Currency_gold_coin.png", short:"Fri" },
            "saturday": { element: "Earth", image: "imgs/Attribute_Earth.png", short:"Sat" }
        }
    },
    {
        type: "Maintenance",
        title: [
            "Maintenance",
            "Version 1.10.1 update"
        ],
        image: "Maintenance",
        column: 0,
        priority: 9,
        timers: [
            {
                name: "Time",
                start: "September 12 2018, 14:00",
                end: "September 12 2018, 17:00",
                keepAfterFinished: "30 minutes"
            }
        ]
    },
    {
        type: "Event",
        title: [
            "Beach Hut of the Year",
            "海の家オブザイヤー",
            "Summer event"
        ],
        image: "https://i.imgur.com/myGyoBh.png",
        column: 0,
        timers: [
            {
                name: "Period",
                start: "August 3 2018, 17:00",
                end: "August 30 2018, 11:59"
            },
            {
                name: "Boss Quest",
                start: "August 6 2018, 17:00",
                end: "August 30 2018, 11:59"
            },
            {
                name: "Event Shop",
                start: "August 3 2018, 17:00",
                end: "September 6 2018, 13:59"
            }
        ]
    },
    {
        type: "Event",
        title: [
            "Treasure Chest at the Bottom of the Sea",
            "海の底の玉手箱",
            "Summer event 2"
        ],
        image: "https://i.imgur.com/rHAePse.png",
        column: 0,
        timers: [
            {
                name: "Period",
                start: "August 15 2018, 17:00",
                end: "August 30 2018, 11:59"
            },
            {
                name: "Boss Quest",
                start: "August 17 2018, 17:00",
                end: "August 30 2018, 11:59"
            },
            {
                name: "EX Quest",
                start: "August 20 2018, 17:00",
                end: "August 30 2018, 11:59"
            },
            {
                name: "Event Shop / Treasure Chest Period",
                start: "August 15 2018, 17:00",
                end: "September 6 2018, 13:59"
            }
        ]
    },
    {
        type: "Event",
        title: [
            "Mysterious Island and Trial of Bonds",
            "謎の島と絆の試練",
            "Harukana Receive event"
        ],
        image: "https://i.imgur.com/Y0JxwZs.png",
        column: 0,
        priority: 5,
        timers: [
            {
                name: "Period",
                start: "August 30 2018, 17:00",
                end: "September 11 2018, 13:59"
            },
            {
                name: "Boss Quest",
                start: "September 3 2018, 17:00",
                end: "September 11 2018, 13:59"
            },
            {
                name: "EX Quest",
                start: "September 5 2018, 17:00",
                end: "September 11 2018, 13:59"
            },
            {
                name: "Event Shop",
                start: "August 30 2018, 17:00",
                end: "September 18 2018, 13:59"
            }
        ]
    },
    {
        type: "Mission",
        title: [
            "Mysterious Island and Trial of Bonds missions",
            "謎の島と絆の試練",
            "Harukana Receive event missions"
        ],
        image: "https://i.imgur.com/Y0JxwZs.png",
        column: 0,
        priority: 5,
        timers: [
            {
                name: "Missions Set 1",
                start: "August 30 2018, 17:00",
                end: "September 11 2018, 23:59"
            },
            {
                name: "Missions Set 2",
                start: "September 3 2018, 0:00",
                end: "September 11 2018, 23:59"
            },
            {
                name: "Missions Set 3",
                start: "September 5 2018, 0:00",
                end: "September 11 2018, 23:59"
            }
        ]
    },

    {
        type: "Gacha",
        title: [
            "Limited Swimsuit Gacha",
            "期間限定水着キャラクターピックアップ召喚",
            "Summer event Gacha"
        ],
        image: "https://i.imgur.com/myGyoBh.png",
        column: 1,
        timers: [
            {
                name: "Part 1 (Featuring 5* Yagami, 5* Kaho, 4* Eiko)",
                start: "July 31 2018, 17:00",
                end: "August 30 2018, 11:59",
                info: "Swimsuit versions"
            },
            {
                name: "Part 2 (Featuring 5* Yuki, 5* Yuzuko, 5* Aya, 4* Tooru)",
                start: "August 10 2018, 17:00",
                end: "August 30 2018, 11:59",
                info: "Swimsuit versions"
            },
            {
                name: "Part 3 (Featuring 5* Kon, 5* Shizuku, 5* Nadeshiko, 4* Yumine, 4* Kotone)",
                start: "August 17 2018, 17:00",
                end: "August 30 2018, 11:59",
                info: "Swimsuit versions"
            }
        ]
    },
    {
        type: "Gacha",
        title: [
            "Mysterious Island and Trial of Bonds Gacha",
            "謎の島と絆の試練ピックアップ召喚",
            "Harukana Receive event Gacha"
        ],
        image: "https://i.imgur.com/Y0JxwZs.png",
        column: 1,
        timers: [
            {
                name: "Part 1 (Featuring 5* Haruka, 4* Kanata, 4* Claire, 4* Emily)",
                start: "August 30 2018, 17:00",
                end: "September 12 2018, 13:59"
            },
            {
                name: "Part 2 (Featuring 5* Nagi, 4* Nagi, 4* Run, 4* Tooru, 4* Yuuko)",
                start: "September 1 2018, 0:0",
                end: "September 12 2018, 13:59"
            }
        ]
    },
    {
        type: "Gacha",
        title: [
            "Gacha for series receiving new personal weapons",
            "専用ぶき追加作品セレクション召喚",
            "Featuring 5* Karen, 5* Tamaki, 5* Yui (K-ON)"
        ],
        image: "https://i.imgur.com/MxCnPfe.png",
        column: 1,
        timers: [
            {
                name: "Period",
                start: "August 30 2018, 17:00",
                end: "September 7 2018, 16:59"
            }
        ]
    },
    {
        type: "Gacha",
        title: [
            "Fire Element gacha",
            "炎属性限定キャラクター召喚",
            "Featuring 5* Chiya, 5* Shinobu, 5* Haruka (Sakura Trick)"
        ],
        image: "https://i.imgur.com/2WbFcTW.png",
        column: 1,
        timers: [
            {
                name: "Period",
                start: "September 7 2018, 17:00",
                end: "September 14 2018, 16:59"
            }
        ]
    },
    {
        type: "Mission",
        title: [
            "Treasure Chest at the Bottom of the Sea Missions",
            "海の底の玉手箱",
            "Summer event 2 Missions"
        ],
        image: "https://i.imgur.com/rHAePse.png",
        column: 1,
        timers: [
            {
                name: "Missions Set 1",
                start: "August 15 2018, 17:00",
                end: "August 30 2018, 11:59"
            },
            {
                name: "Missions Set 2",
                start: "August 17 2018, 0:00",
                end: "August 30 2018, 11:59"
            },
            {
                name: "Missions Set 3",
                start: "August 20 2018, 0:00",
                end: "August 30 2018, 11:59"
            }
        ]
    },
    {
        type: "Mission",
        title: [
            "Beach Hut of the Year Missions",
            "海の家オブザイヤー",
            "Summer event missions"
        ],
        image: "https://i.imgur.com/myGyoBh.png",
        column: 1,
        timers: [
            {
                name: "Missions Set 1",
                start: "August 3 2018, 17:00",
                end: "August 30 2018, 11:59"
            },
            {
                name: "Missions Set 2",
                start: "August 6 2018, 0:00",
                end: "August 30 2018, 11:59"
            }
        ]
    },
    {
        type: "Other",
        title: [
            "Daily Summer Scenarios",
            "A new story everyday during august",
            "Each week's stories have a limited reading period",
            "10 Gems for reading each story"
        ],
        image: "https://i.imgur.com/myGyoBh.png",
        column: 2,
        timers: [
            {
                name: "Week 1 (August 1st~7th) reading period",
                start: "August 1 2018, 0:00",
                end: "August 14 2018, 23:59",
                keepAfterFinished: "1 day"
            },
            {
                name: "Week 2 (August 8th~14th) reading period",
                start: "August 8 2018, 0:00",
                end: "August 21 2018, 23:59",
                keepAfterFinished: "1 day"
            },
            {
                name: "Week 3 (August 15th~21st) reading period",
                start: "August 15 2018, 0:00",
                end: "August 28 2018, 23:59",
                keepAfterFinished: "1 day"
            },
            {
                name: "Week 4 (August 22nd~28th) reading period",
                start: "August 22 2018, 0:00",
                end: "August 31 2018, 23:59",
                keepAfterFinished: "1 day"
            },
            {
                name: "Week 5 (August 29th~30th) reading period",
                start: "August 29 2018, 0:00",
                end: "August 31 2018, 23:59",
                keepAfterFinished: "1 day"
            }
        ]
    },
    {
        type: "LoginDays",
        title: [
            "Harukana Receive Login Bonus",
            "はるかなレシーブ」参戦決定記念ログインボーナス",
            "20 gems on days the anime airs"
        ],
        image: "https://i.imgur.com/MdUzdan.png",
        column: 2,
        keepAfterFinished: "1 day",
        timers: [
            {
                name: "Episode 5",
                date: "August 3 2018"
            },
            {
                name: "Episode 6",
                date: "August 10 2018"
            },
            {
                name: "Episode 7",
                date: "August 17 2018"
            },
            {
                name: "Episode 8",
                date: "August 24 2018"
            },
            {
                name: "Episode 9",
                date: "August 31 2018"
            },
            {
                name: "Episode 10",
                date: "September 7 2018"
            },
            {
                name: "Episode 11",
                date: "September 14 2018"
            },
            {
                name: "Episode 12",
                date: "September 21 2018"
            }
        ]
    },
    {
        type: "WeekendBoss",
        title: [
            "August Boss Challenge",
            "Fight a boss every weekend",
            "Receive Challenge Medals"
        ],
        image: "https://i.imgur.com/V46mVPf.png",
        column: 2,
        timers: [
            {
                name: "Weekend 1",
                start: "August 4 2018, 0:00",
                end: "August 5 2018, 23:59"
            },
            {
                name: "Weekend 2",
                start: "August 11 2018, 0:00",
                end: "August 12 2018, 23:59"
            },
            {
                name: "Weekend 3",
                start: "August 18 2018, 0:00",
                end: "August 19 2018, 23:59"
            },
            {
                name: "Weekend 4",
                start: "August 25 2018, 0:00",
                end: "August 26 2018, 23:59"
            },
            {
                name: "Medal exchange period",
                start: "August 4 2018, 0:00",
                end: "August 31 2018, 23:59",
                keepAfterFinished: "1 day",
                type: "normal"
            }
        ]
    },
    {
        type: "WeekendBoss",
        title: [
            "September Boss Challenge",
            "Fight a boss every weekend",
            "Receive Challenge Medals"
        ],
        image: "https://i.imgur.com/Zi7VsQe.png",
        column: 2,
        timers: [
            {
                name: "Weekend 1",
                start: "September 1 2018, 0:00",
                end: "September 2 2018, 23:59"
            },
            {
                name: "Weekend 2",
                start: "September 8 2018, 0:00",
                end: "September 9 2018, 23:59"
            },
            {
                name: "Weekend 3",
                start: "September 15 2018, 0:00",
                end: "September 16 2018, 23:59"
            },
            {
                name: "Weekend 4",
                start: "September 22 2018, 0:00",
                end: "September 23 2018, 23:59"
            },
            {
                name: "Weekend 5",
                start: "September 29 2018, 0:00",
                end: "September 30 2018, 23:59"
            },
            {
                name: "Medal exchange period",
                start: "September 1 2018, 0:00",
                end: "October 5 2018, 23:59",
                keepAfterFinished: "1 day",
                type: "normal"
            }
        ]
    },
    {
        type: "Other",
        title: [
            "Summer Vacation Limited Deal",
            "2000 Gems (817 Paid + 1183 Free) for 9800 Yen",
            "Can only be purchased once per player"
        ],
        image: "https://i.imgur.com/myGyoBh.png",
        column: 2,
        timers: [
            {
                name: "2000 Gems (817 Paid + 1183 Free) for 9800 Yen",
                start: "July 31 2018, 17:00",
                end: "August 31 2018, 23:59"
            }
        ]
    },
    {
        type: "Other",
        title: [
            "Limited Room Decoration items",
            "Summer-themed items"
        ],
        image: "kanna",
        column: 2,
        timers: [
            {
                name: "Period",
                start: "July 31 2018, 17:00",
                end: "August 30 2018, 11:59"
            }
        ]
    },
    {
        type: "Other",
        title: [
            "Normal Shop with increased exchange limits",
            "Some items will have doubled stock during the period"
        ],
        image: "cork",
        column: 2,
        timers: [
            {
                name: "Period",
                start: "August 1 2018, 0:00",
                end: "August 30 2018, 11:59"
            }
        ]
    }
];
