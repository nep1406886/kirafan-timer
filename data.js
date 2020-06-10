var alertMessages = [];
var timerData = [
    {
        type: "DailyQuest",
        title: "Daily Quests",
        priority: 10,
        days: {
            "sunday": { elements: ["Sun", "Priest", "Mage", "Alchemist"], short:"Sun" },
            "monday": { elements: ["Moon", "Gold", "Warrior"], short:"Mon" },
            "tuesday": { elements: ["Fire", "Knight", "Priest"], short:"Tue" },
            "wednesday": { elements: ["Water", "Gold", "Mage"], short:"Wed" },
            "thursday": { elements: ["Wind", "Warrior", "Alchemist"], short:"Thu" },
            "friday": { elements: ["Gold", "Priest", "Mage"], short:"Fri" },
            "saturday": { elements: ["Earth", "Warrior", "Knight"], short:"Sat" }
        }
    },
    {
        type: "Maintenance",
        title: [
            "Maintenance",
            "Event Preparation",
            "Summon Renovation",
            "Version 2.1.1 Update"
        ],
        image: "Maintenance",
        column: 0,
        priority: 9,
        timers: [
            {
                name: "Scheduled Time",
                start: "June 9 2020, 16:00",
                end: "June 9 2020, 17:00",
                keepAfterFinished: "30 minutes"
            }
        ]
    },
    {
        "type": "Event",
        "title": [
            "The Great Sports Festival & The Goddess' Holy Grail",
            "大運動会と女神の聖杯",
            "Sports Festival 2020 Event"
        ],
        "image": [
            "https://i.imgur.com/g3U0JRe.png",
            "https://i.imgur.com/Sb95tZL.png",
            "https://i.imgur.com/I8KWxUF.png",
            "https://i.imgur.com/CldfjiV.png",
            "https://i.imgur.com/BNoYbfW.png"
        ],
        "column": 0,
        "priority": 2,
        "timers": [
            {
                "name": "Main Scenario",
                "start": "May 28 2020, 17:00",
                "end": "June 9 2020, 15:59",
                "markers": {
                    "Season 2": "May 30 2020, 17:00",
                    "Season 3": "June 1 2020, 17:00",
                    "Extra Chapter": "June 3 2020, 17:00"
                },
                "extraPriority": 4
            },
            {
                "name": "Boss Quest",
                "start": "June 3 2020, 17:00",
                "end": "June 9 2020, 15:59"
            },
            {
                "name": "Event Shop",
                "start": "May 28 2020, 17:00",
                "end": "June 16 2020, 13:59"
            }
        ]
    },
    {
        "type": "Event",
        "title": [
            "Etowaria Baseball Showdown",
            "エトワリア野球対決",
            "Tamayomi Event"
        ],
        "image": [
            "https://i.imgur.com/cnBNyaI.png",
            "https://i.imgur.com/8330YBW.png",
            "https://i.imgur.com/O4lpRiy.png",
            "https://i.imgur.com/sWmHdsy.png"
        ],
        "column": 0,
        "priority": 2,
        "timers": [
            {
                "name": "Main Scenario",
                "start": "June 9 2020, 17:00",
                "end": "June 23 2020, 11:59",
                "markers": {
                    "Extra Chapter 1": "June 18 2020, 0:00",
                    "Extra Chapter 2": "June 19 2020, 0:00",
                    "Extra Chapter 3": "June 20 2020, 0:00",
                    "Extra Chapter 4": "June 21 2020, 0:00"
                },
                "extraPriority": 4
            },
            {
                "name": "Boss Quest",
                "start": "June 12 2020, 17:00",
                "end": "June 23 2020, 11:59"
            },
            {
                "name": "EX Quest",
                "start": "June 15 2020, 17:00",
                "end": "June 23 2020, 11:59"
            },
            {
                "name": "Event Shop",
                "start": "June 9 2020, 17:00",
                "end": "June 30 2020, 13:59"
            }
        ]
    },
    {
        "type": "Mission",
        "title": [
            "The Great Sports Festival & The Goddess' Holy Grail Missions",
            "大運動会と女神の聖杯",
            "Sports Festival 2020 Event missions"
        ],
        "image": [
            "https://i.imgur.com/g3U0JRe.png",
            "https://i.imgur.com/Sb95tZL.png",
            "https://i.imgur.com/I8KWxUF.png",
            "https://i.imgur.com/CldfjiV.png",
            "https://i.imgur.com/BNoYbfW.png"
        ],
        "column": 0,
        "priority": 1,
        "timers": [
            {
                "name": "Missions",
                "start": "May 28 2020, 17:00",
                "end": "June 9 2020, 23:59",
                "markers": {
                    "Mission Set 2": "June 3 2020, 0:00"
                },
                "extraPriority": 2
            }
        ]
    },
    {
        "type": "Mission",
        "title": [
            "Etowaria Baseball Showdown Missions",
            "エトワリア野球対決",
            "Tamayomi Event missions"
        ],
        "image": [
            "https://i.imgur.com/cnBNyaI.png",
            "https://i.imgur.com/8330YBW.png",
            "https://i.imgur.com/O4lpRiy.png",
            "https://i.imgur.com/sWmHdsy.png"
        ],
        "column": 0,
        "priority": 1,
        "timers": [
            {
                "name": "Missions",
                "start": "June 9 2020, 17:00",
                "end": "June 23 2020, 23:59",
                "markers": {},
                "extraPriority": 2
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "The Great Sports Festival & The Goddess' Holy Grail Summon",
            "大運動会と女神の聖杯ピックアップ召喚",
            "Sports Festival 2020 Event summon"
        ],
        "image": [
            "https://i.imgur.com/g3U0JRe.png",
            "https://i.imgur.com/Sb95tZL.png",
            "https://i.imgur.com/I8KWxUF.png",
            "https://i.imgur.com/CldfjiV.png"
        ],
        "column": 1,
        "priority": 1,
        "timers": [
            {
                "name": "White Team: Featuring 5* Shamiko [Sports Festival], 5* Kirin [Sports Festival]",
                "start": "May 28 2020, 17:00",
                "end": "June 9 2020, 15:59",
                "extraPriority": 6
            },
            {
                "name": "Red Team: Featuring 5* Karen [Sports Festival], 5* Tamaki [Sports Festival]",
                "start": "May 28 2020, 17:00",
                "end": "June 9 2020, 15:59"
            }
        ]
    },
     {
        "type": "Gacha",
        "title": [
            "Etowaria Baseball Showdown Summon",
            "エトワリア野球対決ピックアップ召喚",
            "Tamayomi Event summon"
        ],
        "image": [
            "https://i.imgur.com/cnBNyaI.png",
            "https://i.imgur.com/8330YBW.png",
            "https://i.imgur.com/O4lpRiy.png"
        ],
        "column": 1,
        "priority": 1,
        "timers": [
            {
                "name": "First Half: Featuring 5* Takeda Yomi, 4* Yamazaki Tamaki",
                "start": "June 9 2020, 17:00",
                "end": "June 23 2020, 11:59",
                "extraPriority": 6
            },
            {
                "name": "Second Half: Featuring 5* Ekoda Ren",
                "start": "June 13 2020, 0:00",
                "end": "June 23 2020, 11:59"
            }
        ]
    },
     {
        "type": "Gacha",
        "title": [
            "Anne Happy♪ Limited-time Summon",
            "あんハピ♪ 期間限定特別セレクション召喚"
        ],
        "image": [
            "https://i.imgur.com/flB09UL.png",
            "https://i.imgur.com/CwI10nb.png",
            "https://i.imgur.com/Px0ph2a.png",
            "https://i.imgur.com/76l7qYN.png"
        ],
        "column": 1,
        "priority": 1,
        "timers": [
            {
                "name": "Featuring 5* Hanakoizumi An, 5* Hibarigaoka Ruri, 5* Kumegawa Botan, 5* Hibiki [Valentine], 4* Hanakoizumi An, 4* Kumegawa Botan",
                "start": "June 11 2020, 17:00",
                "end": "June 18 2020, 16:59",
                "extraPriority": 4
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "Past Sports Festival Limited-time Step-up Summon",
            "期間限定運動会復刻！おまけ付き10回召喚",
            "Random 5* Summon Ticket on 7th step"
        ],
        "image": [
            "https://i.imgur.com/d3ncfOl.png",
            "https://i.imgur.com/YZReEjG.png",
            "https://i.imgur.com/b2EMpo4.png"
        ],
        "column": 1,
        "priority": 1,
        "timers": [
            {
                "name": "Featuring 5* Youko [Sports Festival], 5* Aoba [Sports Festival], 5* Eiko [Sports Festival]",
                "start": "May 29 2020, 17:00",
                "end": "June 5 2020, 16:59",
                "extraPriority": 4
            },
            {
                name: "Ticket Expiration",
                start: "May 29 2020, 17:00",
                end: "June 12 2020, 23:59"
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "Kill Me Baby Limited-time Step-up Summon",
            "キルミーベイベー 期間限定おまけ付き10回召喚",
            "Random Kill Me Baby 5* Summon Ticket on 7th step"
        ],
        "image": [
            "https://i.imgur.com/KqI3C1J.png",
            "https://i.imgur.com/EQZAcDG.png",
            "https://i.imgur.com/R9jMLuH.png",
            "https://i.imgur.com/6X1AEVp.png"
        ],
        "column": 1,
        "priority": 1,
        "timers": [
            {
                "name": "Featuring 5* Oribe Yasuna, 5* Yasuna [New Year], 5* Sonya, 5* Goshiki Agiri",
                "start": "June 5 2020, 17:00",
                "end": "June 9 2020, 15:59",
                "extraPriority": 4,
                "info": "Also rate-up for 3* and 4* Kill Me Baby characters"
            },
            {
                name: "Ticket Expiration",
                "start": "June 5 2020, 17:00",
                end: "June 16 2020, 23:59"
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "Daily Kirakira Limited-time Summon",
            "1日1回期間限定きらきら召喚",
            "40 Paid Gems for a 3x Summon with only 4* or above"
        ],
        "image": "clea",
        "column": 1,
        "priority": 1,
        "timers": [
            {
                name: "Summon Period: Featuring a bunch of limited-time characters",
                start: "June 10 2020, 0:00",
                end: "June 18 2020, 16:59",
                extraPriority: 3,
                info: "Featuring 5* Yuuko [Christmas], 5* Karen [Foreign Magician], 5* Alice [Christmas], 5* Alice [New Year], 5* Aoba [Sports Festival], 5* Hifumi [Christmas], 5* Hifumi [Maid], 5* Yun [Doll's Festival], 5* Kou [Swimsuit], 5* Chiya [Christmas], 5* Kon [Swimsuit], 5* Koume [Valentine], 5* Omi [New Year], 4* Nono [Halloween]"
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "900 Days Celebration Choosable 5* Summon Ticket",
            "リリース900日記念★5選べるチケット付き！有償限定10回召喚",
            "400 Paid Gems for a 10x Summon + Choosable 5* Summon Ticket"
        ],
        "image": "clea",
        "column": 1,
        "priority": 1,
        "timers": [
            {
                name: "Summon Period",
                start: "May 28 2020, 17:00",
                end: "June 10 2020, 23:59",
                extraPriority: 4
            },
            {
                name: "Ticket Expiration",
                start: "May 28 2020, 17:00",
                end: "June 17 2020, 23:59"
            }
        ]
    },
    {
        type: "Other",
        title: [
            "900 Days Celebration Login Bonus",
            "900日記念ログインボーナス",
            "Log in on 10 days for up to 300 Gems"
        ],
        image: "lamp",
        column: 2,
        timers: [
            {
                name: "Period",
                "start": "May 28 2020, 17:00",
                "end": "June 10 2020, 23:59"
            }
        ]
    },
    {
        type: "LoginDays",
        title: [
            "Tamayomi participation Login Bonus",
            "球詠参戦決定記念ログインボーナス",
            "20 Gems on days the anime airs"
        ],
        image: "lamp",
        column: 2,
        timers: [
            {
                name: "Episode 1",
                date: "April 1 2020",
                days: 2
            },
            {
                name: "Episode 2",
                date: "April 8 2020",
                days: 2
            },
            {
                name: "Episode 3",
                date: "April 15 2020",
                days: 2
            },
            {
                name: "Episode 4",
                date: "April 22 2020",
                days: 2
            },
            {
                name: "Episode 5",
                date: "April 29 2020",
                days: 2
            },
            {
                name: "Episode 6",
                date: "May 6 2020",
                days: 2
            },
            {
                name: "Episode 7",
                date: "May 13 2020",
                days: 2
            },
            {
                name: "Episode 8",
                date: "May 20 2020",
                days: 2
            },
            {
                name: "Episode 9",
                date: "May 27 2020",
                days: 2
            },
            {
                name: "Episode 10",
                date: "June 3 2020",
                days: 2
            },
            {
                name: "Episode 11",
                date: "June 10 2020",
                days: 2
            },
            {
                name: "Episode 12",
                date: "June 17 2020",
                days: 2
            }
        ]
    },
    {
        type: "Other",
        title: [
            "Daily Quests Half Stamina Campaign",
            "曜日クエストスタミナ半減キャンペーン",
        ],
        image: "match",
        column: 2,
        timers: [
            {
                name: "Period",
                "start": "January 20 2020, 0:00",
                "end": "January 30 2020, 13:59"
            }
        ]
    },
    {
        type: "WeekendBoss",
        title: [
            "June Boss Challenge",
            "Fight a boss every weekend",
            "Receive Challenge Medals"
        ],
        image: "https://i.imgur.com/zso90Ea.png",
        column: 2,
        timers: [
            {
                name: "Weekend 1",
                start: "June 6 2020, 0:00",
                end: "June 7 2020, 23:59"
            },
            {
                name: "Weekend 2",
                start: "June 13 2020, 0:00",
                end: "June 14 2020, 23:59"
            },
            {
                name: "Weekend 3",
                start: "June 20 2020, 0:00",
                end: "June 21 2020, 23:59"
            },
            {
                name: "Weekend 4",
                start: "June 27 2020, 0:00",
                end: "June 28 2020, 23:59"
            },
            {
                name: "Medal exchange period",
                start: "June 6 2020, 0:00",
                end: "July 3 2020, 23:59",
                keepAfterFinished: "2 hours",
                type: "normal"
            }
        ]
    },
    {
        type: "Other",
        title: [
            "Limited Hinamatsuri Room Decorations",
            "ヒナ祭り限定のルームアイテム"
        ],
        image: "kanna",
        column: 2,
        timers: [
            {
                name: "Period",
                start: "February 28 2020, 17:00",
                end: "March 13 2020, 13:59"
            }
        ]
    },
    {
        type: "Other",
        title: [
            "900 Days Celebration Special Gems Set",
            "お得な星彩石セット販売"
        ],
        image: "cork",
        column: 2,
        timers: [
            {
                name: "Period",
                "start": "May 28 2020, 17:00",
                "end": "June 10 2020, 23:59"
            }
        ]
    },
    {
        type: "Other",
        title: [
            "Tamayomi Celebration Special Gems Set",
            "球詠」参戦記念星彩石セット販売"
        ],
        image: "cork",
        column: 2,
        timers: [
            {
                name: "Period",
                "start": "June 9 2020, 17:00",
                "end": "June 23 2020, 11:59"
            }
        ]
    }
];
