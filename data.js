var alertMessages = [];
var alertTypes = [];
var timerData = [
    {
        type: "DailyQuest",
        title: "Daily Quests",
        priority: 50,
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
            "Summon Renovation"
        ],
        image: "Maintenance",
        column: 0,
        priority: 40,
        timers: [
            {
                name: "Scheduled Time",
                start: "September 29 2021, 16:00",
                end: "September 29 2021, 17:00",
                keepAfterFinished: "30 minutes"
            }
        ]
    },
    {
        "type": "Event",
        "title": [
            "Idol Life on a Desert Island",
            "無人島アイドル生活",
            "Idol Event"
        ],
        "image": [
            "https://i.imgur.com/r2J0Huc.png",
            "https://i.imgur.com/eapSVNF.png",
            "https://i.imgur.com/RyhDqjJ.png",
            "https://i.imgur.com/UOPyEyL.png",
            "https://i.imgur.com/dtCS5VD.png"
        ],
        "column": 0,
        "priority": 32,
        "timers": [
            {
                "name": "Main Event",
                "start": "September 14 2021, 17:00",
                "end": "September 29 2021, 15:59",
                "extraPriority": 4,
                "markers": [
                    {
                        "title": "EX Quest",
                        "time": "September 19 2021, 17:00",
                        "type": "battle"
                    },
                    {
                        "title": "Boss Quest",
                        "time": "September 16 2021, 17:00",
                        "type": "battle"
                    },
                    {
                        "title": "Extra Chapter 1",
                        "time": "September 23 2021, 0:00",
                        "type": "story"
                    },
                    {
                        "title": "Extra Chapter 2",
                        "time": "September 24 2021, 0:00",
                        "type": "story"
                    },
                    {
                        "title": "Extra Chapter 3",
                        "time": "September 25 2021, 0:00",
                        "type": "story"
                    },
                    {
                        "title": "Extra Chapter 4",
                        "time": "September 26 2021, 0:00",
                        "type": "story"
                    }
                ]
            },
            {
                "name": "Missions",
                "start": "September 14 2021, 17:00",
                "end": "September 29 2021, 23:59"
            },
            {
                "name": "Event Shop",
                "start": "September 14 2021, 17:00",
                "end": "October 6 2021, 13:59"
            }
        ]
    },
    {
        "type": "Event",
        "title": [
            "NEW GAME Now in Production",
            "現在NEW GAME制作中",
            "NEW GAME! Finale Event"
        ],
        "image": [
            "https://i.imgur.com/h7oCPoy.png",
            "https://i.imgur.com/ZcIxD33.png"
        ],
        "column": 0,
        "priority": 32,
        "timers": [
            {
                "name": "Main Event",
                "start": "September 29 2021, 17:00",
                "end": "October 13 2021, 15:59",
                "extraPriority": 4,
                "markers": [
                    {
                        "title": "EX Quest",
                        "time": "October 5 2021, 17:00",
                        "type": "battle"
                    },
                    {
                        "title": "Boss Quest",
                        "time": "October 1 2021, 17:00",
                        "type": "battle"
                    },
                    {
                        "title": "Extra Chapter 1",
                        "time": "October 8 2021, 0:00",
                        "type": "story"
                    },
                    {
                        "title": "Extra Chapter 2",
                        "time": "October 9 2021, 0:00",
                        "type": "story"
                    },
                    {
                        "title": "Extra Chapter 3",
                        "time": "October 10 2021, 0:00",
                        "type": "story"
                    },
                    {
                        "title": "Extra Chapter 4",
                        "time": "October 11 2021, 0:00",
                        "type": "story"
                    }
                ]
            },
            {
                "name": "Missions",
                "start": "September 29 2021, 17:00",
                "end": "October 13 2021, 23:59"
            },
            {
                "name": "Event Shop",
                "start": "September 29 2021, 17:00",
                "end": "October 20 2021, 13:59"
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "Idol Life on a Desert Island Summon",
            "無人島アイドル生活ピックアップ召喚",
            "Idol Event Summon"
        ],
        "image": [
            "https://i.imgur.com/r2J0Huc.png",
            "https://i.imgur.com/eapSVNF.png",
            "https://i.imgur.com/RyhDqjJ.png",
            "https://i.imgur.com/UOPyEyL.png",
            "https://i.imgur.com/dtCS5VD.png"
        ],
        "column": 1,
        "priority": 21,
        "timers": [
            {
                "name": "Summon Period",
                "start": "September 14 2021, 17:00",
                "end": "September 29 2021, 15:59",
                "banners": [
                    {
                        "title": "Hemo Side",
                        "desc": "Featuring 5★ Midori Hemo, 4★ Makinose Himari",
                        "time": "September 14 2021, 17:00"
                    },
                    {
                        "title": "Machi Side",
                        "desc": "Featuring 5★ Tokiwa Machi, 4★ Kitazawa Misaki",
                        "time": "September 14 2021, 17:00"
                    },
                    {
                        "title": "Hideri Side",
                        "desc": "Featuring 5★ Kanzaki Hideri, 4★ Kanzaki Hideri",
                        "time": "September 17 2021, 0:00"
                    }
                ],
                "extraPriority": 6
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "NEW GAME Now in Production Summon",
            "現在NEW GAME制作中ピックアップ召喚",
            "NEW GAME! Finale Event Summon"
        ],
        "image": [
            "https://i.imgur.com/h7oCPoy.png",
            "https://i.imgur.com/ZcIxD33.png"
        ],
        "column": 1,
        "priority": 21,
        "timers": [
            {
                "name": "Summon Period",
                "start": "September 29 2021, 17:00",
                "end": "October 13 2021, 15:59",
                "banners": [
                    {
                        "title": "Kou Side",
                        "desc": "Featuring 5★ Yagami Kou, 4★ Yagami Kou",
                        "time": "September 29 2021, 17:00"
                    },
                    {
                        "title": "Aoba Side",
                        "desc": "Featuring 5★ Suzukaze Aoba, 4★ Suzukaze Aoba",
                        "time": "September 29 2021, 17:00"
                    }
                ],
                "extraPriority": 6
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "Limited-time Fire Characters Summon",
            "2つの召喚を同時開催！炎属性のキャラクターを仲間にしよう！",
            "240 Paid Gems for a 10x Summon + Random 5★ Summon Ticket",
            "Random 5★ Summon Ticket on the 7th step"
        ],
        "image": "clea",
        "column": 1,
        "priority": 21,
        "timers": [
            {
                "name": "Summon Period: Featuring 5★ Yoriko [Maid], 5★ Ikeno Kaede, 5★ Hiroe [Hot Spring], 5★ Tooi Narumi, 5★ Cocoa [Christmas], 5★ Syaro, 5★ Kohane [Bridal], 5★ Machiko Ryou",
                "start": "September 29 2021, 17:00",
                "end": "October 6 2021, 16:59",
                "extraPriority": 4
            },
            {
                "name": "Ticket Expiration",
                "start": "September 29 2021, 17:00",
                "end": "October 13 2021, 23:59"
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "Hanayamata & OchiFuru Paid Summon + Choosable 5★ Summon Ticket",
            "ハナヤマタ＆おちフル★5選べるチケット付き！有償限定10回召喚",
            "700 Paid Gems for a 10x Summon + 2x Choosable 5★ Summon Ticket"
        ],
        "image": "clea",
        "column": 1,
        "priority": 21,
        "timers": [
            {
                "name": "Summon Period: Featuring 5★ Sekiya Naru, 5★ Hana [Swimsuit], 5★ Nishimikado Tami, 5★ Sakura Ino",
                "start": "September 14 2021, 17:00",
                "end": "September 21 2021, 16:59",
                "extraPriority": 4
            },
            {
                "name": "Ticket Expiration",
                "start": "September 14 2021, 17:00",
                "end": "September 28 2021, 23:59"
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "NEW GAME! Limited-time Summon",
            "NEW GAME!期間限定特別セレクション召喚"
        ],
        "image": "clea",
        "column": 1,
        "priority": 21,
        "timers": [
            {
                "name": "Summon Period: Featuring 5★ Aoba [Sports Festival], 5★ Hifumi [Maid], 5★ Hajime [Christmas], 5★ Yun [Doll's Festival], 4★ Momiji [New Year], 4★ Tsubame [Valentine]",
                "start": "September 29 2021, 17:00",
                "end": "October 6 2021, 16:59",
                "extraPriority": 4
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "NEW GAME! Paid Summon + Choosable 5★ Summon Ticket",
            "NEW GAME!★5選べるチケット付き！有償限定10回召喚",
            "400 Paid Gems for a 10x Summon + Choosable 5★ Summon Ticket"
        ],
        "image": "clea",
        "column": 1,
        "priority": 21,
        "timers": [
            {
                "name": "Summon Period",
                "start": "September 29 2021, 17:00",
                "end": "October 6 2021, 16:59",
                "extraPriority": 4
            },
            {
                "name": "Ticket Expiration",
                "start": "September 29 2021, 17:00",
                "end": "October 13 2021, 23:59"
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "NEW GAME! Limited-time Paid Summon + Choosable 5★ Summon Ticket",
            "NEW GAME!期間限定★5選べるチケット付き！有償限定10回召喚",
            "1,000 Paid Gems for a 10x Summon + 2x Choosable 5★ Summon Ticket"
        ],
        "image": "clea",
        "column": 1,
        "priority": 21,
        "timers": [
            {
                "name": "Summon Period: Featuring 5★ Aoba [Sports Festival], 5★ Hifumi [Christmas], 5★ Hifumi [Maid], 5★ Hajime [Christmas], 5★ Yun [Doll's Festival], 5★ Kou [Swimsuit], 5★ Kou [New Year], 5★ Nene [Swimsuit], 5★ Momiji [Valentine]",
                "start": "September 29 2021, 17:00",
                "end": "October 6 2021, 16:59",
                "extraPriority": 4
            },
            {
                "name": "Ticket Expiration",
                "start": "September 29 2021, 17:00",
                "end": "October 13 2021, 23:59"
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "Kirara Fantasia Limited-time Deluxe Summon",
            "きららファンタジア期間限定デラックス召喚",
            "1000 Paid Gems for a 10x 5* Summon"
        ],
        "image": "clea",
        "column": 1,
        "priority": 21,
        "timers": [
            {
                "name": "Summon Period",
                "start": "September 26 2021, 0:00",
                "end": "September 27 2021, 23:59",
                "extraPriority": 4
            }
        ]
    },
    {
        "type": "Gacha",
        "title": [
            "Daily KiraKira Limited-time Summon",
            "1日1回期間限定きらきら召喚",
            "40 Paid Gems once per day for 3 summons, all 4* or above"
        ],
        "image": "clea",
        "column": 1,
        "priority": 21,
        "timers": [
            {
                "name": "Summon Period & Ticket Piece Exchange",
                "start": "September 18 2021, 0:00",
                "end": "September 27 2021, 23:59",
                "extraPriority": 4
            },
            {
                "name": "Ticket Expiration",
                "start": "September 18 2021, 0:00",
                "end": "October 4 2021, 23:59"
            }
        ]
    },
    {
        type: "Other",
        title: [
            "1200 Days Celebration Login Bonus",
            "1200日記念ログインボーナス",
            "Log in on 10 days for up to 300 Free Gems"
        ],
        image: "lamp",
        column: 2,
        timers: [
            {
                name: "Period",
                "start": "March 24 2021, 0:00",
                "end": "April 6 2021, 23:59"
            }
        ]
    },
    {
        type: "LoginDays",
        title: [
            "Ochikobore Fruit Tart participation Login Bonus",
            "おちこぼれフルーツタルト参戦決定記念ログインボーナス",
            "20 Gems on days the anime airs"
        ],
        image: "lamp",
        column: 2,
        timers: [
            {
                name: "Episode 2",
                date: "October 19 2020",
                days: 2
            },
        ]
    },
    {
        type: "Other",
        title: [
            "Main Quest Half Stamina Campaign",
            "メインクエストスタミナ半減キャンペーン",
        ],
        image: "match",
        column: 2,
        priority: 14,
        timers: [
            {
                name: "Part 2 (Chapters 1~3)",
                "start": "September 18 2021, 0:00",
                "end": "September 29 2021, 15:59"
            },
            {
                name: "Part 1 (Chapters 1~Prologue, Normal Mode)",
                "start": "September 2 2021, 17:00",
                "end": "September 14 2021, 15:59"
            }
        ]
    },
    {
        "type": "WeekendBoss",
        "title": [
            "September Boss Challenge",
            "Fight a boss every weekend",
            "Receive Challenge Medals"
        ],
        "image": "https://i.imgur.com/XoUiniG.png",
        "column": 2,
        "priority": 13,
        "timers": [
            {
                "name": "Weekend 1",
                "start": "September 4 2021, 0:00",
                "end": "September 5 2021, 23:59"
            },
            {
                "name": "Weekend 2",
                "start": "September 11 2021, 0:00",
                "end": "September 12 2021, 23:59"
            },
            {
                "name": "Weekend 3",
                "start": "September 18 2021, 0:00",
                "end": "September 19 2021, 23:59"
            },
            {
                "name": "Weekend 4",
                "start": "September 25 2021, 0:00",
                "end": "September 26 2021, 23:59"
            },
            {
                "name": "Medal exchange period",
                "start": "September 4 2021, 0:00",
                "end": "October 1 2021, 23:59",
                "keepAfterFinished": "2 hours",
                "type": "normal"
            }
        ]
    },
    {
        "type": "Other",
        "title": [
            "Summer-themed Room Decoration Items",
            "夏限定ルームアイテム再登場"
        ],
        "image": "kanna",
        "column": 2,
        "priority": 10,
        "timers": [
            {
                "name": "Period",
                "start": "July 21 2021, 17:00",
                "end": "August 20 2021, 11:59"
            }
        ]
    },
    {
        "type": "WeekendBoss",
        "title": [
            "October Boss Challenge",
            "Fight a boss every weekend",
            "Receive Challenge Medals"
        ],
        "image": "https://i.imgur.com/wpjQvC8.png",
        "column": 2,
        "priority": 13,
        "timers": [
            {
                "name": "Weekend 1",
                "start": "October 2 2021, 0:00",
                "end": "October 3 2021, 23:59"
            },
            {
                "name": "Weekend 2",
                "start": "October 9 2021, 0:00",
                "end": "October 10 2021, 23:59"
            },
            {
                "name": "Weekend 3",
                "start": "October 16 2021, 0:00",
                "end": "October 17 2021, 23:59"
            },
            {
                "name": "Weekend 4",
                "start": "October 23 2021, 0:00",
                "end": "October 24 2021, 23:59"
            },
            {
                "name": "Weekend 5",
                "start": "October 30 2021, 0:00",
                "end": "October 31 2021, 23:59"
            },
            {
                "name": "Medal exchange period",
                "start": "October 2 2021, 0:00",
                "end": "November 5 2021, 23:59",
                "keepAfterFinished": "2 hours",
                "type": "normal"
            }
        ]
    },
    {
        "type": "Other",
        "title": [
            "Silver Week Login Bonus",
            "シルバーウィークログインボーナス",
            "Log in on 5 days to receive up to 100 Starlight Stones."
        ],
        "image": "lamp",
        "column": 2,
        "priority": 15,
        "timers": [
            {
                "name": "Period",
                "start": "September 18 2021, 0:00",
                "end": "September 29 2021, 23:59"
            }
        ]
    },
    {
        "type": "Other",
        "title": [
            "Special Item Bundle",
            "お得なアイテムセット販売"
        ],
        "image": "cork",
        "column": 2,
        "priority": 12,
        "timers": [
            {
                "name": "Item & Gem Sales",
                "start": "September 18 2021, 0:00",
                "end": "September 29 2021, 15:59"
            },
            {
                "name": "Choosable Limited-time 5★ Summon Ticket (SW 2021)",
                "start": "September 18 2021, 0:00",
                "end": "September 18 2021, 23:59"
            },
            {
                "name": "Silver 5★ Summon Special Support Set",
                "start": "September 18 2021, 0:00",
                "end": "September 20 2021, 23:59"
            },
            {
                "name": "2,000 Starlight Stones Set (SW Past 2021 with Bonus)",
                "start": "September 18 2021, 0:00",
                "end": "September 20 2021, 23:59"
            },
            {
                "name": "NEW GAME! Finale Celebration Starlight Stone Set",
                "start": "September 29 2021, 17:00",
                "end": "October 13 2021, 15:59"
            }
        ]
    },
    {
        "type": "Other",
        "title": [
            "Author Quests 「ＰＥＣＯ　-A trial version-」 Half Stamina Campaign",
            "作家クエスト「ＰＥＣＯ　-A trial version-」スタミナ半減キャンペーン"
        ],
        "image": "match",
        "column": 2,
        "priority": 14,
        "timers": [
            {
                "name": "Period",
                "start": "September 29 2021, 17:00",
                "end": "October 13 2021, 15:59"
            }
        ]
    }
];
